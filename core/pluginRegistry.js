const fs = require("fs");
const path = require("path");
const axios = require("axios");
const semver = require("semver");
const { createLogger } = require("./logger");

// Fallback only — the real registry URL comes from PLUGIN_REGISTRY_URL in .env.
const FALLBACK_REGISTRY_URL =
	"https://github.com/AdvancedDiscordBot/registry/blob/main/plugins.json";

// GitHub "blob" URLs serve an HTML page, not JSON. Rewrite them (and the
// github.com/raw form) to raw.githubusercontent.com so axios receives JSON.
function normalizeRegistryUrl(url) {
	if (!url) return url;
	try {
		const u = new URL(url);
		if (u.hostname === "github.com") {
			// /<owner>/<repo>/blob/<ref>/<path> -> raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
			const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
			if (m) {
				return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
			}
		}
	} catch {
		// not a valid URL — return as-is and let the fetch fail loudly
	}
	return url;
}

const REGISTRY_URL = normalizeRegistryUrl(
	process.env.PLUGIN_REGISTRY_URL || FALLBACK_REGISTRY_URL,
);

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
			this.logger.info(`Fetching plugin registry from ${REGISTRY_URL} ...`);
			const response = await axios.get(REGISTRY_URL, { timeout: 10000 });
			let data = response.data;
			// raw.githubusercontent serves text/plain; axios usually parses it, but
			// guard against a string body (or an HTML error page) all the same.
			if (typeof data === "string") {
				try {
					data = JSON.parse(data);
				} catch {
					data = null;
				}
			}
			const plugins = Array.isArray(data?.plugins) ? data.plugins : null;
			if (!plugins) {
				this.logger.warn("Registry response had no plugins array, keeping cache");
				return this.registry || this.loadCache() || [];
			}
			this.registry = plugins;
			this.lastFetch = Date.now();
			this.saveCache();
			return this.registry;
		} catch (error) {
			this.logger.warn("Failed to fetch remote registry, using cache", error.message);
			return this.loadCache() || [];
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
		// No hardcoded fallback — the registry is the GitHub repo at REGISTRY_URL.
		// Kept for API compatibility; returns nothing when remote + cache both fail.
		return [];
	}

	async searchPlugins(query, category = null, force = false) {
		const plugins = await this.fetchRegistry(force);

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

	isNewer(installed, candidate) {
		const a = semver.valid(semver.coerce(installed));
		const b = semver.valid(semver.coerce(candidate));
		if (!a || !b) return false;
		return semver.gt(b, a);
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