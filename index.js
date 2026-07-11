const {
	Client,
	Collection,
	GatewayIntentBits,
	Partials,
	ActivityType,
	PresenceUpdateStatus,
} = require("discord.js");
const Database = require("./utils/database");
const { HookBus } = require("./core/HookBus");
const { PluginManager } = require("./core/PluginManager");
const { startApiServer } = require("./core/api/server");
const { createLogger } = require("./core/logger");

const TaskScheduler = require("./utils/scheduler");
require("dotenv").config();

// 🚀 Create ADB - Ultra Modern Discord Bot
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildPresences, // For advanced user tracking
	],
	partials: [
		Partials.Message,
		Partials.Channel,
		Partials.Reaction,
		Partials.User,
		Partials.GuildMember,
	],
});

// 💎 Bot Configuration
client.commands = new Collection();
client.cooldowns = new Collection();

// 🎨 ADB Brand Colors - Ultra Modern Design
client.colors = {
	primary: "#6366F1", // Indigo-500 - Modern primary
	secondary: "#8B5CF6", // Violet-500 - Rich secondary
	success: "#10B981", // Emerald-500 - Clean success
	error: "#EF4444", // Red-500 - Clear error
	warning: "#F59E0B", // Amber-500 - Attention warning
	info: "#3B82F6", // Blue-500 - Information
	dark: "#1F2937", // Gray-800 - Dark theme
	light: "#F9FAFB", // Gray-50 - Light theme
	accent: "#EC4899", // Pink-500 - Accent color
	gradient: {
		primary: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
		success: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
		error: "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)",
	},
};

// 🤖 ADB Bot Profile
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
	stats: {
		commands: 46,
		categories: 10,
		uptime: 0,
		servers: 0,
		users: 0,
	},
};

// 🗃️ Database singleton
let db;
let scheduler;
let pluginManager;
let hookBus;

// 🔄 Dynamic Activity Status for ADB
const activities = [
	...(process.env.GEMINI_API_KEY
		? [{ name: "🤖 AI Assistant | /aiassistant", type: ActivityType.Playing }]
		: []),
	{ name: "💎 Points & Rewards | /points", type: ActivityType.Watching },
	{ name: "🎫 Ticket Support | /ticket", type: ActivityType.Listening },
	{ name: "📊 Server Analytics | /serverinfo", type: ActivityType.Watching },
	{ name: "🎮 Fun Games | /8ball", type: ActivityType.Playing },
	{ name: "🛡️ Smart Moderation | /antiraid", type: ActivityType.Watching },
	{ name: "⚡ 27 Commands Available | /help", type: ActivityType.Playing },
];

let currentActivity = 0;

// 🎯 Initialize Database Connection
async function initializeDatabase() {
	try {
		db = await Database.getInstance();
		console.log("🗃️ ADB Database initialized successfully");

		// Update bot stats
		client.profile.stats.uptime = Date.now();

		return db;
	} catch (error) {
		console.error("❌ ADB Database initialization failed:", error);
		process.exit(1);
	}
}

// 🚀 ADB Startup Sequence
client.once("ready", async () => {
	console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                    🤖 ADB BOT ONLINE 🤖                       ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║  Name: ${client.user.tag.padEnd(49)} ║
  ║  ID: ${client.user.id.padEnd(51)} ║  
  ║  Servers: ${client.guilds.cache.size.toString().padEnd(47)} ║
  ║  Users: ${client.guilds.cache
		.reduce((a, g) => a + g.memberCount, 0)
		.toString()
		.padEnd(49)} ║
  ║  Commands: ${client.commands.size.toString().padEnd(46)} ║
  ║  Latency: ${client.ws.ping.toString().padEnd(47)} ms║
  ╠═══════════════════════════════════════════════════════════════╣
  ║  🚀 Ultra-Modern AI-Powered Discord Bot                      ║
  ║  💎 Advanced Features • ⚡ Lightning Fast • 🛡️ Secure        ║
  ║  🌟 Open Source • 📊 Analytics • 🎮 Entertainment            ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);

	// Initialize core systems
	if (!scheduler) {
		scheduler = new TaskScheduler(client);
		console.log("⏰ ADB Task Scheduler initialized");
	}

	// Update bot stats
	client.profile.stats.servers = client.guilds.cache.size;
	client.profile.stats.users = client.guilds.cache.reduce(
		(a, g) => a + g.memberCount,
		0,
	);

	// Set initial status
	updateBotActivity();

	// Rotate activity status every 30 seconds
	setInterval(updateBotActivity, 30000);

	console.log("🎯 ADB is fully operational and ready to serve!");
});

