const fastifyFactory = require("fastify");
const cors = require("@fastify/cors");
const cookie = require("@fastify/cookie");
const session = require("@fastify/session");
const MongoStore = require("connect-mongo");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const { spawn, fork } = require("child_process");
const { createLogger } = require("../logger");
const { registry } = require("../pluginRegistry");
const {
	computePermissionInteger,
	describe: describePermissions,
} = require("../permissions");
const adminPlugin = require("../adminPlugin");
const { PermissionResolver, TIERS } = require("../permission-resolver");
const { buildCatalog, catalogKeys, viewPermission, configurePermission } = require("../dashboard-permissions");
const { generateFullRiskCard, diffRiskCards, UnmappedCapabilityError } = require("../risk-disclosure");

const ADMIN_PERMISSION = 0x8;
const MANAGE_GUILD_PERMISSION = 0x20;

function parseOwnerIds() {
	const raw = process.env.OWNER_IDS || "";
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

// Only allow installing/updating ADB plugin packages. Blocks shell metacharacters
// and non-plugin packages before the name ever reaches npm.
const PLUGIN_PACKAGE_RE = /^(@[\w.-]+\/)?adb-plugin-[\w.-]+(@[\w.~+-]+)?$/;
function isValidPluginPackage(name) {
	return typeof name === "string" && PLUGIN_PACKAGE_RE.test(name);
}

function hasGuildPermission(guild) {
	if (guild.owner) return true;
	const permissions = Number(guild.permissions || 0);
	return (
		(permissions & ADMIN_PERMISSION) === ADMIN_PERMISSION ||
		(permissions & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION
	);
}

async function startApiServer({ client, db, pluginManager, hooks, startListening = true }) {
	const logger = createLogger("ApiServer");
	const port = Number(process.env.BOT_API_PORT);
	const baseUrl = process.env.BOT_API_BASE_URL || `http://localhost:${port}`;
	const dashboardRedirect = process.env.DASHBOARD_REDIRECT_URL || "";

	const sessionSecret = process.env.SESSION_SECRET;
	const discordClientId = process.env.DISCORD_OAUTH_CLIENT_ID;
	const discordClientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
	const discordRedirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;

	if (
		!sessionSecret ||
		!discordClientId ||
		!discordClientSecret ||
		!discordRedirectUri
	) {
		logger.warn("API disabled - missing OAuth/session environment variables");
		return null;
	}

	if (!port) {
		logger.error("BOT_API_PORT not set in .env");
		return null;
	}

	// Single resolver instance for the process. Guild access is derived per
	// request from live Discord state rather than from the session.
	const permissions = new PermissionResolver({
		client,
		db,
		pluginManager,
		logger,
	});
	permissions.watch(client);

	const fastify = fastifyFactory({
		logger: false,
		trustProxy: true,
	});

	// Tolerate empty-body POSTs sent with Content-Type: application/json.
	// Fastify's default JSON parser throws (400) on a zero-length body, which
	// otherwise breaks bodyless actions like plugin reload/restart/unload.
	fastify.addContentTypeParser(
		"application/json",
		{ parseAs: "string" },
		(req, body, done) => {
			if (!body || !body.trim()) return done(null, {});
			try {
				done(null, JSON.parse(body));
			} catch (err) {
				err.statusCode = 400;
				done(err, undefined);
			}
		},
	);

	const sessionStore = MongoStore.create({
		mongoUrl: process.env.MONGODB_URI,
		collectionName: "adb_sessions",
	});

	await fastify.register(cors, {
		origin: process.env.CORS_ORIGIN || true,
		credentials: true,
	});

	// Add Content-Security-Policy to block Cloudflare's auto-injected beacon
	// script (static.cloudflareinsights.com/beacon.min.js) which causes CORS
	// errors, SRI hash mismatches, and console noise when Cloudflare Web
	// Analytics is enabled on the proxied domain. Applied on all responses so
	// it works for both inline HTML and @fastify/static-served files.
	fastify.addHook("onRequest", async (request, reply) => {
		reply.header(
			"Content-Security-Policy",
			["default-src 'self'",
			 "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com",
			 "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
			 "font-src 'self' https://fonts.gstatic.com",
			 "connect-src 'self' ws: wss:",
			 "img-src 'self' https://cdn.discordapp.com data:",
			 "frame-src 'self' https://discord.com",
			 "object-src 'none'"].join("; ")
		);
	});

	await fastify.register(cookie, {
		secret: sessionSecret,
	});
	await fastify.register(session, {
		secret: sessionSecret,
		cookieName: "adb.sid",
		cookie: {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			secure: false, // Temporarily disabled to prevent proxy dropping cookies
		},
		store: sessionStore,
		saveUninitialized: false,
	});

	fastify.get("/", async (request, reply) => {
		const indexPath = path.join(__dirname, "..", "..", "public", "index.html");
		if (require("fs").existsSync(indexPath)) {
			reply.type("text/html");
			return require("fs").readFileSync(indexPath, "utf8");
		}
		reply.type("text/html");
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="theme-color" content="#FAEBD7">
	<title>ADB - Advanced Discord Bot</title>
	<script>
		// Apply the stored/preferred theme before first paint to avoid a
		// light->dark flash.
		(function () {
			try {
				var stored = localStorage.getItem('adb-theme');
				var theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
				document.documentElement.setAttribute('data-theme', theme);
			} catch (e) {}
		})();
	</script>
	<style>
		@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@400;500;700&display=swap');

		:root {
			--cream: #FAEBD7;
			--ink: #1E1A14;
			--ink2: #4A4033;
			--inkMuted: #6B5D4A;
			--accent: #7C4B3A;
			--accentTint: #F5E6DF;
			--accentOnTint: #5A2E20;
			--creamOnAccent: #FBEEDB;
			--hairlineStrong: rgba(30,26,20,0.20);
			color-scheme: light;
		}
		[data-theme='dark'] {
			--cream: #1C1713;
			--ink: #F5E9D8;
			--ink2: #E4D6C1;
			--inkMuted: #9C8E77;
			--accent: #C98B68;
			--accentTint: #3A2A20;
			--accentOnTint: #F0C9A8;
			--creamOnAccent: #1C1713;
			--hairlineStrong: rgba(245,233,216,0.20);
			color-scheme: dark;
		}

		body {
			background: var(--cream);
			color: var(--ink2);
			font-family: 'DM Sans', sans-serif;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			height: 100vh;
			margin: 0;
			padding: 24px;
			box-sizing: border-box;
			transition: background-color .18s ease, color .18s ease;
		}
		.theme-toggle {
			position: fixed;
			top: 24px;
			right: 24px;
			width: 32px;
			height: 32px;
			border-radius: 10px;
			border: 1.5px solid var(--hairlineStrong);
			background: transparent;
			color: var(--inkMuted);
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 16px;
			line-height: 1;
			transition: color .18s, border-color .18s, background .18s;
		}
		.container {
			text-align: center;
			max-width: 480px;
		}
		h1 {
			font-family: 'Cormorant Garamond', serif;
			font-weight: 300;
			font-size: 39px;
			color: var(--ink);
			margin: 0 0 16px;
		}
		p {
			font-size: 16px;
			line-height: 1.5;
			margin: 0 0 32px;
		}
		.btn-primary {
			display: inline-flex;
			align-items: center;
			padding: 12px 24px;
			border-radius: 100px;
			background: var(--accent);
			color: var(--creamOnAccent);
			text-decoration: none;
			font-family: 'DM Sans', sans-serif;
			font-weight: 500;
			font-size: 14px;
			transition: opacity .18s;
		}
		.btn-primary:hover { opacity: 0.85; }
		.hosting-note {
			margin-top: 48px;
			padding: 10px 16px;
			background: var(--accentTint);
			border-radius: 16px;
			font-size: 13px;
			font-weight: 500;
			color: var(--accentOnTint);
			display: inline-block;
		}
		.hosting-note strong { color: var(--accent); }
	</style>
</head>
<body>
	<button class="theme-toggle" id="theme-toggle" title="Toggle dark mode" aria-label="Toggle dark mode">&#9788;</button>
	<div class="container">
		<h1>ADB is loading...</h1>
		<p>If you see this page, the landing page is currently updating. You can head straight to the dashboard below.</p>
		<a class="btn-primary" href="/dashboard">Dashboard</a>
		<div>
			<div class="hosting-note">Want managed hosting? DM <strong>@deadindian</strong> on Discord.</div>
		</div>
	</div>
	<script>
		(function () {
			var btn = document.getElementById('theme-toggle');
			function render() {
				var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
				btn.innerHTML = isDark ? '&#9789;' : '&#9788;';
			}
			btn.addEventListener('click', function () {
				var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
				document.documentElement.setAttribute('data-theme', next);
				try { localStorage.setItem('adb-theme', next); } catch (e) {}
				render();
			});
			render();
		})();
	</script>
</body>
</html>`;
	});

	fastify.get("/api/public-stats", async () => {
		const totalServers = client.guilds.cache.size;
		const totalUsers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
		const botTag = client.user ? client.user.tag : "ADB#0000";
		const botAvatar = client.user ? client.user.displayAvatarURL() : null;
		const pluginCount = pluginManager.getPluginList().length;
		
		return {
			botTag,
			botAvatar,
			totalServers,
			totalUsers,
			pluginCount,
			commandsCount: client.commands.size || 27,
		};
	});

	fastify.get("/health", async () => ({ status: "ok" }));

	fastify.get("/diag-guilds", async () => {
		return {
			status: client.ws.status,
			ping: client.ws.ping,
			guilds: client.guilds.cache.map(g => ({ id: g.id, name: g.name })),
		};
	});

	fastify.get("/auth/discord", async (request, reply) => {
		const state = crypto.randomBytes(16).toString("hex");
		request.session.oauthState = state;
		
		if (request.query.redirect) {
			request.session.returnTo = request.query.redirect;
		}

		const params = new URLSearchParams({
			client_id: discordClientId,
			redirect_uri: discordRedirectUri,
			response_type: "code",
			scope: "identify guilds",
			state,
		});

		const redirectUrl = `https://discord.com/api/oauth2/authorize?${params}`;
		logger.info(`Redirecting to Discord: ${redirectUrl}`);
		return reply.redirect(redirectUrl);
	});

	fastify.get("/auth/invite", async (request, reply) => {
		const forceAdmin = process.env.INVITE_FORCE_ADMIN === "true";
		const permissions = forceAdmin
			? "8"
			: computePermissionInteger(pluginManager.getPluginList());
		const params = new URLSearchParams({
			client_id: discordClientId,
			permissions,
			scope: "bot applications.commands",
			integration_type: "0",
		});
		const redirectUrl = `https://discord.com/api/oauth2/authorize?${params}`;
		logger.info(`Redirecting to Bot Invite (perms=${permissions}): ${redirectUrl}`);
		return reply.redirect(redirectUrl);
	});

	fastify.get("/auth/discord/callback", async (request, reply) => {
		const { code, state, guild_id } = request.query;

		// If it's a bot invite redirect (contains guild_id), redirect to dashboard.
		// If we don't have a valid state (e.g. direct link or /invite without state), just redirect
		// without throwing an OAuth state error.
		if (guild_id) {
			if (!code || !state || state !== request.session.oauthState) {
				return reply.redirect(dashboardRedirect || "/dashboard");
			}
		}

		if (!code || !state || state !== request.session.oauthState) {
			console.error("OAuth state mismatch:", { 
				queryCode: !!code, 
				queryState: state, 
				sessionState: request.session.oauthState 
			});
			return reply.code(400).send({ error: "Invalid OAuth state" });
		}

		const tokenResponse = await axios.post(
			"https://discord.com/api/oauth2/token",
			new URLSearchParams({
				client_id: discordClientId,
				client_secret: discordClientSecret,
				grant_type: "authorization_code",
				code,
				redirect_uri: discordRedirectUri,
			}).toString(),
			{
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			},
		);

		const accessToken = tokenResponse.data.access_token;

		const [userResponse, guildsResponse] = await Promise.all([
			axios.get("https://discord.com/api/users/@me", {
				headers: { Authorization: `Bearer ${accessToken}` },
			}),
			axios.get("https://discord.com/api/users/@me/guilds", {
				headers: { Authorization: `Bearer ${accessToken}` },
			}),
		]);

		const ownerIds = parseOwnerIds();

		// The OAuth guild list is stored only as a *candidate* list for the guild
		// picker — it is NOT an authorization decision. Discord-side permission
		// changes must take effect without a re-login, so every guild-scoped
		// request is authorized live by the PermissionResolver.
		request.session.user = userResponse.data;
		request.session.candidateGuildIds = (guildsResponse.data || []).map(
			(guild) => guild.id,
		);
		request.session.ownerIds = ownerIds;

		if (request.session.returnTo) {
			const returnUrl = request.session.returnTo;
			delete request.session.returnTo;
			return reply.redirect(returnUrl);
		}

		return reply.redirect(dashboardRedirect || "/dashboard");
	});

	fastify.post("/auth/logout", async (request) => {
		request.session.destroy();
		return { ok: true };
	});

	fastify.get("/api/me", async (request, reply) => {
		if (!request.session.user) {
			return reply.code(401).send({ error: "unauthorized" });
		}

		const userId = request.session.user.id;
		const isOwner = permissions.isHostOwner(userId);

		// Candidate set: every guild the bot is in (owner) or the intersection of
		// the user's Discord guilds with the bot's (everyone else). Access to each
		// is then resolved live — a candidate the user has no tier in is dropped.
		const botGuilds = client.guilds.cache;
		const candidates = isOwner
			? Array.from(botGuilds.keys())
			: (request.session.candidateGuildIds || []).filter((id) =>
					botGuilds.has(id),
				);

		const resolved = await Promise.all(
			candidates.map(async (id) => {
				const access = await permissions.resolve(userId, id);
				if (access.tier === TIERS.NONE) return null;
				const discordGuild = botGuilds.get(id);
				return {
					id: discordGuild.id,
					name: discordGuild.name,
					icon:
						discordGuild.icon ||
						(discordGuild.iconURL ? discordGuild.iconURL() : null),
					tier: access.tier,
				};
			}),
		);

		return {
			user: request.session.user,
			guilds: resolved.filter(Boolean),
			isOwner,
		};
	});

	// ── Member portal (/me) ───────────────────────────────────────────────────
	// Self-service surface: any member of the guild (tier != NONE, no specific
	// dashboard permission required) can list the member pages the guild's
	// active plugins expose. This is distinct from the admin dashboard, which
	// gates on guild.* / plugin.*.configure permissions.

	// Membership guard for /api/me/guild/:guildId/*. Unlike requireGuildAccess,
	// it grants any tier above NONE — a plain member can reach their own pages.
	const requireMembership = async (request, reply) => {
		const userId = request.session.user?.id;
		const guildId = request.params.guildId;
		if (!guildId) {
			reply.code(400).send({ error: "guildId required" });
			return null;
		}
		const access = await permissions.resolve(userId, guildId);
		if (access.tier === TIERS.NONE) {
			reply.code(403).send({ error: "forbidden" });
			return null;
		}
		return access;
	};

	fastify.get("/api/me/guild/:guildId/pages", async (request, reply) => {
		const access = await requireMembership(request, reply);
		if (!access) return;
		const guildId = request.params.guildId;
		const guild = client.guilds.cache.get(guildId);
		return {
			guild: guild
				? {
						id: guild.id,
						name: guild.name,
						icon: guild.icon || (guild.iconURL ? guild.iconURL() : null),
					}
				: { id: guildId },
			tier: access.tier,
			pages: pluginManager.getMemberPages(guildId),
		};
	});

	// ── Member self-service data (platform-rendered pages) ────────────────────
	// A rendered member page declares a plugin model + view in its manifest; the
	// platform reads that model here, force-scoped to {guildId, userId} of the
	// caller, and returns rows for the SPA member-view library to render. The
	// plugin hosts no web server. Query scoping is not negotiable: a member can
	// only ever see their own rows, regardless of what the client asks for.

	// Resolve a rendered page for (guildId, name, path), enforcing the per-guild
	// enable gate (getMemberPages already applies it). Returns null if not found
	// or not a rendered page.
	const resolveRenderedPage = (guildId, name, pagePath) => {
		const pages = pluginManager.getMemberPages(guildId);
		return (
			pages.find(
				(p) => p.pluginName === name && p.path === pagePath && p.rendered,
			) || null
		);
	};

	// Look up a plugin-scoped mongoose model by the manifest source.model name.
	// Models are registered in this (main) process as plugin_<name>_<model>
	// whether the plugin runs isolated (broker-registered) or in-process.
	const getPluginModel = (name, modelName) => {
		const mongoose = require("mongoose");
		return mongoose.models[`plugin_${name}_${modelName}`] || null;
	};

	fastify.get(
		"/api/me/guild/:guildId/plugins/:name/data",
		async (request, reply) => {
			const access = await requireMembership(request, reply);
			if (!access) return;
			const { guildId, name } = request.params;
			const pagePath = (request.query || {}).path;
			if (!pagePath) return reply.code(400).send({ error: "path required" });

			const page = resolveRenderedPage(guildId, name, pagePath);
			if (!page) return reply.code(404).send({ error: "page not found" });

			const source = page.source || {};
			const Model = getPluginModel(name, source.model);
			if (!Model) return { view: page.view, rows: [] };

			await db.ensureConnection();
			// Force member scope — the ONLY query key set is the caller's identity.
			const query = { guildId, userId: request.session.user.id };
			let q = Model.find(query).lean();
			if (source.sort && typeof source.sort === "object") q = q.sort(source.sort);
			q = q.limit(Math.min(source.limit || 100, 500));
			const docs = await q.exec();
			// Serialize _id → string id; drop mongoose internals.
			const rows = docs.map((d) => {
				const { _id, __v, ...rest } = d;
				return { id: String(_id), ...rest };
			});
			return { view: page.view, rows };
		},
	);

	fastify.post(
		"/api/me/guild/:guildId/plugins/:name/action",
		async (request, reply) => {
			const access = await requireMembership(request, reply);
			if (!access) return;
			const { guildId, name } = request.params;
			const { path: pagePath, actionId, rowId } = request.body || {};
			if (!pagePath || !actionId || !rowId) {
				return reply.code(400).send({ error: "path, actionId, rowId required" });
			}

			const page = resolveRenderedPage(guildId, name, pagePath);
			if (!page) return reply.code(404).send({ error: "page not found" });

			// The action MUST be one the manifest declared for this page — the
			// client never chooses the op or field, only which declared action to
			// run on which of its own rows.
			const action = (page.view?.actions || []).find((a) => a.id === actionId);
			if (!action) return reply.code(400).send({ error: "unknown action" });

			const Model = getPluginModel(name, page.source?.model);
			if (!Model) return reply.code(404).send({ error: "model not found" });

			await db.ensureConnection();
			// Always scoped to the caller's own row: {_id, guildId, userId}.
			const scope = { _id: rowId, guildId, userId: request.session.user.id };
			if (action.op === "delete") {
				const res = await Model.deleteOne(scope);
				return { ok: res.deletedCount > 0 };
			}
			if (action.op === "set") {
				const res = await Model.updateOne(scope, {
					$set: { [action.field]: action.value },
				});
				return { ok: res.matchedCount > 0 || res.n > 0 };
			}
			return reply.code(400).send({ error: "unsupported op" });
		},
	);

	await adminPlugin.register(fastify, { client, db, permissions });

	// Requests that legitimately have no dashboard session: the bot's own
	// processes calling in over loopback. Each of these routes does its own
	// localhost check — they are not publicly reachable.
	const SESSIONLESS_API_PATHS = new Set([
		"/api/public-stats", // public landing page stats
		"/api/plugin-ui/register", // bot → own API, localhost-only
		"/api/internal/ws-guilds", // watchdog → bot, localhost-only
	]);

	fastify.addHook("preHandler", async (request, reply) => {
		if (!request.url.startsWith("/api")) return;
		if (SESSIONLESS_API_PATHS.has(request.url.split("?")[0])) return;

		if (!request.session.user) {
			return reply.code(401).send({ error: "unauthorized" });
		}
	});

	// Only the bot's own machine may call the internal endpoints, and it must
	// prove it shares our process environment. The loopback check alone is not
	// enough: the watchdog proxies public traffic to us from localhost, so a
	// remote request can arrive with a loopback source address.
	const isInternalCall = (request) => {
		if (request.headers["x-forwarded-for"]) return false;
		const ip = request.socket?.remoteAddress || "";
		const local =
			ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
		if (!local) return false;
		const presented = request.headers["x-adb-internal"];
		return (
			typeof presented === "string" &&
			presented.length === sessionSecret.length &&
			crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(sessionSecret))
		);
	};

	// The watchdog process holds the WebSocket connections but has no Discord
	// client, so it cannot resolve permissions itself. It reads the session from
	// the shared store and asks here which of the user's candidate guilds they
	// may actually receive events for, refreshing on the resolver's TTL.
	fastify.get("/api/internal/ws-guilds", async (request, reply) => {
		if (!isInternalCall(request)) return reply.code(403).send({ error: "forbidden" });
		const userId = request.query?.userId;
		if (!userId) return reply.code(400).send({ error: "userId required" });

		// Candidates come from the caller's OAuth guild list so we don't attempt a
		// member lookup in every guild the bot has ever joined. Owners see all.
		const candidates = permissions.isHostOwner(userId)
			? Array.from(client.guilds.cache.keys())
			: String(request.query.candidates || "")
					.split(",")
					.map((id) => id.trim())
					.filter((id) => id && client.guilds.cache.has(id));

		const guildIds = [];
		for (const guildId of candidates) {
			const access = await permissions.resolve(userId, guildId);
			if (access.tier !== TIERS.NONE && access.permissions.has("guild.view")) {
				guildIds.push(guildId);
			}
		}
		return { guildIds };
	});

	// Host-owner only. Installing/uninstalling plugins puts third-party code on
	// the host machine, so it never delegates to guild admins.
	const requireOwner = (request, reply) => {
		if (!permissions.isHostOwner(request.session.user?.id)) {
			reply.code(403).send({ error: "Only bot owners can manage plugins" });
			return false;
		}
		return true;
	};

	/**
	 * Guard for any /api/guild/:guildId/* route. Resolves the caller's tier in
	 * that guild live, and optionally requires a specific dashboard permission.
	 * Returns the resolved access object on success, null after replying 401/403.
	 */
	const requireGuildAccess = async (request, reply, permission = null) => {
		const userId = request.session.user?.id;
		const guildId = request.params.guildId;

		if (!userId) {
			reply.code(401).send({ error: "unauthorized" });
			return null;
		}
		if (!guildId) {
			reply.code(400).send({ error: "guildId required" });
			return null;
		}

		const access = await permissions.resolve(userId, guildId);
		if (access.tier === TIERS.NONE) {
			reply.code(403).send({ error: "forbidden" });
			return null;
		}
		if (permission && !access.permissions.has(permission)) {
			reply
				.code(403)
				.send({ error: "forbidden", missingPermission: permission });
			return null;
		}

		return access;
	};

	let broadcastInstallLog = () => {};
	// Reassigned once broadcast() exists (see below). Runs an async unit of work
	// as a "job" whose start/log/end are streamed to the dashboard Jobs panel.
	let runJob = async (_meta, fn) => fn(() => {});

	fastify.get("/api/plugins", async () => ({
		plugins: pluginManager.getPluginList(),
	}));

	fastify.post("/api/plugins/install", async (request, reply) => {
		if (!requireOwner(request, reply)) return;
		const { packageName } = request.body || {};
		if (!packageName) {
			return reply.code(400).send({ error: "Package name required" });
		}
		if (!isValidPluginPackage(packageName)) {
			return reply.code(400).send({
				error: "Invalid package name. Must be an adb-plugin-* package.",
			});
		}

		const result = await runJob(
			{ label: `Install ${packageName}`, kind: "install" },
			(emitLog) => runNpmInstall(packageName, pluginManager, logger, emitLog),
		);
		if (!result.ok) {
			return reply.code(500).send({ error: result.error });
		}

		return { ok: true };
	});

	fastify.post("/api/plugins/uninstall", async (request, reply) => {
		if (!requireOwner(request, reply)) return;
		const { packageName, confirm } = request.body || {};
		if (!packageName) {
			return reply.code(400).send({ error: "Package name required" });
		}

		const pluginList = pluginManager.getPluginList();
		const plugin = pluginList.find(
			(p) => p.name === packageName || p.npmPackage === packageName,
		);

		if (plugin?.core) {
			return reply.code(403).send({
				error: `Core plugins can't be uninstalled. Delete the plugins/${plugin.name} folder to remove it.`,
			});
		}

		if (plugin && !confirm) {
			const dependents = pluginManager.getDependents(plugin.name);
			if (dependents.length) {
				return reply.code(409).send({
					warning: true,
					dependents,
					message: `${dependents.join(", ")} depend on ${plugin.name} and may break.`,
				});
			}
		}

		if (plugin) {
			await pluginManager.unloadPlugin(plugin.name, "uninstall");
		}

		const npmTarget = plugin?.npmPackage || packageName;
		if (!isValidPluginPackage(npmTarget)) {
			return reply.code(400).send({
				error: "Invalid package name. Must be an adb-plugin-* package.",
			});
		}

		const result = await runJob(
			{ label: `Uninstall ${npmTarget}`, kind: "uninstall" },
			(emitLog) => runNpmUninstall(npmTarget, logger, emitLog),
		);
		if (!result.ok) {
			return reply.code(500).send({ error: result.error });
		}

		await pluginManager.loadAll();

		return { ok: true };
	});

	fastify.post("/api/plugins/unload/:name", async (request, reply) => {
		if (!requireOwner(request, reply)) return;
		const ok = await pluginManager.unloadPlugin(request.params.name, "api");
		if (!ok) {
			return reply.code(404).send({ error: "Plugin not unloaded" });
		}

		return { ok: true };
	});

	fastify.post("/api/plugins/reload/:name", async (request, reply) => {
		if (!requireOwner(request, reply)) return;
		const name = request.params.name;
		const result = await runJob(
			{ label: `Reload ${name}`, kind: "reload" },
			async (emitLog) => {
				emitLog(`Reloading plugin ${name}…\n`);
				const ok = await pluginManager.reloadPlugin(name, { force: true });
				emitLog(ok ? "Reloaded.\n" : "Plugin could not be reloaded.\n");
				return { ok };
			},
		);
		if (!result.ok) {
			return reply.code(409).send({ error: "Plugin not reloadable" });
		}

		return { ok: true };
	});

	fastify.get("/api/plugins/marketplace", async (request) => {
		const { q, category, refresh } = request.query;
		const force = refresh === "1" || refresh === "true";
		const plugins = await registry.searchPlugins(q, category, force);
		const installed = pluginManager.getPluginList();

		return {
			plugins: plugins.map((p) => {
				const installedPlugin = installed.find(
					(ip) => ip.npmPackage === p.npmPackage || ip.name === p.name,
				);
				const installedVersion = installedPlugin?.version || null;
				return {
					...p,
					installed: !!installedPlugin,
					installedVersion,
					updateAvailable:
						!!installedVersion && registry.isNewer(installedVersion, p.version),
				};
			}),
		};
	});

	fastify.post("/api/plugins/update", async (request, reply) => {
		if (!requireOwner(request, reply)) return;
		const { packageName, confirm } = request.body || {};
		if (!packageName) {
			return reply.code(400).send({ error: "Package name required" });
		}

		const details = await registry.getPluginDetails(packageName);
		if (!details) {
			return reply.code(404).send({ error: "Plugin not found in registry" });
		}

		const installed = pluginManager.getPluginList();
		const current = installed.find(
			(p) => p.npmPackage === packageName || p.name === packageName,
		);

		if (current && !confirm) {
			const dependents = pluginManager.getDependents(current.name);
			if (dependents.length) {
				return reply.code(409).send({
					warning: true,
					dependents,
					message: `${dependents.join(", ")} depend on ${current.name} and may break after this update.`,
				});
			}
		}

		// Update installs from npm. If the registry entry has no npmPackage,
		// there is nothing to install — stop rather than guessing a package name.
		if (!details.npmPackage) {
			return reply.code(422).send({
				error: `Registry entry for ${packageName} has no npmPackage; cannot update.`,
			});
		}
		const target = `${details.npmPackage}@${details.version}`;
		if (!isValidPluginPackage(target)) {
			return reply.code(400).send({ error: "Invalid package in registry entry." });
		}
		const result = await runJob(
			{ label: `Update ${details.npmPackage} → ${details.version}`, kind: "update" },
			(emitLog) => runNpmInstall(target, pluginManager, logger, emitLog),
		);
		if (!result.ok) {
			return reply.code(500).send({ error: result.error });
		}
		return { ok: true };
	});

	// Update every installed plugin that has a newer published version. Owner
	// only — same trust boundary as single-plugin update. Sequential so the
	// deploy Jobs panel shows one install at a time and a failure in one
	// doesn't abort the rest.
	fastify.post("/api/plugins/update-all", async (request, reply) => {
		if (!requireOwner(request, reply)) return;

		// Refresh the registry so we compare against the latest published
		// versions, then update every installed plugin that has a newer one.
		const marketplace = await registry.searchPlugins(undefined, undefined, true);
		const installed = pluginManager.getPluginList();

		const targets = [];
		for (const current of installed) {
			if (current.core) continue; // core plugins aren't npm-managed
			const match = marketplace.find(
				(p) => p.npmPackage === current.npmPackage || p.name === current.name,
			);
			if (!match || !match.npmPackage || !current.version) continue;
			if (!registry.isNewer(current.version, match.version)) continue;

			const target = `${match.npmPackage}@${match.version}`;
			if (!isValidPluginPackage(target)) continue;
			targets.push({ name: current.name, target, from: current.version, to: match.version });
		}

		if (targets.length === 0) {
			return { ok: true, updated: [], message: "All plugins are already up to date." };
		}

		const results = [];
		for (const t of targets) {
			const result = await runJob(
				{ label: `Update ${t.target}`, kind: "update" },
				(emitLog) => runNpmInstall(t.target, pluginManager, logger, emitLog),
			);
			results.push({ name: t.name, from: t.from, to: t.to, ok: result.ok, error: result.error || null });
		}

		const failed = results.filter((r) => !r.ok);
		return { ok: failed.length === 0, updated: results };
	});

	fastify.get("/api/plugins/categories", async () => {
		return { categories: registry.getCategories() };
	});

	fastify.get("/api/plugins/permissions", async () => {
		const plugins = pluginManager.getPluginList();
		return {
			integer: computePermissionInteger(plugins),
			byPlugin: plugins
				.filter((p) => (p.discordPermissions || []).length)
				.map((p) => ({
					name: p.displayName || p.name,
					permissions: describePermissions(p.discordPermissions),
				})),
		};
	});

	fastify.get("/api/plugins/:name/brochure", async (request, reply) => {
		const content = pluginManager.getBrochure(request.params.name);
		if (content === null) {
			return reply.code(404).send({ error: "No brochure found" });
		}
		return { content };
	});

	fastify.get("/api/plugins/registry/:packageName", async (request, reply) => {
		const plugin = await registry.getPluginDetails(request.params.packageName);
		if (!plugin) {
			return reply.code(404).send({ error: "Plugin not found in registry" });
		}
		return plugin;
	});

	// Risk card for an installed plugin — the plain-language "worst case" list
	// generated deterministically from the plugin's own manifest.
	fastify.get("/api/plugins/:name/risk-card", async (request, reply) => {
		const manifest = pluginManager.getManifest(request.params.name);
		if (!manifest) {
			return reply.code(404).send({ error: "Plugin not found" });
		}
		try {
			// { granted: [...], withheld: [...] } — both halves of the disclosure.
			return generateFullRiskCard(manifest);
		} catch (err) {
			if (err instanceof UnmappedCapabilityError) {
				return reply.code(422).send({ error: err.message, unmapped: err.unmapped });
			}
			throw err;
		}
	});

	// Pre-install risk card from a registry entry's manifest. This is the
	// disclosure shown before the user commits to installing. If the registry
	// entry carries no manifest we can't honestly describe what it does, so we
	// say so rather than showing a reassuringly-empty card.
	fastify.get("/api/plugins/registry/:packageName/risk-card", async (request, reply) => {
		const plugin = await registry.getPluginDetails(request.params.packageName);
		if (!plugin) {
			return reply.code(404).send({ error: "Plugin not found in registry" });
		}
		const manifest = plugin.manifest || plugin.pluginJson || null;
		if (!manifest) {
			return reply.code(422).send({
				error: "Registry entry has no manifest; cannot generate a risk card.",
			});
		}
		try {
			return generateFullRiskCard(manifest);
		} catch (err) {
			if (err instanceof UnmappedCapabilityError) {
				return reply.code(422).send({ error: err.message, unmapped: err.unmapped });
			}
			throw err;
		}
	});

	// ── Runtime enforcement: violations & suspension ──────────────────────
	// What the sandbox actually caught at runtime — capability denials, blocked
	// outbound hosts — plus which plugins auto-suspended as a result. This is the
	// "something went wrong, here's exactly what and what we did" surface.
	fastify.get("/api/plugins/violations", async () => {
		const broker = pluginManager.broker;
		if (!broker) return { enforced: false, plugins: [] };
		return { enforced: true, plugins: broker.getViolationSummary() };
	});

	fastify.get("/api/plugins/:name/violations", async (request, reply) => {
		const broker = pluginManager.broker;
		if (!broker) return reply.code(503).send({ error: "Isolation not enabled" });
		const name = request.params.name;
		return {
			plugin: name,
			suspended: broker.isSuspended(name),
			suspension: broker.getSuspension(name),
			violations: broker.getViolations(name),
		};
	});

	// Lift a suspension after review. Reversible, admin-gated action: the plugin
	// resumes receiving events and its violation window resets.
	fastify.post("/api/plugins/:name/reinstate", async (request, reply) => {
		const broker = pluginManager.broker;
		if (!broker) return reply.code(503).send({ error: "Isolation not enabled" });
		const lifted = broker.reinstate(request.params.name);
		return { plugin: request.params.name, reinstated: lifted };
	});

	fastify.post("/api/plugins/submit", async (request, reply) => {
		const { packageName, description, author, category } = request.body || {};

		if (!packageName || !description || !author) {
			return reply.code(400).send({ error: "Missing required fields" });
		}

		if (!packageName.startsWith("adb-plugin-")) {
			return reply.code(400).send({ error: "Package name must start with 'adb-plugin-'" });
		}

		return registry.submitPlugin({ packageName, description, author, category });
	});

	fastify.post("/api/plugins/restart", async (request, reply) => {
		const ownerIds = parseOwnerIds();
		const isOwner = ownerIds.includes(request.session.user?.id);

		if (!isOwner) {
			return reply.code(403).send({ error: "Only bot owners can restart" });
		}

		logger.info("Deploy + restart requested.");

		// Tell the independent watchdog to handle the restart. The watchdog
		// runs the bot as a child process, so it can safely spawn a replacement
		// without the bot having to orchestrate its own death.
		const watchdogPort = process.env.WATCHDOG_PORT;
		if (!watchdogPort) {
			return reply.code(502).send({ error: "WATCHDOG_PORT not set in .env" });
		}
		try {
			const ac = new AbortController();
			const timeout = setTimeout(() => ac.abort(), 120000); // 2 min timeout for deploy

			const response = await fetch(`http://127.0.0.1:${watchdogPort}/restart`, {
				method: "POST",
				signal: ac.signal,
			});

			clearTimeout(timeout);
			const data = await response.json();

			if (!response.ok) {
				logger.error(`Watchdog restart failed: ${data.error}`);
				return reply.code(500).send({ error: data.error || "Restart failed" });
			}

			logger.info("Watchdog accepted restart request. Bot will be replaced momentarily.");

			// The watchdog handles deploy + graceful replacement. The current
			// process will be killed by the watchdog once the new one is ready.
			// We send the response first, then let the process be terminated.
			return reply.send({ ok: true, message: "Restarting…" });
		} catch (err) {
			logger.error(`Failed to reach watchdog: ${err.message}`);
			return reply.code(502).send({
				error: `Cannot reach watchdog on port ${watchdogPort}. Is it running? (./adb-watchdog.sh start)`,
			});
		}
	});

	// Removed: /api/plugins/config/:pluginName (GET/PUT). Plugin config is always
	// per-guild, and those routes read request.params.guildId on a path that has
	// no :guildId segment — they could only ever act on guildId undefined. Use
	// /api/guild/:guildId/plugins/:name/settings instead.

	// ── Plugin settings (schema + saved config) ──────────────────────────────

	fastify.get("/api/guild/:guildId/plugins/:name/settings", async (request, reply) => {
		const { guildId, name } = request.params;
		if (!(await requireGuildAccess(request, reply, viewPermission(name)))) return;
		const plugin = pluginManager.plugins.get(name);
		if (!plugin) return reply.code(404).send({ error: "Plugin not found" });
		await db.ensureConnection();
		const config = await db.getPluginConfig(guildId, name);
		return {
			settingsSchema: plugin.manifest?.settings?.schema || [],
			commandPermissions: plugin.manifest?.settings?.commandPermissions === true,
			webUi: plugin.manifest?.webUi || null,
			config: config?.data || {},
			enabled: config?.enabled === true,
		};
	});

	fastify.put("/api/guild/:guildId/plugins/:name/settings", async (request, reply) => {
		const { guildId, name } = request.params;
		if (!(await requireGuildAccess(request, reply, configurePermission(name)))) return;
		if (!pluginManager.plugins.has(name)) return reply.code(404).send({ error: "Plugin not found" });
		await db.ensureConnection();
		// Merge into existing config, preserving _commands sub-key
		const existing = await db.getPluginConfig(guildId, name);
		const merged = { ...(existing?.data || {}), ...(request.body || {}) };
		const updated = await db.updatePluginConfig(guildId, name, merged);
		return { config: updated?.data || {} };
	});

	// ── Per-command permissions ───────────────────────────────────────────────

	fastify.get("/api/guild/:guildId/plugins/:name/commands", async (request, reply) => {
		const { guildId, name } = request.params;
		if (!(await requireGuildAccess(request, reply, viewPermission(name)))) return;
		const plugin = pluginManager.plugins.get(name);
		if (!plugin) return reply.code(404).send({ error: "Plugin not found" });
		await db.ensureConnection();
		const config = await db.getPluginConfig(guildId, name);
		const cmdConfig = config?.data?._commands || {};
		const commands = Array.from(plugin.commandNames).map((cmd) => ({
			name: cmd,
			enabled: cmdConfig[cmd]?.enabled !== false,
			allowedRoles: cmdConfig[cmd]?.allowedRoles || [],
		}));
		return { commands };
	});

	fastify.put("/api/guild/:guildId/plugins/:name/commands/:cmd", async (request, reply) => {
		const { guildId, name, cmd } = request.params;
		if (!(await requireGuildAccess(request, reply, configurePermission(name)))) return;
		const plugin = pluginManager.plugins.get(name);
		if (!plugin) return reply.code(404).send({ error: "Plugin not found" });
		if (!plugin.commandNames.has(cmd)) return reply.code(404).send({ error: "Command not found" });

		const { enabled, allowedRoles } = request.body || {};
		// Validate allowedRoles as Discord snowflakes (17-19 digit strings)
		const SNOWFLAKE = /^\d{17,19}$/;
		const roles = Array.isArray(allowedRoles)
			? allowedRoles.filter((r) => typeof r === "string" && SNOWFLAKE.test(r))
			: [];

		await db.ensureConnection();
		const existing = await db.getPluginConfig(guildId, name);
		const data = existing?.data || {};
		data._commands = data._commands || {};
		data._commands[cmd] = {
			enabled: enabled !== false,
			allowedRoles: roles,
		};
		const updated = await db.updatePluginConfig(guildId, name, data);
		return { command: updated?.data?._commands?.[cmd] };
	});

	// ── Per-guild plugin enable/disable ───────────────────────────────────────
	// A guild admin (plugins.manage) turns installed plugins on or off for THEIR
	// server. Installing/uninstalling remains host-owner only. Non-gateable
	// plugins — core/builtin/in-repo infrastructure and raw-client plugins that
	// load un-isolated — are always on and cannot be toggled here.

	fastify.put("/api/guild/:guildId/plugins/:name/enabled", async (request, reply) => {
		const { guildId, name } = request.params;
		if (!(await requireGuildAccess(request, reply, "plugins.manage"))) return;
		if (!pluginManager.plugins.has(name)) {
			return reply.code(404).send({ error: "Plugin not found" });
		}
		if (!pluginManager.isGuildGateable(name)) {
			return reply.code(400).send({
				error: "not_toggleable",
				message:
					"This plugin is part of the platform or runs un-sandboxed; it is always on and cannot be enabled or disabled per server.",
			});
		}
		const enabled = request.body?.enabled === true;
		await db.ensureConnection();
		await db.setPluginEnabledForGuild(guildId, name, enabled, request.session.user?.id);
		// Reflect the toggle in the runtime gate immediately.
		pluginManager.setEnabledForGuild(guildId, name, enabled);
		return { name, enabled };
	});

	// Per-guild plugin list: the global plugin list annotated with this guild's
	// enable state and whether each plugin can be toggled at all. Powers the
	// Plugins page toggles and the sidebar's plugin nav.
	fastify.get("/api/guild/:guildId/plugins", async (request, reply) => {
		const { guildId } = request.params;
		if (!(await requireGuildAccess(request, reply, "guild.view"))) return;
		await db.ensureConnection();
		const enabledNames = new Set(await db.getEnabledPluginNames(guildId));
		const plugins = pluginManager.getPluginList().map((p) => {
			const gateable = pluginManager.isGuildGateable(p.name);
			return {
				...p,
				gateable,
				// Non-gateable plugins (core/in-repo/raw-client) are always active.
				enabledForGuild: gateable ? enabledNames.has(p.name) : true,
			};
		});
		return { plugins };
	});

	// ── Dashboard role grants (RBAC) ──────────────────────────────────────────
	// A guild admin (roles.manage) maps Discord roles to sets of dashboard
	// permissions. The permission resolver turns a member's roles into the union
	// of these grants for the MEMBER tier.

	fastify.get("/api/guild/:guildId/permissions/catalog", async (request, reply) => {
		if (!(await requireGuildAccess(request, reply, "roles.manage"))) return;
		const plugins = Array.from(pluginManager.plugins.values());
		return { catalog: buildCatalog(plugins) };
	});

	fastify.get("/api/guild/:guildId/roles/grants", async (request, reply) => {
		const { guildId } = request.params;
		if (!(await requireGuildAccess(request, reply, "roles.manage"))) return;
		await db.ensureConnection();
		const grants = await db.getGuildRoleGrants(guildId);
		const guild = client.guilds.cache.get(guildId);
		const roles = guild
			? guild.roles.cache
					.filter((r) => !r.managed && r.name !== "@everyone")
					.map((r) => ({ id: r.id, name: r.name, color: r.color }))
					.sort((a, b) => b.position - a.position)
			: [];
		return {
			roles,
			grants: grants.map((g) => ({ roleId: g.roleId, permissions: g.permissions || [] })),
		};
	});

	fastify.put("/api/guild/:guildId/roles/grants/:roleId", async (request, reply) => {
		const { guildId, roleId } = request.params;
		if (!(await requireGuildAccess(request, reply, "roles.manage"))) return;
		const SNOWFLAKE = /^\d{17,19}$/;
		if (!SNOWFLAKE.test(roleId)) {
			return reply.code(400).send({ error: "invalid roleId" });
		}
		// Only permissions that actually exist in the catalog can be granted, so a
		// stale or hand-crafted request can't mint access to something undefined.
		const valid = catalogKeys(Array.from(pluginManager.plugins.values()));
		const requested = Array.isArray(request.body?.permissions)
			? request.body.permissions
			: [];
		const granted = requested.filter((p) => valid.has(p));

		await db.ensureConnection();
		await db.setGuildRoleGrant(guildId, roleId, granted, request.session.user?.id);
		// A grant change alters effective access for every member of that role.
		permissions.invalidateGuild(guildId);
		return { roleId, permissions: granted };
	});

	fastify.delete("/api/guild/:guildId/roles/grants/:roleId", async (request, reply) => {
		const { guildId, roleId } = request.params;
		if (!(await requireGuildAccess(request, reply, "roles.manage"))) return;
		await db.ensureConnection();
		await db.deleteGuildRoleGrant(guildId, roleId);
		permissions.invalidateGuild(guildId);
		return { roleId, deleted: true };
	});

	// ── Plugin UI port registry (bot → watchdog) ──────────────────────────────
	// Plugins that declare webUi call this at startup so the watchdog knows
	// which port to proxy for /plugin-ui/:name/*.
	// Only the bot itself (localhost) may call this endpoint.

	const _pluginUiRegistry = new Map(); // name → port

	fastify.post("/api/plugin-ui/register", async (request, reply) => {
		const forwarded = request.headers["x-forwarded-for"];
		const remoteIp = request.socket?.remoteAddress || "";
		const isLocal = !forwarded && (remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1");
		if (!isLocal) return reply.code(403).send({ error: "forbidden" });

		const { name, port } = request.body || {};
		const { WEBUI_PORT } = require("../manifest-schema");
		if (typeof name !== "string" || !name) return reply.code(400).send({ error: "name required" });
		if (!Number.isInteger(port) || port < WEBUI_PORT.min || port > WEBUI_PORT.max) {
			return reply.code(400).send({ error: `port must be ${WEBUI_PORT.min}–${WEBUI_PORT.max}` });
		}
		const plugin = pluginManager.plugins.get(name);
		if (!plugin || !plugin.manifest?.webUi) return reply.code(400).send({ error: "plugin has no webUi declaration" });
		if (plugin.manifest.webUi.port !== port) return reply.code(400).send({ error: "port mismatch with manifest" });

		_pluginUiRegistry.set(name, port);
		// Notify watchdog so it can update its own proxy table
		try {
			const http = require("http");
			const body = JSON.stringify({ type: "plugin-ui-register", name, port });
			const wport = process.env.WATCHDOG_PORT;
			if (wport) {
				const req = http.request({ hostname: "127.0.0.1", port: Number(wport), path: "/api/plugin-ui-register", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } });
				req.write(body); req.end();
			}
		} catch { /* non-fatal */ }

		return { ok: true };
	});

	fastify.get("/api/plugin-ui/registry", async (request, reply) => {
		if (!request.session?.user) return reply.code(401).send({ error: "unauthorized" });
		return { registry: Object.fromEntries(_pluginUiRegistry) };
	});

	fastify.get("/api/guild/:guildId/config", async (request, reply) => {
		if (!(await requireGuildAccess(request, reply, "guild.view"))) return;

		await db.ensureConnection();

		const serverConfig = await db.getServerConfig(request.params.guildId);
		const pluginConfigs = await db.getAllPluginConfigs(request.params.guildId);

		return { serverConfig, pluginConfigs };
	});

	fastify.put("/api/guild/:guildId/config", async (request, reply) => {
		if (!(await requireGuildAccess(request, reply, "guild.configure"))) return;

		await db.ensureConnection();

		const { serverConfig, pluginConfig, pluginConfigs, antiRaid, economy } = request.body || {};

		let updatedServer = null;
		if (serverConfig) {
			updatedServer = await db.updateServerConfig(
				request.params.guildId,
				serverConfig,
			);
		}

		if (antiRaid) {
			await db.AntiRaid.findOneAndUpdate(
				{ guildId: request.params.guildId },
				{ $set: antiRaid },
				{ upsert: true, new: true }
			);
		}

		if (economy) {
			await db.GuildEconomy.findOneAndUpdate(
				{ guildId: request.params.guildId },
				{ $set: economy },
				{ upsert: true, new: true }
			);
		}

		const updatedPlugins = [];

		if (Array.isArray(pluginConfigs)) {
			for (const entry of pluginConfigs) {
				if (!entry?.pluginName) continue;
				updatedPlugins.push(
					await db.updatePluginConfig(
						request.params.guildId,
						entry.pluginName,
						entry.data || {},
					),
				);
			}
		}

		if (pluginConfig?.pluginName) {
			updatedPlugins.push(
				await db.updatePluginConfig(
					request.params.guildId,
					pluginConfig.pluginName,
					pluginConfig.data || {},
				),
			);
		}

		return {
			ok: true,
			serverConfig: updatedServer,
			pluginConfigs: updatedPlugins,
		};
	});

	fastify.get("/api/guild/:guildId/stats", async (request, reply) => {
		if (!(await requireGuildAccess(request, reply, "guild.view"))) return;

		await db.ensureConnection();

		const guild = client.guilds.cache.get(request.params.guildId);
		const tickets = await db.getTickets(request.params.guildId);

		const userCount = await db.UserProfile.countDocuments({
			guildId: request.params.guildId,
		});

		const xpData = await db.UserProfile.aggregate([
			{ $match: { guildId: request.params.guildId } },
			{
				$group: {
					_id: null,
					totalXp: { $sum: "$totalXp" },
					totalMessages: { $sum: "$messageCount" },
					totalVoiceMinutes: { $sum: "$voiceMinutes" },
				},
			},
		]);

		const stats = xpData[0] || {
			totalXp: 0,
			totalMessages: 0,
			totalVoiceMinutes: 0,
		};

		return {
			members: guild?.memberCount || 0,
			activeUsers: userCount,
			totalXp: stats.totalXp,
			totalMessages: stats.totalMessages,
			totalVoiceMinutes: stats.totalVoiceMinutes,
			tickets: {
				total: tickets.length,
				open: tickets.filter((t) => t.status === "open").length,
				inProgress: tickets.filter((t) => t.status === "in_progress").length,
				closed: tickets.filter((t) => t.status === "closed").length,
			},
		};
	});

	fastify.get("/api/guild/:guildId/server-stats", async (request, reply) => {
		if (!(await requireGuildAccess(request, reply, "guild.view"))) return;
		const guild = client.guilds.cache.get(request.params.guildId);
		if (!guild) return reply.code(404).send({ error: "Guild not found" });
		return {
			members: guild.memberCount || 0,
			botPing: client.ws.ping || 0,
			pluginCount: pluginManager.getPluginList().filter((p) => p.enabled).length,
			commandCount: client.commands.size || 0,
			uptime: process.uptime(),
		};
	});

	// WebSocket broadcasting is handled by the watchdog process.
	// The bot pushes events to the watchdog via HTTP POST to
	// /api/ws-broadcast, which the watchdog then forwards to all
	// connected WebSocket clients. This ensures the WebSocket
	// connection survives bot restarts.
	const watchdogPortLocal = process.env.WATCHDOG_PORT;

	const broadcast = (event) => {
		if (!watchdogPortLocal) return;
		fetch(`http://127.0.0.1:${watchdogPortLocal}/api/ws-broadcast`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(event),
		}).catch(function () {});
	};

	hooks.onAny((hookName, payload) => {
		const guildId = payload?.guildId || payload?.interaction?.guild?.id;

		broadcast({
			type: "hook",
			hook: hookName,
			guildId,
			payload,
		});
	});

	broadcastInstallLog = (data) => {
		broadcast({
			type: "install-log",
			payload: data,
		});
	};

	// Job registry: wraps an async operation so the dashboard can show a live
	// progress row + expandable CLI log. `fn` receives an emitLog(chunk) it can
	// pass to the npm helpers. Errors are captured and reported, never thrown up.
	let jobSeq = 0;
	runJob = async (meta, fn) => {
		const id = `job-${Date.now()}-${++jobSeq}`;
		const job = { id, label: meta.label, kind: meta.kind || "task" };
		broadcast({ type: "job", event: "start", job });
		const emitLog = (chunk) => {
			const message = typeof chunk === "string" ? chunk : chunk?.message || "";
			const stream = chunk?.type === "stderr" ? "stderr" : "stdout";
			if (message) broadcast({ type: "job", event: "log", id, stream, message });
		};
		try {
			const result = await fn(emitLog);
			const ok = !result || result.ok !== false;
			broadcast({
				type: "job",
				event: "end",
				id,
				ok,
				error: ok ? null : result.error || "failed",
			});
			return result;
		} catch (error) {
			broadcast({ type: "job", event: "end", id, ok: false, error: error.message });
			throw error;
		}
	};

	const listen = async () => {
		await fastify.listen({ port, host: "0.0.0.0" });
		logger.info(`API listening on ${baseUrl}`);
		// WebSocket server is hosted by the watchdog process on the same
		// port (3008) so it survives bot restarts. The watchdog proxies
		// HTTP to us on port BOT_API_PORT and handles /ws natively.
	};

	if (startListening) {
		await listen();
	}

	return { fastify, broadcastInstallLog, runNpmInstall, listen };
}

