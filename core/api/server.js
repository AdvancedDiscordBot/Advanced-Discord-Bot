const fastifyFactory = require("fastify");
const cookie = require("@fastify/cookie");
const session = require("@fastify/session");
const MongoStore = require("connect-mongo");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
const { WebSocketServer } = require("ws");
const { spawn, fork } = require("child_process");
const { createLogger } = require("../logger");
const { registry } = require("../pluginRegistry");

const ADMIN_PERMISSION = 0x8;
const MANAGE_GUILD_PERMISSION = 0x20;

function parseOwnerIds() {
	const raw = process.env.OWNER_IDS || "";
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

function hasGuildPermission(guild) {
	if (guild.owner) return true;
	const permissions = Number(guild.permissions || 0);
	return (
		(permissions & ADMIN_PERMISSION) === ADMIN_PERMISSION ||
		(permissions & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION
	);
}

function parseCookies(headerValue) {
	const result = {};
	if (!headerValue) return result;

	const parts = headerValue.split(";");
	for (const part of parts) {
		const [key, ...rest] = part.trim().split("=");
		result[key] = rest.join("=");
	}

	return result;
}

async function startApiServer({ client, db, pluginManager, hooks, startListening = true }) {
	const logger = createLogger("ApiServer");
	const port = Number(process.env.BOT_API_PORT || 3210);
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

	const fastify = fastifyFactory({
		logger: false,
		trustProxy: true,
	});

	const sessionStore = MongoStore.create({
		mongoUrl: process.env.MONGODB_URI,
		collectionName: "vaish_sessions",
	});

	await fastify.register(cookie);
	await fastify.register(session, {
		secret: sessionSecret,
		cookieName: "vaish.sid",
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
<html>
<head>
	<meta charset="utf-8">
	<title>VAISH - Advanced Discord Bot</title>
	<style>
		body { background: #0f172a; color: #f8fafc; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
		a { color: #6366f1; text-decoration: none; font-weight: bold; }
		a:hover { text-decoration: underline; }
		.container { text-align: center; }
	</style>
</head>
<body>
	<div class="container">
		<h1>VAISH Bot is Loading...</h1>
		<p>If you see this page, the landing page is currently updating. You can access the <a href="/dashboard">Dashboard here</a>.</p>
	</div>
</body>
</html>`;
	});

	fastify.get("/api/public-stats", async () => {
		const totalServers = client.guilds.cache.size;
		const totalUsers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
		const botTag = client.user ? client.user.tag : "VAISH#0000";
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
		const params = new URLSearchParams({
			client_id: discordClientId,
			permissions: "8",
			scope: "bot applications.commands",
			integration_type: "0",
		});
		const redirectUrl = `https://discord.com/api/oauth2/authorize?${params}`;
		logger.info(`Redirecting to Bot Invite: ${redirectUrl}`);
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

	fastify.addHook("preHandler", async (request, reply) => {
		if (!request.url.startsWith("/api")) return;
		if (request.url === "/api/public-stats") return; // Allow public landing page stats

		if (!request.session.user) {
			return reply.code(401).send({ error: "unauthorized" });
		}
	});

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

	fastify.get("/api/plugins", async () => ({
		plugins: pluginManager.getPluginList(),
	}));

	fastify.post("/api/plugins/install", async (request, reply) => {
		const { packageName } = request.body || {};
		if (!packageName) {
			return reply.code(400).send({ error: "Package name required" });
		}

		const result = await runNpmInstall(
			packageName,
			pluginManager,
			logger,
			broadcastInstallLog,
		);
		if (!result.ok) {
			return reply.code(500).send({ error: result.error });
		}

		return { ok: true };
	});

	fastify.post("/api/plugins/uninstall", async (request, reply) => {
		const { packageName } = request.body || {};
		if (!packageName) {
			return reply.code(400).send({ error: "Package name required" });
		}

		const pluginList = pluginManager.getPluginList();
		const plugin = pluginList.find(
			(p) => p.name === packageName || p.name === `vaish-plugin-${packageName.replace("vaish-plugin-", "")}`,
		);

		if (plugin) {
			await pluginManager.unloadPlugin(plugin.name, "uninstall");
		}

		const result = await runNpmUninstall(packageName, logger, broadcastInstallLog);
		if (!result.ok) {
			return reply.code(500).send({ error: result.error });
		}

		await pluginManager.loadAll();

		return { ok: true };
	});

	fastify.post("/api/plugins/unload/:name", async (request, reply) => {
		const ok = await pluginManager.unloadPlugin(request.params.name, "api");
		if (!ok) {
			return reply.code(404).send({ error: "Plugin not unloaded" });
		}

		return { ok: true };
	});

	fastify.post("/api/plugins/reload/:name", async (request, reply) => {
		const ok = await pluginManager.reloadPlugin(request.params.name);
		if (!ok) {
			return reply.code(409).send({ error: "Plugin not reloadable" });
		}

		return { ok: true };
	});

	fastify.get("/api/plugins/marketplace", async (request) => {
		const { q, category } = request.query;
		const plugins = await registry.searchPlugins(q, category);
		const installed = pluginManager.getPluginList();
		const installedNames = new Set(installed.map((p) => p.name));

		return {
			plugins: plugins.map((p) => ({
				...p,
				installed: installedNames.has(p.npmPackage) || installedNames.has(p.name),
			})),
		};
	});

	fastify.get("/api/plugins/categories", async () => {
		return { categories: registry.getCategories() };
	});

	fastify.get("/api/plugins/registry/:packageName", async (request, reply) => {
		const plugin = await registry.getPluginDetails(request.params.packageName);
		if (!plugin) {
			return reply.code(404).send({ error: "Plugin not found in registry" });
		}
		return plugin;
	});

	fastify.post("/api/plugins/submit", async (request, reply) => {
		const { packageName, description, author, category } = request.body || {};

		if (!packageName || !description || !author) {
			return reply.code(400).send({ error: "Missing required fields" });
		}

		if (!packageName.startsWith("vaish-plugin-")) {
			return reply.code(400).send({ error: "Package name must start with 'vaish-plugin-'" });
		}

		return registry.submitPlugin({ packageName, description, author, category });
	});

	fastify.post("/api/plugins/restart", async (request, reply) => {
		const ownerIds = parseOwnerIds();
		const isOwner = ownerIds.includes(request.session.user?.id);

		if (!isOwner) {
			return reply.code(403).send({ error: "Only bot owners can restart" });
		}

		logger.info("Scheduling bot restart...");

		setTimeout(() => {
			const restartScript = path.join(__dirname, "restart-bot.js");
			spawn("node", [restartScript], {
				detached: true,
				stdio: "ignore",
				cwd: process.cwd(),
			});
			process.exit(0);
		}, 1000);

		return { ok: true, message: "Restarting bot..." };
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

	const wss = new WebSocketServer({ server: fastify.server, path: "/ws" });
	const wsClients = new Set();

	const getSessionFromRequest = async (req) => {
		const cookies = parseCookies(req.headers.cookie || "");
		const rawSid = cookies["vaish.sid"];
		if (!rawSid) return null;

		const unsigned = fastify.unsignCookie(rawSid);
		if (!unsigned.valid) return null;

		return new Promise((resolve) => {
			sessionStore.get(unsigned.value, (error, sessionData) => {
				if (error) return resolve(null);
				resolve(sessionData);
			});
		});
	};

	wss.on("connection", async (socket, req) => {
		const sessionData = await getSessionFromRequest(req);
		if (!sessionData?.user) {
			socket.close();
			return;
		}

		socket.sessionData = sessionData;
		wsClients.add(socket);

		socket.on("close", () => {
			wsClients.delete(socket);
		});
	});

	const broadcast = (event) => {
		for (const socket of wsClients) {
			if (socket.readyState !== socket.OPEN) continue;

			const sessionData = socket.sessionData || {};
			const guildId = event.guildId;

			if (guildId) {
				const ownerIds = sessionData.ownerIds || [];
				const allowed = sessionData.adminGuildIds || [];

				if (
					!ownerIds.includes(sessionData.user?.id) &&
					!allowed.includes(guildId)
				) {
					continue;
				}
			}

			socket.send(JSON.stringify(event));
		}
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

	const listen = async () => {
		await fastify.listen({ port, host: "0.0.0.0" });
		logger.info(`API listening on ${baseUrl}`);
	};

	if (startListening) {
		await listen();
	}

	return { fastify, wss, broadcastInstallLog, runNpmInstall, listen };
}

async function runNpmInstallInternal(packageName, emitLog) {
	return new Promise((resolve) => {
		const child = spawn("npm", ["install", packageName], {
			cwd: process.cwd(),
			shell: true,
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
			shell: true,
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