// 🔍 Raw Gateway Event Logger for Debugging Bot Joins
client.on("raw", (packet) => {
	if (["GUILD_CREATE", "GUILD_DELETE"].includes(packet.t)) {
		console.log(`[GATEWAY RAW] ${packet.t} event received:`, {
			id: packet.d.id,
			name: packet.d.name,
			unavailable: packet.d.unavailable,
		});
	}
});

// 🔄 Update Bot Activity Status
function updateBotActivity() {
	const activity = activities[currentActivity];

	client.user.setPresence({
		activities: [activity],
		status: PresenceUpdateStatus.Online,
	});

	currentActivity = (currentActivity + 1) % activities.length;
}

// 🛡️ Advanced Error Handling
process.on("unhandledRejection", (error, promise) => {
	console.error("❌ Unhandled Promise Rejection:", error);
	console.error("Promise:", promise);
});

process.on("uncaughtException", (error) => {
	console.error("❌ Uncaught Exception:", error);
	console.error("Stack:", error.stack);

	// Graceful shutdown
	setTimeout(() => {
		console.log("🔄 ADB is restarting due to critical error...");
		process.exit(1);
	}, 5000);
});

// 🎯 Graceful Shutdown Handler
process.on("SIGINT", async () => {
	console.log("\n🛑 ADB shutdown initiated...");

	try {
		if (db) {
			await db.close();
			console.log("🗃️ Database connection closed");
		}

		client.destroy();
		console.log("🤖 ADB client destroyed");

		console.log("✅ ADB shutdown complete");
		process.exit(0);
	} catch (error) {
		console.error("❌ Error during shutdown:", error);
		process.exit(1);
	}
});

// 🚀 Initialize ADB Bot
async function startADB() {
	try {
		console.log("🔄 Starting ADB Bot...");

		db = await initializeDatabase();

		if (!scheduler) {
			scheduler = new TaskScheduler(client);
			console.log("⏰ ADB Task Scheduler initialized");
		}

		hookBus = new HookBus(createLogger("HookBus"));
		client.hooks = hookBus;

		pluginManager = new PluginManager({
			client,
			db,
			scheduler,
			hooks: hookBus,
		});
		client.pluginManager = pluginManager;

		let apiServer = null;
		if (process.env.BOT_API_ENABLED === "true") {
			apiServer = await startApiServer({
				client,
				db,
				pluginManager,
				hooks: hookBus,
				startListening: false,
			});
			client.fastify = apiServer.fastify;
		}

		await pluginManager.loadAll();

		if (apiServer) {
			await apiServer.listen();
		}

		// Login to Discord
		await client.login(process.env.DISCORD_TOKEN);
	} catch (error) {
		console.error("❌ Failed to start ADB Bot:", error);
		console.log("🔑 Please check your DISCORD_TOKEN in the .env file");
		console.log("💡 Ensure your bot token is valid and has proper permissions");
		process.exit(1);
	}
}

// <<<<<<< HEAD
// =======

// >>>>>>> 32cde73
// // 🌐 Minimal Express server to keep Render web service alive
// const express = require("express");
// const app = express();
// const PORT = process.env.PORT || 3000;

// app.get("/", (req, res) => {
//   res.send("🟢 ADB is alive and running!");
// });

// app.listen(PORT, () => {
//   console.log(`🌐 Web server running on port ${PORT}`);
// });
// 🎬 Start the show!
startADB();
