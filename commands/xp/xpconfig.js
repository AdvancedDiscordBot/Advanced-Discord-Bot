const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const Database = require("../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("xpconfig")
    .setDescription("🎯 Configure the XP and role reward system")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable or disable the XP system")
        .addBooleanOption((option) =>
          option
            .setName("enabled")
            .setDescription("Enable XP tracking")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("rates")
        .setDescription("Configure XP rates")
        .addIntegerOption((option) =>
          option
            .setName("message_xp")
            .setDescription("XP per message (1-10)")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("voice_xp")
            .setDescription("XP per voice minute (1-10)")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channels")
        .setDescription("Configure XP tracking channels")
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Action to perform")
            .addChoices(
              { name: "Add tracking channel", value: "add_track" },
              { name: "Remove tracking channel", value: "remove_track" },
              { name: "Add excluded channel", value: "add_exclude" },
              { name: "Remove excluded channel", value: "remove_exclude" },
              { name: "Clear all tracking channels", value: "clear_track" },
              { name: "Clear all excluded channels", value: "clear_exclude" }
            )
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to add/remove")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("roles")
        .setDescription("Configure automatic role rewards")
        .addBooleanOption((option) =>
          option
            .setName("enabled")
            .setDescription("Enable automatic role assignment")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("addrole")
        .setDescription("Add a role reward")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("Role to reward")
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("xp_threshold")
            .setDescription("XP required to earn this role")
            .setMinValue(1)
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("top_rank")
            .setDescription("Top N users get this role (e.g., top 5)")
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("removerole")
        .setDescription("Remove a role reward")
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("Role reward to remove")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View current XP system configuration")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reset")
        .setDescription("⚠️ Reset user data")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("What to reset")
            .addChoices(
              { name: "Daily XP for all users", value: "daily" },
              { name: "Weekly XP for all users", value: "weekly" }
            )
            .setRequired(true)
        )
    ),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established

    try {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case "enable":
          await handleEnable(interaction, db);
          break;
        case "rates":
          await handleRates(interaction, db);
          break;
        case "channels":
          await handleChannels(interaction, db);
          break;
        case "roles":
          await handleRoles(interaction, db);
          break;
        case "addrole":
          await handleAddRole(interaction, db);
          break;
        case "removerole":
          await handleRemoveRole(interaction, db);
          break;
        case "view":
          await handleView(interaction, db);
          break;
        case "reset":
          await handleReset(interaction, db);
          break;
      }
    } catch (error) {
      console.error("Error in xpconfig command:", error);
      await interaction.reply({
        content: "❌ An error occurred while processing your request.",
        ephemeral: true,
      });
    }
  },
};

