const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const Database = require("../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("points")
    .setDescription("💎 Manage and view points system")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("give")
        .setDescription("Give points to another user")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("User to give points to")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription("Number of points to give (1-100)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addStringOption((option) =>
          option
            .setName("reason")
            .setDescription("Reason for giving points")
            .setRequired(false)
            .setMaxLength(200)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View points for yourself or another user")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("User to view points for (defaults to yourself)")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("leaderboard")
        .setDescription("View the points leaderboard")
        .addIntegerOption((option) =>
          option
            .setName("page")
            .setDescription("Page number (default: 1)")
            .setRequired(false)
            .setMinValue(1)
        )
    ),

  cooldown: 5,

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const guildId = interaction.guild.id;

    try {
      switch (subcommand) {
        case "give":
          await handleGivePoints(interaction, db, guildId);
          break;
        case "view":
          await handleViewPoints(interaction, db, guildId);
          break;
        case "leaderboard":
          await handlePointsLeaderboard(interaction, db, guildId);
          break;
      }
    } catch (error) {
      console.error("Error in points command:", error);
      const errorMessage =
        interaction.replied || interaction.deferred
          ? {
              content: "❌ An error occurred while processing your request.",
              ephemeral: true,
            }
          : {
              content: "❌ An error occurred while processing your request.",
              ephemeral: true,
            };

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  },
};

async function handleGivePoints(interaction, db, guildId) {
  const giver = interaction.user;
  const receiver = interaction.options.getUser("user");
  const amount = interaction.options.getInteger("amount");
  const reason =
    interaction.options.getString("reason") || "No reason provided";

  // Can't give points to yourself
  if (giver.id === receiver.id) {
    return await interaction.reply({
      content: "❌ You cannot give points to yourself!",
      ephemeral: true,
    });
  }

  // Can't give points to bots
  if (receiver.bot) {
    return await interaction.reply({
      content: "❌ You cannot give points to bots!",
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  // Get giver's profile
  const giverProfile = await db.getUserProfile(giver.id, guildId);
  if (!giverProfile || giverProfile.points < amount) {
    return await interaction.editReply({
      content: `❌ You don't have enough points! You have ${
        giverProfile?.points || 0
      } points.`,
    });
  }

  // Update both profiles
  await Promise.all([
    // Deduct points from giver
    db.UserProfile.findOneAndUpdate(
      { userId: giver.id, guildId },
      {
        $inc: {
          points: -amount,
          pointsGiven: amount,
        },
      },
      { upsert: true, new: true }
    ),
    // Add points to receiver
    db.UserProfile.findOneAndUpdate(
      { userId: receiver.id, guildId },
      {
        $inc: {
          points: amount,
          pointsReceived: amount,
        },
      },
      { upsert: true, new: true }
    ),
  ]);

  const embed = new EmbedBuilder()
    .setColor("#00ff00")
    .setTitle("💎 Points Given!")
    .setDescription(`${giver} gave **${amount}** points to ${receiver}`)
    .addFields(
      {
        name: "📝 Reason",
        value: reason,
        inline: false,
      },
      {
        name: "💰 Your Remaining Points",
        value: `${(giverProfile.points - amount).toLocaleString()}`,
        inline: true,
      }
    )
    .setFooter({
      text: `Points given by ${giver.tag}`,
      iconURL: giver.displayAvatarURL(),
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleViewPoints(interaction, db, guildId) {
  const targetUser = interaction.options.getUser("user") || interaction.user;

  await interaction.deferReply();

  const profile = await db.getUserProfile(targetUser.id, guildId);

  if (!profile) {
    return await interaction.editReply({
      content: `❌ No profile data found for ${targetUser.username}.`,
    });
  }

  const embed = new EmbedBuilder()
    .setColor("#7289da")
    .setTitle(`💎 ${targetUser.username}'s Points`)
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      {
        name: "💰 Current Points",
        value: `**${(profile.points || 0).toLocaleString()}** points`,
        inline: true,
      },
      {
        name: "📤 Points Given",
        value: `${(profile.pointsGiven || 0).toLocaleString()}`,
        inline: true,
      },
      {
        name: "📥 Points Received",
        value: `${(profile.pointsReceived || 0).toLocaleString()}`,
        inline: true,
      }
    )
    .setFooter({
      text: `Viewed by ${interaction.user.tag}`,
      iconURL: interaction.user.displayAvatarURL(),
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handlePointsLeaderboard(interaction, db, guildId) {
  const page = interaction.options.getInteger("page") || 1;
  const limit = 10;
  const skip = (page - 1) * limit;

  await interaction.deferReply();

  const topUsers = await db.UserProfile.find({ guildId })
    .sort({ points: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  if (topUsers.length === 0) {
    return await interaction.editReply({
      content: "❌ No users found with points data.",
    });
  }

  const totalUsers = await db.UserProfile.countDocuments({
    guildId,
    points: { $gt: 0 },
  });
  const totalPages = Math.ceil(totalUsers / limit);

  let description = "";
  for (let i = 0; i < topUsers.length; i++) {
    const user = topUsers[i];
    const rank = skip + i + 1;
    const medal =
      rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "💎";

    try {
      const discordUser = await interaction.client.users.fetch(user.userId);
      description += `${medal} **#${rank}** ${
        discordUser.username
      } - **${user.points.toLocaleString()}** points\n`;
    } catch (error) {
      description += `${medal} **#${rank}** Unknown User - **${user.points.toLocaleString()}** points\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor("#ffd700")
    .setTitle("🏆 Points Leaderboard")
    .setDescription(description)
    .setFooter({
      text: `Page ${page}/${totalPages} • ${totalUsers} users with points`,
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
