/**
 * dashboard-permissions.js — the dashboard permission catalog.
 *
 * A permission is a plain string. Guild admins map their Discord roles to sets
 * of these strings (GuildRoleGrant); the permission resolver turns a member's
 * roles into the union of those sets. This module answers the other half of
 * the question: which strings exist at all.
 *
 * Two sources:
 *   - CORE_PERMISSIONS — fixed, platform-level dashboard areas.
 *   - Per-plugin — derived as `plugin.<name>.view` / `plugin.<name>.configure`
 *     for every loaded plugin, unless the plugin's manifest declares
 *     `dashboard.permissions[]`, in which case those keys are used instead.
 *
 * Manifest-declared keys are always re-namespaced under `plugin.<name>.` so a
 * plugin cannot mint a permission outside its own namespace (e.g. claim
 * `plugins.manage` and grant itself install rights).
 */

const PLUGIN_PREFIX = "plugin.";

// Platform-level permissions. These are not tied to any plugin.
const CORE_PERMISSIONS = [
	{
		key: "guild.view",
		label: "View server",
		description: "See the server dashboard, stats and leaderboard.",
	},
	{
		key: "guild.configure",
		label: "Configure server",
		description: "Change core server settings.",
	},
	{
		key: "plugins.manage",
		label: "Manage plugins",
		description: "Enable or disable installed plugins for this server.",
	},
	{
		key: "roles.manage",
		label: "Manage dashboard access",
		description:
			"Grant dashboard permissions to Discord roles in this server.",
	},
];

// Default per-plugin permissions when the manifest doesn't declare its own.
const DEFAULT_PLUGIN_ACTIONS = [
	{ action: "view", label: "View", description: "See this plugin's pages." },
	{
		action: "configure",
		label: "Configure",
		description: "Change this plugin's settings for this server.",
	},
];

function permissionKey(pluginName, action) {
	return `${PLUGIN_PREFIX}${pluginName}.${action}`;
}

/**
 * Permissions contributed by a single plugin.
 *
 * @param {string} pluginName
 * @param {object|null} manifest
 * @returns {Array<{key: string, label: string, description: string, plugin: string}>}
 */
function pluginPermissions(pluginName, manifest) {
	const displayName = manifest?.displayName || pluginName;
	const declared = manifest?.dashboard?.permissions;

	if (Array.isArray(declared) && declared.length > 0) {
		const seen = new Set();
		const out = [];
		for (const entry of declared) {
			// Accept both "reports.read" and { key, label, description }.
			const raw = typeof entry === "string" ? { key: entry } : entry;
			if (!raw || typeof raw.key !== "string" || !raw.key.trim()) continue;

			// Strip any namespace the author tried to set and re-apply our own.
			const action = raw.key.replace(/^plugin\.[^.]+\./, "").trim();
			if (!action) continue;

			const key = permissionKey(pluginName, action);
			if (seen.has(key)) continue;
			seen.add(key);

			out.push({
				key,
				label: raw.label || `${displayName}: ${action}`,
				description: raw.description || "",
				plugin: pluginName,
			});
		}
		if (out.length > 0) return out;
	}

	return DEFAULT_PLUGIN_ACTIONS.map(({ action, label, description }) => ({
		key: permissionKey(pluginName, action),
		label: `${displayName}: ${label}`,
		description,
		plugin: pluginName,
	}));
}

/**
 * The full catalog for a set of loaded plugins.
 *
 * @param {Iterable<{name: string, manifest?: object}>} plugins
 * @returns {Array<{key: string, label: string, description: string, plugin: string|null}>}
 */
function buildCatalog(plugins = []) {
	const catalog = CORE_PERMISSIONS.map((p) => ({ ...p, plugin: null }));
	const seen = new Set(catalog.map((p) => p.key));

	for (const plugin of plugins) {
		if (!plugin?.name) continue;
		for (const permission of pluginPermissions(plugin.name, plugin.manifest)) {
			if (seen.has(permission.key)) continue;
			seen.add(permission.key);
			catalog.push(permission);
		}
	}

	return catalog;
}

/**
 * Every permission key in the catalog, as a Set. Used to reject grants that
 * reference permissions no plugin actually defines.
 */
function catalogKeys(plugins = []) {
	return new Set(buildCatalog(plugins).map((p) => p.key));
}

/** The permission key that gates viewing a plugin's dashboard pages. */
function viewPermission(pluginName) {
	return permissionKey(pluginName, "view");
}

/** The permission key that gates changing a plugin's settings. */
function configurePermission(pluginName) {
	return permissionKey(pluginName, "configure");
}

module.exports = {
	CORE_PERMISSIONS,
	buildCatalog,
	catalogKeys,
	pluginPermissions,
	viewPermission,
	configurePermission,
	permissionKey,
};
