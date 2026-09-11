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
	for (const [pluginName, state] of pluginManager.plugins) {
		const gateable = pluginManager.isGuildGateable(pluginName);
		if (gateable && !pluginManager.isEnabledForGuild(guildId, pluginName)) {
			continue;
		}
		for (const commandName of state.commandNames || []) {
			const command = client.commands.get(commandName);
			if (!command?.data) continue;
			// Worker plugins send pre-serialized plain JSON; in-repo plugins may
			// still hand over a SlashCommandBuilder.
			body.push(command.data.toJSON ? command.data.toJSON() : command.data);
		}
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
	const body = guildCommandBody(pluginManager, client, guildId);
	try {
		await guild.commands.set(body);
		logger.info(`Synced ${body.length} commands to guild ${guildId}`);
		return { ok: true, count: body.length };
	} catch (err) {
		logger.error(`Failed to sync commands to guild ${guildId}: ${err.message}`);
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
