const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { createLogger } = require("./logger");

const REGISTRY_URL =
	process.env.PLUGIN_REGISTRY_URL ||
	"https://raw.githubusercontent.com/AdvancedDiscordBot/registry/main/plugins.json";

const REGISTRY_CACHE_FILE = path.join(process.cwd(), "data", "plugin-registry.json");
const SUBMISSIONS_FILE = path.join(process.cwd(), "data", "plugin-submissions.json");

class PluginRegistry {
	constructor() {
		this.logger = createLogger("PluginRegistry");
		this.registry = null;
		this.lastFetch = null;
		this.cacheTimeout = 1000 * 60 * 30;
	}

	async fetchRegistry(force = false) {
		if (
			!force &&
			this.registry &&
			this.lastFetch &&
			Date.now() - this.lastFetch < this.cacheTimeout
		) {
			return this.registry;
		}

		try {
			this.logger.info("Fetching plugin registry from remote...");
			const response = await axios.get(REGISTRY_URL, { timeout: 10000 });
			this.registry = response.data.plugins || [];
			this.lastFetch = Date.now();
			this.saveCache();
			return this.registry;
		} catch (error) {
			this.logger.warn("Failed to fetch remote registry, using cache", error.message);
			return this.loadCache() || this.getDefaultPlugins();
		}
	}

	saveCache() {
		const dataDir = path.dirname(REGISTRY_CACHE_FILE);
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}
		fs.writeFileSync(
			REGISTRY_CACHE_FILE,
			JSON.stringify(
				{
					plugins: this.registry,
					lastFetch: this.lastFetch,
				},
				null,
				2,
			),
		);
	}

	loadCache() {
		if (!fs.existsSync(REGISTRY_CACHE_FILE)) {
			return null;
		}
		try {
			const data = JSON.parse(fs.readFileSync(REGISTRY_CACHE_FILE, "utf8"));
			this.registry = data.plugins || [];
			this.lastFetch = data.lastFetch;
			return this.registry;
		} catch {
			return null;
		}
	}

	getDefaultPlugins() {
		return [
			{
				name: "adb-plugin-economy",
				displayName: "Economy System",
				description: "Complete economy system with coins, work commands, shop, and leaderboards",
				author: "ADB",
				version: "1.0.0",
				category: "features",
				permissions: ["db.read", "db.write", "commands.register"],
				requiresRestart: false,
				verified: true,
				npmPackage: "adb-plugin-economy",
			},
			{
				name: "adb-plugin-tickets",
				displayName: "Ticket System",
				description: "Advanced ticket system with categories, transcripts, and automation",
				author: "ADB",
				version: "1.0.0",
				category: "features",
				permissions: ["db.read", "db.write", "commands.register"],
				requiresRestart: false,
				verified: true,
				npmPackage: "adb-plugin-tickets",
			},
			{
				name: "adb-plugin-music",
				displayName: "Music Player",
				description: "Play music from YouTube, Spotify, and more with advanced controls",
				author: "Community",
				version: "1.0.0",
				category: "entertainment",
				permissions: ["db.read", "commands.register"],
				requiresRestart: true,
				verified: false,
				npmPackage: "adb-plugin-music",
			},
			{
				name: "adb-plugin-games",
				displayName: "Mini Games",
				description: "Trivia, word games, and more to keep your server entertained",
				author: "Community",
				version: "1.0.0",
				category: "entertainment",
				permissions: ["db.read", "db.write", "commands.register"],
				requiresRestart: false,
				verified: false,
				npmPackage: "adb-plugin-games",
			},
			{
				name: "adb-plugin-moderation",
				displayName: "Advanced Moderation",
				description: "Auto-mod, logs, slowmode, and advanced moderation tools",
				author: "ADB",
				version: "1.0.0",
				category: "moderation",
				permissions: ["db.read", "db.write", "commands.register"],
				requiresRestart: false,
				verified: true,
				npmPackage: "adb-plugin-moderation",
			},
			{
				name: "adb-plugin-levels",
				displayName: "Enhanced Levels",
				description: "Advanced XP system with rewards, milestones, and custom ranks",
				author: "Community",
				version: "1.0.0",
				category: "features",
				permissions: ["db.read", "db.write", "commands.register"],
				requiresRestart: false,
				verified: false,
				npmPackage: "adb-plugin-levels",
			},
			{
				name: "adb-plugin-welcomer",
				displayName: "Welcome & Leave Messages",
				description: "Customizable welcome messages, images, and leave messages",
				author: "Community",
				version: "1.0.0",
				category: "features",
				permissions: ["db.read", "commands.register"],
				requiresRestart: false,
				verified: false,
				npmPackage: "adb-plugin-welcomer",
			},
			{
				name: "adb-plugin-polls",
				displayName: "Polls & Voting",
				description: "Create polls with reactions, anonymous voting, and results",
				author: "Community",
				version: "1.0.0",
				category: "features",
				permissions: ["commands.register"],
				requiresRestart: false,
				verified: false,
				npmPackage: "adb-plugin-polls",
			},
		];
	}

	async searchPlugins(query, category = null) {
		const plugins = await this.fetchRegistry();

		let filtered = plugins;
		if (query) {
			const q = query.toLowerCase();
			filtered = filtered.filter(
				(p) =>
					p.name.toLowerCase().includes(q) ||
					p.displayName.toLowerCase().includes(q) ||
					p.description.toLowerCase().includes(q),
			);
		}

		if (category) {
			filtered = filtered.filter((p) => p.category === category);
		}

		return filtered;
	}

	async getPluginDetails(packageName) {
		const plugins = await this.fetchRegistry();
		return plugins.find((p) => p.npmPackage === packageName || p.name === packageName);
	}

	getCategories() {
		return [
			{ id: "features", name: "Features", icon: "Zap" },
			{ id: "moderation", name: "Moderation", icon: "Shield" },
			{ id: "entertainment", name: "Entertainment", icon: "Gamepad2" },
			{ id: "utility", name: "Utility", icon: "Wrench" },
			{ id: "analytics", name: "Analytics", icon: "BarChart" },
		];
	}

	async submitPlugin(submission) {
		const submissions = this.loadSubmissions();
		submissions.push({
			...submission,
			submittedAt: new Date().toISOString(),
			status: "pending",
		});
		this.saveSubmissions(submissions);
		return { ok: true, message: "Plugin submitted for review" };
	}

	loadSubmissions() {
		if (!fs.existsSync(SUBMISSIONS_FILE)) {
			return [];
		}
		try {
			return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, "utf8"));
		} catch {
			return [];
		}
	}

	saveSubmissions(submissions) {
		const dataDir = path.dirname(SUBMISSIONS_FILE);
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}
		fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
	}
}

const registry = new PluginRegistry();

module.exports = { PluginRegistry, registry };