const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("🏆 Shows the top 10 richest users in the server."),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    await interaction.deferReply();

    // Find all profiles in the current guild
    const profiles = await db.UserProfile.find({ guildId: interaction.guild.id });

    if (!profiles || profiles.length === 0) {
      return await interaction.editReply({ content: "There are no economy profiles in this server yet!" });
    }

    // Calculate net worth (wallet + bank) for users who have money and sort
    const sortedProfiles = profiles
      .map(profile => {
        const netWorth = (profile.wallet || 0) + (profile.bank || 0);
        return { userId: profile.userId, netWorth: netWorth };
      })
      .filter(p => p.netWorth > 0) // Only include users with money
      .sort((a, b) => b.netWorth - a.netWorth)
      .slice(0, 10); // Get the top 10

    if (sortedProfiles.length === 0) {
        return await interaction.editReply({ content: "Nobody has any money yet! Use `/work` to get started." });
    }

    // Fetch user details and format the leaderboard string
    let leaderboardString = "";
    for (let i = 0; i < sortedProfiles.length; i++) {
      const profile = sortedProfiles[i];
      try {
        const user = await interaction.client.users.fetch(profile.userId);
        const rank = i + 1;
        const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
        leaderboardString += `${medals[rank] || `**${rank}.**`} <@${user.id}> - **${profile.netWorth.toLocaleString()}** coins\n`;
      } catch (error) {
        // User might not be in the server anymore, skip them
        console.warn(`Could not fetch user ${profile.userId} for leaderboard.`);
        continue;
      }
    }
    
    // Final check in case all top users left the server
    if (leaderboardString === "") {
        leaderboardString = "Could not display the leaderboard. The top users may have left the server.";
    }

    const leaderboardEmbed = new EmbedBuilder()
      .setColor("#FFD700") // Gold color
      .setTitle(`🏆 Top ${sortedProfiles.length} Richest Users in ${interaction.guild.name}`)
      .setDescription(leaderboardString)
      .setTimestamp()
      .setFooter({ text: "Who will be the richest?" });

    await interaction.editReply({ embeds: [leaderboardEmbed] });
  },
};
