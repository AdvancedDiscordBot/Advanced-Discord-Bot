/**
 * command-sync.js — push registered commands to Discord per guild.
 *
 * Worker plugins register slash commands via RPC at load time, but that only
 * populates the in-memory `client.commands` dispatch map. Discord's API needs
 * an explicit PUT per guild — without it, plugin commands never show up in the
 * command picker (only in-repo plugin commands did, via the manual
 * deploy-commands.js scan of plugins/[name]/commands, which never sees
 * npm-installed packages).
 *
 * The per-guild set is filtered by the RBAC enable gate: a plugin's commands
 * are only installed in guilds where the plugin is enabled (or where the
 * plugin isn't gateable at all — core/in-repo/raw-client plugins run
 * unconditionally).
 */

const { createLogger } = require("./logger");
const { inspect } = require("util");

const logger = createLogger("CommandSync");

/**
 * Compute the command JSON body a guild should receive.
 * Exported for tests — takes the same inputs as syncGuildCommands.
 *
 * @param {object} pluginManager
 * @param {object} client - Discord client (commands collection)
 * @param {string} guildId
 * @returns {object[]} serialized application-command definitions
 */
function guildCommandBody(pluginManager, client, guildId) {
	const body = [];
	// Resolve ownership before filtering: a stale enabled owner must never
	// expose a disabled owner's command through a first-wins deduplication.
	const seen = new Set();
	for (const [commandName, command] of client.commands) {
		const pluginName = pluginManager.getCommandOwner(command);
		const state = pluginManager.plugins.get(pluginName);
		if (!state || state.enabled === false || state.loaded === false) continue;
		if (pluginManager.isGuildGateable(pluginName) && !pluginManager.isEnabledForGuild(guildId, pluginName)) continue;
		if (!command?.data) continue;
		if (command.guildIds !== undefined) {
			if (!Array.isArray(command.guildIds)) throw new Error(`Invalid guildIds for "${commandName}"`);
			if (!command.guildIds.includes(guildId)) continue;
		}
		const data = command.guildData === undefined
			? command.data
			: Object.prototype.hasOwnProperty.call(command.guildData || {}, guildId) && command.guildData[guildId];
		if (!data) continue;
		let definition;
		try {
			definition = JSON.parse(JSON.stringify(typeof data.toJSON === "function" ? data.toJSON() : data));
			if (!definition || definition.name !== commandName || ![1, 2, 3].includes(definition.type ?? 1)) {
				throw new Error("Invalid application-command name or type");
			}
		} catch (error) {
			throw new Error(`Cannot serialize command "${commandName}" for guild ${guildId}: ${error.message}`);
		}
		const key = `${definition.type ?? 1}:${definition.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		body.push(definition);
	}
	return body;
}

/**
 * Overwrite one guild's application commands with the gated set.
 * @returns {Promise<{ok: boolean, count?: number, error?: string}>}
 */
async function syncGuildCommands(pluginManager, client, guildId) {
	const guild = client.guilds?.cache?.get(guildId);
	if (!guild?.commands?.set) {
		return { ok: false, error: "guild unavailable" };
	}
	try {
		const body = guildCommandBody(pluginManager, client, guildId);
		await guild.commands.set(body);
		logger.info(`Synced ${body.length} commands to guild ${guildId}`);
		return { ok: true, count: body.length };
	} catch (err) {
		// Discord's "Invalid Form Body" alone is useless — the detailed
		// per-field errors live in err.rawError.errors (or err.errors).
		const detail = err.rawError?.errors || err.errors;
		logger.error(
			`Failed to sync commands to guild ${guildId}: ${err.message}`,
			detail ? inspect(detail, { depth: 4, customInspect: false, getters: false }) : "",
		);
		return { ok: false, error: err.message };
	}
}

/**
 * Sync every guild the bot is currently in. Used at startup and whenever the
 * installed/loaded plugin set changes.
 */
async function syncAllGuilds(pluginManager, client) {
	const results = [];
	for (const guild of client.guilds.cache.values()) {
		results.push(await syncGuildCommands(pluginManager, client, guild.id));
	}
	return results;
}

module.exports = { guildCommandBody, syncGuildCommands, syncAllGuilds };