async function handleEnable(interaction, db) {
  const enabled = interaction.options.getBoolean("enabled");

  await db.updateServerConfig(interaction.guild.id, { xpEnabled: enabled });

  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x00ff00 : 0xff0000)
    .setTitle("🎯 XP System Configuration")
    .setDescription(
      `XP tracking has been **${enabled ? "enabled" : "disabled"}**.`
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleRates(interaction, db) {
  const messageXp = interaction.options.getInteger("message_xp");
  const voiceXp = interaction.options.getInteger("voice_xp");

  const updateData = {};
  if (messageXp !== null) updateData.xpPerMessage = messageXp;
  if (voiceXp !== null) updateData.xpPerVoiceMinute = voiceXp;

  if (Object.keys(updateData).length === 0) {
    return await interaction.reply({
      content: "❌ Please specify at least one XP rate to update.",
      ephemeral: true,
    });
  }

  await db.updateServerConfig(interaction.guild.id, updateData);

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("🎯 XP Rates Updated")
    .setDescription("XP rates have been successfully updated!")
    .setTimestamp();

  if (messageXp !== null) {
    embed.addFields({
      name: "💬 Message XP",
      value: `${messageXp} XP per message`,
      inline: true,
    });
  }

  if (voiceXp !== null) {
    embed.addFields({
      name: "🎤 Voice XP",
      value: `${voiceXp} XP per minute`,
      inline: true,
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleChannels(interaction, db) {
  const action = interaction.options.getString("action");
  const channel = interaction.options.getChannel("channel");

  const config = await db.getServerConfig(interaction.guild.id);
  let trackingChannels = config.trackingChannels || [];
  let excludeChannels = config.excludeChannels || [];

  let message = "";

  switch (action) {
    case "add_track":
      if (!channel) {
        return await interaction.reply({
          content: "❌ Please specify a channel to add.",
          ephemeral: true,
        });
      }
      if (!trackingChannels.includes(channel.id)) {
        trackingChannels.push(channel.id);
        message = `✅ Added ${channel} to XP tracking channels.`;
      } else {
        message = `⚠️ ${channel} is already in tracking channels.`;
      }
      break;

    case "remove_track":
      if (!channel) {
        return await interaction.reply({
          content: "❌ Please specify a channel to remove.",
          ephemeral: true,
        });
      }
      trackingChannels = trackingChannels.filter((id) => id !== channel.id);
      message = `✅ Removed ${channel} from XP tracking channels.`;
      break;

    case "add_exclude":
      if (!channel) {
        return await interaction.reply({
          content: "❌ Please specify a channel to add.",
          ephemeral: true,
        });
      }
      if (!excludeChannels.includes(channel.id)) {
        excludeChannels.push(channel.id);
        message = `✅ Added ${channel} to excluded channels.`;
      } else {
        message = `⚠️ ${channel} is already excluded.`;
      }
      break;

    case "remove_exclude":
      if (!channel) {
        return await interaction.reply({
          content: "❌ Please specify a channel to remove.",
          ephemeral: true,
        });
      }
      excludeChannels = excludeChannels.filter((id) => id !== channel.id);
      message = `✅ Removed ${channel} from excluded channels.`;
      break;

    case "clear_track":
      trackingChannels = [];
      message =
        "✅ Cleared all tracking channels. XP will be tracked in all non-excluded channels.";
      break;

    case "clear_exclude":
      excludeChannels = [];
      message = "✅ Cleared all excluded channels.";
      break;
  }

  await db.updateServerConfig(interaction.guild.id, {
    trackingChannels,
    excludeChannels,
  });

  await interaction.reply({
    content: message,
    ephemeral: true,
  });
}

async function handleRoles(interaction, db) {
  const enabled = interaction.options.getBoolean("enabled");

  if (enabled !== null) {
    await db.updateServerConfig(interaction.guild.id, {
      roleAutomation: enabled,
    });

    const embed = new EmbedBuilder()
      .setColor(enabled ? 0x00ff00 : 0xff0000)
      .setTitle("🎭 Role Automation Configuration")
      .setDescription(
        `Automatic role assignment has been **${
          enabled ? "enabled" : "disabled"
        }**.`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } else {
    await interaction.reply({
      content:
        "❌ Please specify whether to enable or disable role automation.",
      ephemeral: true,
    });
  }
}

async function handleAddRole(interaction, db) {
  const role = interaction.options.getRole("role");
  const xpThreshold = interaction.options.getInteger("xp_threshold");
  const topRank = interaction.options.getInteger("top_rank");

  if (!xpThreshold && !topRank) {
    return await interaction.reply({
      content:
        "❌ Please specify either an XP threshold or top rank requirement.",
      ephemeral: true,
    });
  }

  // Check if bot can manage this role
  if (role.position >= interaction.guild.members.me.roles.highest.position) {
    return await interaction.reply({
      content:
        "❌ I cannot manage this role. Please ensure my highest role is above the reward role.",
      ephemeral: true,
    });
  }

  const config = await db.getServerConfig(interaction.guild.id);
  const roleRewards = config.roleRewards || [];

  // Remove existing reward for this role
  const filteredRewards = roleRewards.filter((r) => r.roleId !== role.id);

  // Add new reward
  const newReward = {
    roleName: role.name,
    roleId: role.id,
    xpThreshold,
    topRank,
  };

  filteredRewards.push(newReward);

  await db.updateServerConfig(interaction.guild.id, {
    roleRewards: filteredRewards,
  });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("🎭 Role Reward Added")
    .setDescription(`Successfully added ${role} as a reward role!`)
    .addFields({
      name: "📋 Reward Criteria",
      value: [
        xpThreshold
          ? `**XP Threshold:** ${xpThreshold.toLocaleString()}`
          : null,
        topRank ? `**Top Rank:** #${topRank}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      inline: false,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleRemoveRole(interaction, db) {
  const role = interaction.options.getRole("role");

  const config = await db.getServerConfig(interaction.guild.id);
  const roleRewards = config.roleRewards || [];

  const filteredRewards = roleRewards.filter((r) => r.roleId !== role.id);

  if (filteredRewards.length === roleRewards.length) {
    return await interaction.reply({
      content: `❌ ${role} is not currently a reward role.`,
      ephemeral: true,
    });
  }

  await db.updateServerConfig(interaction.guild.id, {
    roleRewards: filteredRewards,
  });

  await interaction.reply({
    content: `✅ Removed ${role} from reward roles.`,
    ephemeral: true,
  });
}

async function handleView(interaction, db) {
  await interaction.deferReply();

  const config = await db.getServerConfig(interaction.guild.id);
  const stats = await db.getServerStats(interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(0x7289da)
    .setTitle("🎯 XP System Configuration")
    .setThumbnail(interaction.guild.iconURL({ dynamic: true }));

  // Basic settings
  embed.addFields(
    {
      name: "⚙️ Basic Settings",
      value: [
        `**XP System:** ${config.xpEnabled ? "✅ Enabled" : "❌ Disabled"}`,
        `**Role Automation:** ${
          config.roleAutomation ? "✅ Enabled" : "❌ Disabled"
        }`,
        `**Message XP:** ${config.xpPerMessage || 1}`,
        `**Voice XP:** ${config.xpPerVoiceMinute || 2} per minute`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "📊 Server Statistics",
      value: [
        `**Total Users:** ${stats.totalUsers}`,
        `**Total XP:** ${stats.totalXp.toLocaleString()}`,
        `**Total Messages:** ${stats.totalMessages.toLocaleString()}`,
      ].join("\n"),
      inline: true,
    }
  );

  // Channel configuration
  const trackingChannels = config.trackingChannels || [];
  const excludeChannels = config.excludeChannels || [];

  if (trackingChannels.length > 0 || excludeChannels.length > 0) {
    let channelText = "";
    if (trackingChannels.length > 0) {
      channelText += `**Tracking:** ${trackingChannels
        .map((id) => `<#${id}>`)
        .join(", ")}\n`;
    } else {
      channelText += `**Tracking:** All channels\n`;
    }
    if (excludeChannels.length > 0) {
      channelText += `**Excluded:** ${excludeChannels
        .map((id) => `<#${id}>`)
        .join(", ")}`;
    }

    embed.addFields({
      name: "📺 Channel Configuration",
      value: channelText,
      inline: false,
    });
  }

  // Role rewards
  const roleRewards = config.roleRewards || [];
  if (roleRewards.length > 0) {
    const rolesText = roleRewards
      .map((reward) => {
        const criteria = [];
        if (reward.xpThreshold)
          criteria.push(`${reward.xpThreshold.toLocaleString()} XP`);
        if (reward.topRank) criteria.push(`Top #${reward.topRank}`);
        return `<@&${reward.roleId}> - ${criteria.join(" or ")}`;
      })
      .join("\n");

    embed.addFields({
      name: "🎭 Role Rewards",
      value: rolesText,
      inline: false,
    });
  }

  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleReset(interaction, db) {
  const type = interaction.options.getString("type");

  await interaction.deferReply();

  try {
    let result;
    if (type === "daily") {
      result = await db.resetDailyStats(interaction.guild.id);
    } else if (type === "weekly") {
      result = await db.resetWeeklyStats(interaction.guild.id);
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🔄 Reset Complete")
      .setDescription(
        `Successfully reset ${type} XP for ${result.modifiedCount} users.`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error resetting stats:", error);
    await interaction.editReply({
      content: "❌ Failed to reset stats.",
    });
  }
}
