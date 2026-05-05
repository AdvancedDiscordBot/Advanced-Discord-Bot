const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const Database = require("../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("💰 Claim your daily points reward"),

  cooldown: 86400, // 24 hours in seconds

  async execute(interaction) {
    await interaction.deferReply();

    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    try {
      const profile = await db.getUserProfile(userId, guildId);
      const now = new Date();
      const lastDaily = profile?.lastDailyPoints || new Date(0);
      const timeDiff = now - lastDaily;
      const oneDayMs = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      // Check if user can claim daily points
      if (timeDiff < oneDayMs) {
        const nextClaimTime = new Date(lastDaily.getTime() + oneDayMs);
        const timeUntilNext = Math.ceil((nextClaimTime - now) / 1000 / 60 / 60); // hours

        return await interaction.editReply({
          content: `❌ You already claimed your daily points! Come back in **${timeUntilNext}** hours.`,
        });
      }

      // Calculate daily points (base 50, plus bonus based on level)
      const basePoints = 50;
      const levelBonus = Math.floor((profile?.level || 1) * 2);
      const totalPoints = basePoints + levelBonus;

      // Update user profile with points and last daily claim
      await db.UserProfile.findOneAndUpdate(
        { userId, guildId },
        {
          $inc: {
            points: totalPoints,
            pointsReceived: totalPoints,
          },
          $set: {
            lastDailyPoints: now,
          },
        },
        { upsert: true, new: true }
      );

      // Calculate streak bonus (future feature)
      const streak = await calculateStreak(db, userId, guildId);

      const embed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("💰 Daily Points Claimed!")
        .setDescription(`You received **${totalPoints}** points!`)
        .addFields(
          {
            name: "💎 Breakdown",
            value: [
              `Base Daily: **${basePoints}** points`,
              `Level Bonus: **${levelBonus}** points (Level ${
                profile?.level || 1
              })`,
              `Total: **${totalPoints}** points`,
            ].join("\n"),
            inline: false,
          },
          {
            name: "🔥 Current Streak",
            value: `**${streak}** days`,
            inline: true,
          },
          {
            name: "⏰ Next Claim",
            value: `<t:${Math.floor((now.getTime() + oneDayMs) / 1000)}:R>`,
            inline: true,
          }
        )
        .setFooter({
          text: `Total Points: ${(
            (profile?.points || 0) + totalPoints
          ).toLocaleString()}`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error in daily command:", error);
      await interaction.editReply({
        content: "❌ Failed to claim daily points. Please try again later.",
      });
    }
  },
};

async function calculateStreak(db, userId, guildId) {
  try {
    // This is a simplified streak calculation
    // In a full implementation, you'd track daily claim history
    const profile = await db.getUserProfile(userId, guildId);
    const lastDaily = profile?.lastDailyPoints;

    if (!lastDaily) return 1; // First time claiming

    const now = new Date();
    const daysDiff = Math.floor((now - lastDaily) / (24 * 60 * 60 * 1000));

    // If claimed yesterday, continue streak. If not, reset to 1
    return daysDiff === 1 ? (profile.dailyStreak || 1) + 1 : 1;
  } catch (error) {
    console.error("Error calculating streak:", error);
    return 1;
  }
}
