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
		this.localPluginCache = new Map();
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
			return this.registry || this.loadCache() || [];
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

	isNewer(installed, candidate) {
		const a = semver.valid(installed);
		const b = semver.valid(candidate);
		if (!a || !b) return false;
		return semver.gt(b, a);
	}

	getCategories() {
		return [
			{ id: "core features", name: "Features", icon: "Zap" },
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

	async refreshRegistry() {
		this.logger.info("Force refreshing plugin registry from GitHub ...");
		return this.fetchRegistry(true);
	}

	async getFreshPluginVersions() {
		const pluginsDir = path.join(process.cwd(), "plugins");
		const nodeModulesDir = path.join(process.cwd(), "node_modules");

		if (!fs.existsSync(pluginsDir) && !fs.existsSync(nodeModulesDir)) {
			return null;
		}

		const freshVersions = new Map();
		const readPlugin = (pluginJsonPath, fallbackName) => {
			if (!fs.existsSync(pluginJsonPath)) return;
			try {
				const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8"));
				if (!pluginJson || typeof pluginJson !== "object") return;
				const name =
					typeof pluginJson.name === "string" && pluginJson.name
						? pluginJson.name
						: fallbackName;
				freshVersions.set(name, {
					version: pluginJson.version,
					npmPackage: pluginJson.name,
					fromLocal: true,
				});
			} catch (error) {
				this.logger.warn(
					`Failed to read plugin.json at ${pluginJsonPath}:`,
					error.message,
				);
			}
		};

		// Check the local plugins directory.
		if (fs.existsSync(pluginsDir)) {
			const pluginDirs = fs
				.readdirSync(pluginsDir, { withFileTypes: true })
				.filter((dir) => dir.isDirectory() && !dir.name.startsWith("."));
			for (const dir of pluginDirs) {
				readPlugin(
					path.join(pluginsDir, dir.name, "plugin.json"),
					dir.name,
				);
			}
		}

		// Check node_modules for adb-plugin-* packages. Scoped packages live one
		// level deeper, at node_modules/@scope/adb-plugin-*, so the scope
		// directory itself has to enter the scan.
		if (fs.existsSync(nodeModulesDir)) {
			const entries = fs
				.readdirSync(nodeModulesDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory());
			for (const entry of entries) {
				if (entry.name.startsWith("@")) {
					const scopeDir = path.join(nodeModulesDir, entry.name);
					let scopedEntries;
					try {
						scopedEntries = fs.readdirSync(scopeDir, { withFileTypes: true });
					} catch (error) {
						this.logger.warn(
							`Failed to scan ${scopeDir}:`,
							error.message,
						);
						continue;
					}
					for (const scoped of scopedEntries) {
						if (!scoped.isDirectory() || !scoped.name.startsWith("adb-plugin-")) {
							continue;
						}
						readPlugin(
							path.join(scopeDir, scoped.name, "plugin.json"),
							`${entry.name}/${scoped.name}`,
						);
					}
					continue;
				}

				if (!entry.name.startsWith("adb-plugin-")) continue;
				readPlugin(
					path.join(nodeModulesDir, entry.name, "plugin.json"),
					entry.name,
				);
			}
		}

		return freshVersions.size > 0 ? freshVersions : null;
	}

	async getRegistryPluginDetails(packageName) {
		if (typeof packageName !== "string" || !packageName) return undefined;
		// Callers may pass the slug with or without the adb-plugin- prefix
		// (the dashboard strips it), while registry entries carry the full
		// name — match in either direction.
		const candidates = new Set(
			[packageName, `adb-plugin-${packageName}`, packageName.replace(/^adb-plugin-/, "")]
				.map((n) => n.toLowerCase()),
		);
		const matches = (n) => n && candidates.has(n.toLowerCase());
		const plugins = await this.fetchRegistry();
		return plugins.find((p) => matches(p.npmPackage) || matches(p.name));
	}

	async getPluginDetails(packageName) {
		if (typeof packageName !== "string" || !packageName) return undefined;
		const details = await this.getRegistryPluginDetails(packageName);
		const candidates = new Set([packageName, `adb-plugin-${packageName}`, packageName.replace(/^adb-plugin-/, "")].map((name) => name.toLowerCase()));
		const matches = (name) => typeof name === "string" && candidates.has(name.toLowerCase());

		// Local inspection retains its installed-version overlay. Install/update
		// targets and pre-install disclosure must use getRegistryPluginDetails.
		const freshVersions = await this.getFreshPluginVersions();
		if (freshVersions) {
			// Fresh versions are keyed by the full adb-plugin-* name from plugin.json.
			let freshData = freshVersions.get(packageName);
			if (!freshData) {
				for (const key of freshVersions.keys()) {
					if (matches(key)) {
						freshData = freshVersions.get(key);
						break;
					}
				}
			}
			if (freshData) {
				// Registry metadata (displayName, permissions, …) is preserved;
				// the fresh local version info overlays it.
				return details ? { ...details, ...freshData } : { ...freshData };
			}
		}

		return details;
	}
}

const registry = new PluginRegistry();

module.exports = { PluginRegistry, registry };
