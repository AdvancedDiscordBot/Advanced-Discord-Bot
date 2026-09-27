const { Events } = require("discord.js");
const Database = require("../utils/database");

// Voice sessions are transient; the shipped UserProfile schema has no join-time
// fields. Weak guild keys also discard sessions when a guild leaves the client.
const voiceSessions = new WeakMap();

module.exports = {
	name: Events.VoiceStateUpdate,
	async execute(oldState, newState, client = newState.client || oldState.client) {
		const guild = newState.guild || oldState.guild;
		const member = newState.member || oldState.member;
		if (!guild || !member || member.user.bot || client?.shuttingDown) return;
		if (oldState.channelId === newState.channelId) return;
		const at = Date.now();
		let sessions = voiceSessions.get(guild);
		if (!sessions) {
			sessions = new Map();
			voiceSessions.set(guild, sessions);
		}
		let session = sessions.get(member.id);
		if (!session) {
			session = { channelId: null, joinedAt: null, work: Promise.resolve() };
			sessions.set(member.id, session);
		}

		// Database waits must not reorder a member's join/switch/leave events or
		// let two leave callbacks award the same session twice.
		const work = session.work.then(async () => {
			const manager = client?.pluginManager;
			const levels = manager?.plugins.get("adb-plugin-levels");
			if (client?.shuttingDown || (levels?.enabled && levels.loaded !== false && manager.isEnabledForGuild(guild.id, "adb-plugin-levels"))) {
				session.channelId = null;
				return;
			}
			const db = client?.db || await Database.getInstance();
			const config = await db.getServerConfig(guild.id);
			if (!config.xpEnabled || client?.shuttingDown) {
				session.channelId = null;
				return;
			}

			const minutes = session.channelId && session.channelId === oldState.channelId
				? Math.floor((at - session.joinedAt) / 60000)
				: 0;
			session.channelId = newState.channelId || null;
			session.joinedAt = newState.channelId ? at : null;
			if (minutes < 1) return;
			const xp = minutes * (config.xpPerVoiceMinute ?? 2);
			if (xp <= 0) return;
			const result = await db.addXP(member.id, guild.id, xp, "voice", `${minutes} minutes in voice chat`);
			if (result.levelUp && client?.hooks) {
				await client.hooks.emitHook("onLevelUp", {
					user: member.user, guild, guildId: guild.id, newLevel: result.newLevel, profile: result.profile,
				});
			}
		}).catch((error) => console.error("Error in voiceStateUpdate event:", error));
		session.work = work;
		await work;
		if (session.work === work && !session.channelId) sessions.delete(member.id);
	},
};