async function runNpmInstallInternal(packageName, emitLog) {
	return new Promise((resolve) => {
		const child = spawn("npm", ["install", packageName], {
			cwd: process.cwd(),
		});

		child.stdout.on("data", (data) => {
			emitLog({ type: "stdout", message: data.toString() });
		});

		child.stderr.on("data", (data) => {
			emitLog({ type: "stderr", message: data.toString() });
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ ok: true });
			} else {
				resolve({ ok: false, error: `npm install exited with code ${code}` });
			}
		});
	});
}

async function runNpmInstall(packageName, pluginManager, logger, emitLog) {
	const result = await runNpmInstallInternal(packageName, emitLog);
	if (!result.ok) return result;

	logger.info(`Installed ${packageName}`);

	try {
		await pluginManager.loadAll();
	} catch (error) {
		logger.error("Failed to refresh plugins after install", error);
	}

	return result;
}

async function runNpmUninstall(packageName, logger, emitLog) {
	return new Promise((resolve) => {
		const child = spawn("npm", ["uninstall", packageName], {
			cwd: process.cwd(),
		});

		child.stdout.on("data", (data) => {
			emitLog({ type: "stdout", message: data.toString() });
		});

		child.stderr.on("data", (data) => {
			emitLog({ type: "stderr", message: data.toString() });
		});

		child.on("close", (code) => {
			if (code === 0) {
				logger.info(`Uninstalled ${packageName}`);
				resolve({ ok: true });
			} else {
				resolve({ ok: false, error: `npm uninstall exited with code ${code}` });
			}
		});
	});
}

module.exports = { startApiServer };
