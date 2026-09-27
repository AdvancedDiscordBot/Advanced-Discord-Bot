const { Client, Collection, Events, GatewayIntentBits, Partials, ActivityType, PresenceUpdateStatus } = require("discord.js");
const Database = require("./utils/database");
const TaskScheduler = require("./utils/scheduler");
const { HookBus } = require("./core/HookBus");
const { PluginManager } = require("./core/PluginManager");
const { syncAllGuilds, syncGuildCommands } = require("./core/command-sync");
const { reconcileInstalledPlugins } = require("./core/plugin-persistence");
const { startApiServer } = require("./core/api/server");
const { createLogger } = require("./core/logger");

/** Create a one-shot runtime. No resources or process listeners exist until start(). */
function createADB({
	env = process.env,
	createClient = (options) => new Client(options),
	getDatabase = () => Database.getInstance(),
	createScheduler = (client) => new TaskScheduler(client, { env }),
	createPluginManager = (options) => new PluginManager(options),
	startApiServer: createApi = startApiServer,
	reconcileInstalledPlugins: reconcile = reconcileInstalledPlugins,
	syncAllGuilds: syncAll = syncAllGuilds,
	syncGuildCommands: syncGuild = syncGuildCommands,
	process: host = process,
	timers = globalThis,
	logger = createLogger("ADB"),
} = {}) {
	let client, db, scheduler, pluginManager, hooks, apiServer;
	let initializing, starting, shuttingDown, activityTimer;
	let stopping = false;
	let currentActivity = 0;
	let cancelStartup;
	const cancelled = new Promise((resolve) => { cancelStartup = resolve; });
	const inFlight = new Set();
	const processListeners = new Map();
	const cancellationError = () => Object.assign(new Error("ADB startup cancelled by shutdown"), { code: "ADB_STARTUP_CANCELLED" });
	const checkRunning = () => { if (stopping) throw cancellationError(); };
	const interruptible = (work) => Promise.race([work, cancelled.then(() => { throw cancellationError(); })]);

	function track(work, message) {
		const pending = Promise.resolve().then(() => {
			if (!stopping) return work();
		}).catch((error) => logger.error(message, error)).finally(() => inFlight.delete(pending));
		inFlight.add(pending);
		return pending;
	}

	function updateActivity() {
		if (stopping || !client.user) return;
		const activities = [
			{ name: `${client.commands.size} commands`, type: ActivityType.Playing },
			{ name: `${client.guilds.cache.size} servers`, type: ActivityType.Watching },
		];
		try {
			client.user.setPresence({
				activities: [activities[currentActivity++ % activities.length]],
				status: PresenceUpdateStatus.Online,
			});
		} catch (error) {
			logger.error("Activity update failed", error);
		}
	}

	const onReady = () => track(async () => {
		client.profile.stats.servers = client.guilds.cache.size;
		client.profile.stats.users = Array.from(client.guilds.cache.values()).reduce((sum, guild) => sum + guild.memberCount, 0);
		client.profile.stats.commands = client.commands.size;
		updateActivity();
		activityTimer = timers.setInterval(updateActivity, 30000);
		logger.info(`Logged in as ${client.user.tag}`);
		await syncAll(pluginManager, client);
	}, "Initial command sync failed");
	const onGuildCreate = (guild) => track(() => syncGuild(pluginManager, client, guild.id), `Command sync failed for guild ${guild.id}`);

	async function initialize() {
		if (typeof env.DISCORD_TOKEN !== "string" || !env.DISCORD_TOKEN.trim()) {
			throw new Error("DISCORD_TOKEN is required");
		}
		checkRunning();
		for (const event of ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"]) {
			const handler = (error) => {
				if (event === "uncaughtException" || event === "unhandledRejection") {
					host.exitCode = 1;
					logger.error(event, error);
				}
				shutdown().then(() => {
					host.exitCode = host.exitCode || 0;
				}).catch((failure) => {
					host.exitCode = 1;
					logger.error("Shutdown failed", failure);
				});
			};
			processListeners.set(event, handler);
			host.on(event, handler);
		}

		client = createClient({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMembers,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.GuildVoiceStates,
				GatewayIntentBits.GuildPresences,
				GatewayIntentBits.GuildInvites,
				GatewayIntentBits.GuildModeration,
			],
			partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
		});
		client.commands = new Collection();
		client.cooldowns = new Collection();
		client.colors = {
			primary: "#6366F1", secondary: "#8B5CF6", success: "#10B981", error: "#EF4444",
			warning: "#F59E0B", info: "#3B82F6", dark: "#1F2937", light: "#F9FAFB", accent: "#EC4899",
			gradient: {
				primary: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
				success: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
				error: "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)",
			},
		};
		client.profile = {
			name: "ADB",
			version: "2.0.0",
			description: "Ultra-modern AI-powered Discord bot with advanced features",
			author: "ADB Development Team",
			website: "https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot",
			github: "https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot",
			support: "https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/issues",
			features: [
				"🤖 Advanced AI Assistant (Google Gemini)",
				"💎 Points & Rewards System",
				"📊 XP & Leveling with Role Rewards",
				"🎫 Professional Ticket System",
				"🛡️ Smart Moderation & Anti-Raid",
				"🎮 Interactive Games & Entertainment",
				"📈 Analytics & Server Insights",
				"⚡ Lightning-fast Performance",
			],
			stats: { commands: 0, categories: 10, uptime: Date.now(), servers: 0, users: 0 },
		};

		// Resource-producing operations finish before shutdown disposes their result.
		db = await getDatabase();
		client.db = db;
		checkRunning();
		scheduler = createScheduler(client);
		client.scheduler = scheduler;
		hooks = new HookBus(createLogger("HookBus"));
		client.hooks = hooks;
		pluginManager = createPluginManager({ client, db, scheduler, hooks });
		client.pluginManager = pluginManager;
		if (env.PLUGIN_ISOLATION !== "false") pluginManager.enableIsolation();

		apiServer = env.BOT_API_ENABLED === "true"
			? await createApi({ client, db, pluginManager, hooks, startListening: false })
			: null;
		client.fastify = apiServer?.fastify || null;
		checkRunning();
		try {
			const { changed } = await reconcile();
			if (changed) logger.info(`Reconciled ${changed} dashboard-installed plugins`);
		} catch (error) {
			logger.error("Plugin reconcile failed", error);
		}
		checkRunning();
		await interruptible(pluginManager.loadAll());
		checkRunning();
		if (apiServer) await interruptible(apiServer.listen());
		checkRunning();
		client.once(Events.ClientReady, onReady);
		client.on(Events.GuildCreate, onGuildCreate);
		await interruptible(client.login(env.DISCORD_TOKEN.trim()));
		checkRunning();
		return runtime;
	}

	function start() {
		if (stopping) return Promise.reject(new Error("ADB runtime is shut down"));
		if (starting) return starting;
		initializing = initialize();
		starting = initializing.catch(async (error) => {
			try { await shutdown(); }
			catch (cleanupError) { logger.error("Startup cleanup failed", cleanupError); }
			throw error;
		});
		return starting;
	}

	function shutdown() {
		if (shuttingDown) return shuttingDown;
		stopping = true;
		cancelStartup();
		if (client) {
			client.shuttingDown = true;
			client.removeListener(Events.ClientReady, onReady);
			client.removeListener(Events.GuildCreate, onGuildCreate);
		}
		if (activityTimer) timers.clearInterval(activityTimer);
		shuttingDown = (async () => {
			if (initializing) await initializing.catch(() => {});
			await Promise.allSettled([...inFlight]);
			const errors = [];
			for (const [name, close] of [
				["API", () => apiServer?.fastify.close()],
				["scheduler", () => scheduler?.shutdown()],
				["plugins", () => pluginManager?.shutdown()],
				["Discord", () => client?.destroy()],
				["database", () => db?.close()],
			]) {
				try { await close(); }
				catch (error) {
					errors.push(error);
					logger.error(`Failed to close ${name}`, error);
				}
			}
			for (const [event, handler] of processListeners) host.removeListener(event, handler);
			processListeners.clear();
			if (errors.length) throw new AggregateError(errors, "ADB shutdown cleanup failed");
		})();
		return shuttingDown;
	}

	const runtime = {
		start, shutdown,
		get client() { return client; },
		get db() { return db; },
		get scheduler() { return scheduler; },
		get pluginManager() { return pluginManager; },
		get apiServer() { return apiServer; },
	};
	return runtime;
}

async function startADB(options) {
	const runtime = createADB(options);
	await runtime.start();
	return runtime;
}

module.exports = { createADB, startADB };

if (require.main === module) {
	require("dotenv").config();
	startADB().catch((error) => {
		if (error.code === "ADB_STARTUP_CANCELLED") return;
		console.error("Failed to start ADB:", error);
		process.exitCode = 1;
	});
}
