const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const Database = require("../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roles")
    .setDescription("🎭 View your available role rewards and current progress")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View your available roles and progress")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("claim")
        .setDescription("Claim your available role rewards")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("leaderboard")
        .setDescription("View the server leaderboard")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Leaderboard type")
            .addChoices(
              { name: "🏆 Total XP", value: "totalXp" },
              { name: "💬 Messages", value: "messageCount" },
              { name: "🎤 Voice Time", value: "voiceMinutes" },
              { name: "⚡ Activity Score", value: "activityScore" }
            )
            .setRequired(false)
        )
    ),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established

    try {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case "view":
          await handleViewRoles(interaction, db);
          break;
        case "claim":
          await handleClaimRoles(interaction, db);
          break;
        case "leaderboard":
          await handleLeaderboard(interaction, db);
          break;
      }
    } catch (error) {
      console.error("Error in roles command:", error);
      await interaction.reply({
        content: "❌ An error occurred while processing your request.",
        ephemeral: true,
      });
    }
  },
};

async function handleViewRoles(interaction, db) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    // Get user profile and server config
    const [profile, config] = await Promise.all([
      db.getUserProfile(userId, guildId),
      db.getServerConfig(guildId),
    ]);

    if (
      !config.roleAutomation ||
      !config.roleRewards ||
      config.roleRewards.length === 0
    ) {
      return await interaction.editReply({
        content: "❌ Role automation is not enabled on this server.",
      });
    }

    // Get user's current rank
    const rankData = await db.getUserRank(userId, guildId);
    const userRank = rankData ? rankData.rank : "Unranked";

    // Check eligible roles
    const roleCheck = await db.checkRoleRewards(userId, guildId);

    const embed = new EmbedBuilder()
      .setColor(0x7289da)
      .setTitle("🎭 Your Role Rewards Progress")
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .addFields({
        name: "📊 Your Stats",
        value: `**Level:** ${profile.level}\n**Total XP:** ${profile.totalXp}\n**Rank:** #${userRank}\n**Messages:** ${profile.messageCount}\n**Voice Time:** ${profile.voiceMinutes} minutes`,
        inline: true,
      });

    // Show available role rewards
    if (config.roleRewards.length > 0) {
      let rolesText = "";

      for (const reward of config.roleRewards) {
        const role = interaction.guild.roles.cache.get(reward.roleId);
        if (!role) continue;

        let status = "❌ Not eligible";
        let progress = "";

        // Check XP threshold
        if (reward.xpThreshold) {
          if (profile.totalXp >= reward.xpThreshold) {
            status = "✅ Eligible";
          } else {
            const needed = reward.xpThreshold - profile.totalXp;
            progress = ` (need ${needed} more XP)`;
          }
        }

        // Check top rank requirement
        if (reward.topRank) {
          if (userRank <= reward.topRank && userRank !== "Unranked") {
            status = "✅ Eligible";
          } else {
            progress = ` (need to be top ${reward.topRank})`;
          }
        }

        rolesText += `${role} - ${status}${progress}\n`;
      }

      embed.addFields({
        name: "🏆 Available Role Rewards",
        value: rolesText || "No role rewards configured.",
        inline: false,
      });
    }

    // Show current roles
    const currentRoles = profile.currentRoles || [];
    if (currentRoles.length > 0) {
      const currentRolesText = currentRoles
        .map(
          (r) =>
            `<@&${r.roleId}> - earned <t:${Math.floor(
              new Date(r.earnedAt).getTime() / 1000
            )}:R>`
        )
        .join("\n");

      embed.addFields({
        name: "🎖️ Your Current Reward Roles",
        value: currentRolesText,
        inline: false,
      });
    }

    embed.setFooter({
      text: "Use /roles claim to claim eligible roles",
      iconURL: interaction.client.user.displayAvatarURL(),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error viewing roles:", error);
    await interaction.editReply({
      content: "❌ Failed to load role information.",
    });
  }
}

