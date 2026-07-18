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
		const adminGuilds = guildsResponse.data.filter(hasGuildPermission);

		request.session.user = userResponse.data;
		request.session.adminGuildIds = adminGuilds.map((guild) => guild.id);
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

		const guildIds = request.session.adminGuildIds || [];
		const botGuilds = client.guilds.cache;
		const guilds = guildIds
			.filter((id) => botGuilds.has(id))
			.map((id) => {
				const discordGuild = botGuilds.get(id);
				return {
					id: discordGuild.id,
					name: discordGuild.name,
					icon: discordGuild.icon || (discordGuild.iconURL ? discordGuild.iconURL() : null),
				};
			});

		const ownerIds = parseOwnerIds();
		const isOwner = ownerIds.includes(request.session.user?.id);

		return {
			user: request.session.user,
			guilds,
			isOwner,
		};
	});

	await adminPlugin.register(fastify, { client, db });

	fastify.addHook("preHandler", async (request, reply) => {
		if (!request.url.startsWith("/api")) return;
		if (request.url === "/api/public-stats") return; // Allow public landing page stats

		if (!request.session.user) {
			return reply.code(401).send({ error: "unauthorized" });
		}
	});

	const requireOwner = (request, reply) => {
		const ownerIds = parseOwnerIds();
		if (!ownerIds.includes(request.session.user?.id)) {
			reply.code(403).send({ error: "Only bot owners can manage plugins" });
			return false;
		}
		return true;
	};

	const requireGuildAccess = (request, reply) => {
		const guildId = request.params.guildId;
		const ownerIds = request.session.ownerIds || [];

		if (ownerIds.includes(request.session.user?.id)) {
			return true;
		}

		const allowed = request.session.adminGuildIds || [];
		if (!allowed.includes(guildId)) {
			reply.code(403).send({ error: "forbidden" });
			return false;
		}

		return true;
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

	fastify.get("/api/plugins/config/:pluginName", async (request, reply) => {
		if (!requireGuildAccess(request, reply)) return;

		await db.ensureConnection();
		const config = await db.getPluginConfig(request.params.guildId, request.params.pluginName);
		return { config: config?.data || {} };
	});

	fastify.put("/api/plugins/config/:pluginName", async (request, reply) => {
		if (!requireGuildAccess(request, reply)) return;

		await db.ensureConnection();
		const updated = await db.updatePluginConfig(
			request.params.guildId,
			request.params.pluginName,
			request.body || {},
		);
		return { config: updated?.data || {} };
	});

	fastify.get("/api/guild/:guildId/config", async (request, reply) => {
		if (!requireGuildAccess(request, reply)) return;

		await db.ensureConnection();

		const serverConfig = await db.getServerConfig(request.params.guildId);
		const pluginConfigs = await db.getAllPluginConfigs(request.params.guildId);

		return { serverConfig, pluginConfigs };
	});

	fastify.put("/api/guild/:guildId/config", async (request, reply) => {
		if (!requireGuildAccess(request, reply)) return;

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
		if (!requireGuildAccess(request, reply)) return;

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
		if (!requireGuildAccess(request, reply)) return;
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
