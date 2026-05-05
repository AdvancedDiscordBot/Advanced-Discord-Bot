const { Events } = require("discord.js");
const Database = require("../utils/database");

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established

    try {
      // Get server config
      const guildId = oldState.guild?.id || newState.guild?.id;
      if (!guildId) return;

      const config = await db.getServerConfig(guildId);
      if (!config.xpEnabled) return;

      const userId = oldState.member?.id || newState.member?.id;
      if (!userId) return;

      // User joined a voice channel
      if (!oldState.channelId && newState.channelId) {
        await handleVoiceJoin(userId, guildId, newState, db);
      }
      // User left a voice channel
      else if (oldState.channelId && !newState.channelId) {
        await handleVoiceLeave(userId, guildId, oldState, db, config);
      }
      // User switched voice channels
      else if (
        oldState.channelId &&
        newState.channelId &&
        oldState.channelId !== newState.channelId
      ) {
        await handleVoiceLeave(userId, guildId, oldState, db, config);
        await handleVoiceJoin(userId, guildId, newState, db);
      }
      // User muted/unmuted or deafened/undeafened
      else if (oldState.channelId === newState.channelId) {
        // Track state changes but don't award XP for just muting/unmuting
        return;
      }
    } catch (error) {
      console.error("Error in voiceStateUpdate event:", error);
    }
  },
};

async function handleVoiceJoin(userId, guildId, voiceState, db) {
  try {
    // Update user profile with voice join time
    await db.updateUserProfile(userId, guildId, {
      voiceJoinedAt: new Date(),
      currentVoiceChannelId: voiceState.channelId,
    });

    console.log(
      `👥 ${voiceState.member.user.username} joined voice channel ${voiceState.channel.name}`
    );
  } catch (error) {
    console.error("Error handling voice join:", error);
  }
}

async function handleVoiceLeave(userId, guildId, voiceState, db, config) {
  try {
    const profile = await db.getUserProfile(userId, guildId);

    if (!profile.voiceJoinedAt) return;

    // Calculate time spent in voice channel
    const joinTime = new Date(profile.voiceJoinedAt);
    const leaveTime = new Date();
    const minutesSpent = Math.floor((leaveTime - joinTime) / 60000);

    // Only award XP if user was in voice for at least 1 minute
    if (minutesSpent >= 1) {
      const xpPerMinute = config.xpPerVoiceMinute || 2;
      const totalXP = minutesSpent * xpPerMinute;

      // Add XP for voice activity
      await db.addXP(
        userId,
        guildId,
        totalXP,
        "voice",
        `${minutesSpent} minutes in voice chat`
      );

      console.log(
        `🎤 ${voiceState.member.user.username} earned ${totalXP} XP for ${minutesSpent} minutes in voice`
      );
    }

    // Clear voice tracking data
    await db.updateUserProfile(userId, guildId, {
      voiceJoinedAt: null,
      currentVoiceChannelId: null,
      lastVoiceAt: new Date(),
    });
  } catch (error) {
    console.error("Error handling voice leave:", error);
  }
}