async function handleClaimRoles(interaction, db) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const member = interaction.member;

    // Check eligible roles
    const roleCheck = await db.checkRoleRewards(userId, guildId);

    if (roleCheck.eligibleRoles.length === 0) {
      return await interaction.editReply({
        content: "❌ You don't have any eligible roles to claim at the moment.",
      });
    }

    const currentRoleIds = member.roles.cache.map((role) => role.id);
    const rolesToClaim = roleCheck.eligibleRoles.filter(
      (r) =>
        !currentRoleIds.includes(r.roleId) &&
        interaction.guild.roles.cache.has(r.roleId)
    );

    if (rolesToClaim.length === 0) {
      return await interaction.editReply({
        content: "✅ You already have all eligible roles!",
      });
    }

    // Add roles to user
    let claimedRoles = [];
    let failedRoles = [];

    for (const reward of rolesToClaim) {
      try {
        const role = interaction.guild.roles.cache.get(reward.roleId);
        if (
          role &&
          role.position < interaction.guild.members.me.roles.highest.position
        ) {
          await member.roles.add(role);
          claimedRoles.push(reward);
        } else {
          failedRoles.push(reward);
        }
      } catch (error) {
        console.error(`Error adding role ${reward.roleId}:`, error);
        failedRoles.push(reward);
      }
    }

    // Update database
    if (claimedRoles.length > 0) {
      await db.updateUserRoles(userId, guildId, [
        ...roleCheck.currentRoles,
        ...claimedRoles,
      ]);
    }

    // Send response
    const embed = new EmbedBuilder()
      .setColor(claimedRoles.length > 0 ? 0x00ff00 : 0xff0000)
      .setTitle("🎭 Role Claim Results")
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }));

    if (claimedRoles.length > 0) {
      const claimedText = claimedRoles
        .map((r) => `<@&${r.roleId}> - ${r.roleName}`)
        .join("\n");

      embed.addFields({
        name: "✅ Successfully Claimed",
        value: claimedText,
        inline: false,
      });
    }

    if (failedRoles.length > 0) {
      const failedText = failedRoles
        .map((r) => `<@&${r.roleId}> - ${r.roleName}`)
        .join("\n");

      embed.addFields({
        name: "❌ Failed to Claim",
        value: failedText + "\n*Contact a moderator for assistance*",
        inline: false,
      });
    }

    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error claiming roles:", error);
    await interaction.editReply({
      content: "❌ Failed to claim roles. Please try again.",
    });
  }
}

async function handleLeaderboard(interaction, db) {
  await interaction.deferReply();

  try {
    const type = interaction.options.getString("type") || "totalXp";
    const guildId = interaction.guild.id;

    const topUsers = await db.getTopUsers(guildId, 10, type);

    if (topUsers.length === 0) {
      return await interaction.editReply({
        content: "❌ No user data found for this server.",
      });
    }

    const typeEmojis = {
      totalXp: "🏆",
      messageCount: "💬",
      voiceMinutes: "🎤",
      activityScore: "⚡",
    };

    const typeNames = {
      totalXp: "Total XP",
      messageCount: "Messages Sent",
      voiceMinutes: "Voice Minutes",
      activityScore: "Activity Score",
    };

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`${typeEmojis[type]} ${typeNames[type]} Leaderboard`)
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }));

    let leaderboardText = "";

    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i];
      const rankEmoji =
        i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      const value = user[type];
      const displayValue =
        type === "voiceMinutes" ? `${value} min` : value.toLocaleString();

      leaderboardText += `${rankEmoji} <@${user.userId}> - **${displayValue}**\n`;
    }

    embed.setDescription(leaderboardText);

    // Get user's rank if they're not in top 10
    const userRank = await db.getUserRank(interaction.user.id, guildId, type);
    if (userRank && userRank.rank > 10) {
      embed.addFields({
        name: "📍 Your Position",
        value: `Rank #${userRank.rank} - **${userRank.user[
          type
        ].toLocaleString()}**`,
        inline: false,
      });
    }

    embed.setFooter({
      text: `Updated ${new Date().toLocaleString()}`,
      iconURL: interaction.client.user.displayAvatarURL(),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error showing leaderboard:", error);
    await interaction.editReply({
      content: "❌ Failed to load leaderboard.",
    });
  }
}
