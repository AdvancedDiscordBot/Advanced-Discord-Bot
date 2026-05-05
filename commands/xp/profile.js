const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const Database = require("../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("📊 View detailed user profile and statistics")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to view profile for (defaults to yourself)")
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const guildId = interaction.guild.id;

    try {
      // Get user profile and rank
      const [profile, rankData] = await Promise.all([
        db.getUserProfile(targetUser.id, guildId),
        db.getUserRank(targetUser.id, guildId),
      ]);

      if (!profile) {
        return await interaction.editReply({
          content: `❌ No profile data found for ${targetUser.username}.`,
        });
      }

      const userRank = rankData ? rankData.rank : "Unranked";

      // Calculate level progress
      const currentLevelXP = db.getXPRequiredForLevel(profile.level);
      const nextLevelXP = db.getXPRequiredForLevel(profile.level + 1);
      const progressXP = profile.totalXp - currentLevelXP;
      const neededXP = nextLevelXP - currentLevelXP;
      const progressPercent = Math.floor((progressXP / neededXP) * 100);

      // Create progress bar
      const progressBar = createProgressBar(progressPercent);

      const embed = new EmbedBuilder()
        .setColor(0x7289da)
        .setTitle(`📊 ${targetUser.username}'s Profile`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          {
            name: "🏆 Rank & Level",
            value: [
              `**Rank:** #${userRank}`,
              `**Level:** ${profile.level}`,
              `**Total XP:** ${profile.totalXp.toLocaleString()}`,
              `**Progress:** ${progressBar} ${progressPercent}%`,
              `**Next Level:** ${(
                nextLevelXP - profile.totalXp
              ).toLocaleString()} XP needed`,
            ].join("\n"),
            inline: false,
          },
          {
            name: "⭐ Points System",
            value: [
              `**Current Points:** ${(profile.points || 0).toLocaleString()}`,
              `**Points Given:** ${(
                profile.pointsGiven || 0
              ).toLocaleString()}`,
              `**Points Received:** ${(
                profile.pointsReceived || 0
              ).toLocaleString()}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "📈 Activity Stats",
            value: [
              `**Messages:** ${profile.messageCount.toLocaleString()}`,
              `**Voice Time:** ${formatTime(profile.voiceMinutes)}`,
              `**Activity Score:** ${profile.activityScore.toLocaleString()}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "⏰ Recent Activity",
            value: [
              `**Daily XP:** ${profile.dailyXp}`,
              `**Weekly XP:** ${profile.weeklyXp}`,
              `**Monthly XP:** ${profile.monthlyXp}`,
              profile.lastMessageAt
                ? `**Last Message:** <t:${Math.floor(
                    new Date(profile.lastMessageAt).getTime() / 1000
                  )}:R>`
                : "**Last Message:** Never",
              profile.lastVoiceAt
                ? `**Last Voice:** <t:${Math.floor(
                    new Date(profile.lastVoiceAt).getTime() / 1000
                  )}:R>`
                : "**Last Voice:** Never",
            ].join("\n"),
            inline: true,
          }
        );

      // Add moderation stats if any
      if (profile.warnings > 0 || profile.kicks > 0 || profile.bans > 0) {
        embed.addFields({
          name: "⚠️ Moderation History",
          value: [
            `**Warnings:** ${profile.warnings}`,
            `**Kicks:** ${profile.kicks}`,
            `**Bans:** ${profile.bans}`,
          ].join("\n"),
          inline: true,
        });
      }

      // Add current roles if any
      const currentRoles = profile.currentRoles || [];
      if (currentRoles.length > 0) {
        const rolesText = currentRoles
          .map(
            (r) =>
              `<@&${r.roleId}> - <t:${Math.floor(
                new Date(r.earnedAt).getTime() / 1000
              )}:R>`
          )
          .join("\n");

        embed.addFields({
          name: "🎖️ Earned Roles",
          value:
            rolesText.length > 1024
              ? rolesText.substring(0, 1020) + "..."
              : rolesText,
          inline: false,
        });
      }

      // Add member info
      const member = await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null);
      if (member) {
        embed.addFields({
          name: "👤 Member Info",
          value: [
            `**Joined Server:** <t:${Math.floor(
              member.joinedAt.getTime() / 1000
            )}:D>`,
            `**Account Created:** <t:${Math.floor(
              targetUser.createdAt.getTime() / 1000
            )}:D>`,
            `**Roles:** ${member.roles.cache.size - 1}`, // -1 to exclude @everyone
          ].join("\n"),
          inline: true,
        });
      }

      embed.setFooter({
        text: `Profile viewed by ${interaction.user.username}`,
        iconURL: interaction.user.displayAvatarURL(),
      });
      embed.setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error in profile command:", error);
      await interaction.editReply({
        content: "❌ Failed to load profile data.",
      });
    }
  },
};

function createProgressBar(percent, length = 20) {
  const filled = Math.floor((percent / 100) * length);
  const empty = length - filled;

  const fillChar = "█";
  const emptyChar = "░";

  return `${fillChar.repeat(filled)}${emptyChar.repeat(empty)}`;
}

function formatTime(minutes) {
  if (minutes < 60) {
    return `${minutes}m`;
  } else if (minutes < 1440) {
    // Less than 24 hours
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return `${days}d ${hours}h`;
  }
}
