const { SlashCommandBuilder } = require("discord.js");
const Database = require("../../utils/database");

const defaultTruths = [
  "What's the most embarrassing thing that's ever happened to you?",
  "What's your biggest fear?",
  "Who is your secret crush?",
  "What's the worst lie you've ever told?",
  "What's your most embarrassing childhood memory?",
  "If you could change one thing about yourself, what would it be?",
  "What's the weirdest dream you've ever had?",
  "What's your biggest regret?",
  "What's something you've never told your parents?",
  "Who was your first kiss?",
  "What's the most illegal thing you've ever done?",
  "What's your most irrational fear?",
  "What's the most childish thing you still do?",
  "What's a secret you've never told anyone?",
  "What's your worst habit?",
];

const defaultDares = [
  "Do 20 pushups",
  "Sing a song chosen by the group",
  "Do your best impression of a celebrity",
  "Let someone else post on your social media",
  "Eat a spoonful of hot sauce",
  "Do a silly dance for 30 seconds",
  "Call a random contact and sing them a song",
  "Let the group give you a new hairstyle",
  "Speak in an accent for the next 10 minutes",
  "Do a handstand for 30 seconds",
  "Let someone tickle you for 30 seconds",
  "Wear your clothes backwards for the rest of the game",
  "Do your best animal impression",
  "Let the group choose your profile picture for a week",
  "Text your parents 'I love you' in a funny voice",
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("truthordare")
    .setDescription("Play Truth or Dare!")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("play")
        .setDescription("Start a game of Truth or Dare")
        .addUserOption((option) =>
          option
            .setName("target")
            .setDescription("The user to ask (leave empty for yourself)")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a custom truth or dare")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Type of question/dare")
            .setRequired(true)
            .addChoices(
              { name: "Truth", value: "truth" },
              { name: "Dare", value: "dare" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("content")
            .setDescription("The truth question or dare challenge")
            .setRequired(true)
            .setMaxLength(500)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("config")
        .setDescription("Configure Truth or Dare settings (Admin only)")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Add an allowed channel")
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName("enabled")
            .setDescription("Enable/disable Truth or Dare")
            .setRequired(false)
        )
        .addIntegerOption((option) =>
          option
            .setName("cooldown")
            .setDescription("Cooldown between plays (seconds)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(300)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List custom truths and dares")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Type to list")
            .setRequired(false)
            .addChoices(
              { name: "Truth", value: "truth" },
              { name: "Dare", value: "dare" },
              { name: "Both", value: "both" }
            )
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
      switch (subcommand) {
        case "play":
          await handlePlay(interaction, db);
          break;
        case "add":
          await handleAdd(interaction, db);
          break;
        case "config":
          await handleConfig(interaction, db);
          break;
        case "list":
          await handleList(interaction, db);
          break;
      }
    } catch (error) {
      console.error("Truth or Dare command error:", error);

      const errorMessage = {
        flags: 32768, // IS_COMPONENTS_V2 flag
        components: [
          {
            type: 17, // Container
            accent_color: 0xff0000, // Red
            components: [
              {
                type: 10, // Text Display
                content:
                  "# ❌ Error\nAn error occurred while processing your Truth or Dare request.",
              },
              {
                type: 1, // Action Row
                components: [
                  {
                    type: 2, // Button
                    style: 4, // Danger
                    label: "Report Issue",
                    custom_id: `tod_report_error_${interaction.user.id}`,
                  },
                ],
              },
            ],
          },
        ],
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  },
};

async function handlePlay(interaction, db) {
  // Check if Truth or Dare is enabled and allowed in this channel
  const config = await db.TruthOrDareConfig.findOne({
    guildId: interaction.guild.id,
  });

  if (config && !config.enabled) {
    return interaction.reply({
      flags: 32768, // IS_COMPONENTS_V2 flag
      components: [
        {
          type: 17, // Container
          accent_color: 0xff0000, // Red
          components: [
            {
              type: 10, // Text Display
              content:
                "# ❌ Truth or Dare Disabled\nTruth or Dare is currently disabled in this server.",
            },
            {
              type: 1, // Action Row
              components: [
                {
                  type: 2, // Button
                  style: 2, // Secondary
                  label: "Contact Admin",
                  custom_id: `tod_contact_admin_${interaction.user.id}`,
                },
              ],
            },
          ],
        },
      ],
    });
  }

  if (
    config &&
    config.allowedChannels.length > 0 &&
    !config.allowedChannels.includes(interaction.channel.id)
  ) {
    return interaction.reply({
      flags: 32768, // IS_COMPONENTS_V2 flag
      components: [
        {
          type: 17, // Container
          accent_color: 0xff0000, // Red
          components: [
            {
              type: 10, // Text Display
              content:
                "# ❌ Channel Not Allowed\nTruth or Dare is not allowed in this channel.",
            },
          ],
        },
      ],
    });
  }

  const targetUser = interaction.options.getUser("target") || interaction.user;

  await interaction.reply({
    flags: 32768, // IS_COMPONENTS_V2 flag
    components: [
      {
        type: 17, // Container
        accent_color: 0xff6b9d, // Pink
        components: [
          {
            type: 10, // Text Display
            content: "# 🎮 Truth or Dare",
          },
          {
            type: 9, // Section
            components: [
              {
                type: 10,
                content:
                  targetUser.id === interaction.user.id
                    ? "Choose your challenge!"
                    : `${targetUser.displayName}, ${interaction.user.displayName} is asking you to choose!`,
              },
            ],
            accessory: {
              type: 11, // Thumbnail
              media: {
                url: targetUser.displayAvatarURL(),
              },
            },
          },
          {
            type: 14, // Separator
            divider: true,
            spacing: 1,
          },
          {
            type: 9, // Section
            components: [
              {
                type: 10,
                content: "**💭 Truth** - Answer a personal question honestly",
              },
              {
                type: 10,
                content: "**🎯 Dare** - Complete a fun challenge",
              },
              {
                type: 10,
                content: "**🎲 Surprise Me** - Let fate decide your challenge!",
              },
            ],
          },
          {
            type: 14, // Separator
            divider: false,
            spacing: 1,
          },
          {
            type: 1, // Action Row
            components: [
              {
                type: 2, // Button
                style: 1, // Primary
                label: "Truth",
                emoji: { name: "💭" },
                custom_id: `tod_truth_${targetUser.id}`,
              },
              {
                type: 2, // Button
                style: 4, // Danger
                label: "Dare",
                emoji: { name: "🎯" },
                custom_id: `tod_dare_${targetUser.id}`,
              },
              {
                type: 2, // Button
                style: 2, // Secondary
                label: "Surprise Me!",
                emoji: { name: "🎲" },
                custom_id: `tod_random_${targetUser.id}`,
              },
            ],
          },
          {
            type: 1, // Action Row
            components: [
              {
                type: 2, // Button
                style: 2, // Secondary
                label: "Rules",
                emoji: { name: "📋" },
                custom_id: `tod_rules_${interaction.user.id}`,
              },
              {
                type: 2, // Button
                style: 2, // Secondary
                label: "Server Stats",
                emoji: { name: "📊" },
                custom_id: `tod_stats_${interaction.guild.id}`,
              },
            ],
          },
          {
            type: 10, // Text Display
            content: `-# Game started by ${interaction.user.tag} • Have fun and stay safe!`,
          },
        ],
      },
    ],
  });
}

async function handleAdd(interaction, db) {
  const type = interaction.options.getString("type");
  const content = interaction.options.getString("content");

  // Basic content filtering
  const inappropriateWords = ["nsfw", "inappropriate", "sexual", "violent"];
  const contentLower = content.toLowerCase();

  if (inappropriateWords.some((word) => contentLower.includes(word))) {
    return interaction.reply({
      flags: 32768, // IS_COMPONENTS_V2 flag
      components: [
        {
          type: 17, // Container
          accent_color: 0xff0000, // Red
          components: [
            {
              type: 10, // Text Display
              content:
                "# ❌ Content Filtered\nYour submission contains inappropriate content and cannot be added.",
            },
            {
              type: 1, // Action Row
              components: [
                {
                  type: 2, // Button
                  style: 2, // Secondary
                  label: "Try Again",
                  custom_id: `tod_retry_add_${interaction.user.id}`,
                },
              ],
            },
          ],
        },
      ],
    });
  }

  try {
    const config = await db.TruthOrDareConfig.findOneAndUpdate(
      { guildId: interaction.guild.id },
      {
        guildId: interaction.guild.id,
        $push: {
          [type === "truth" ? "customTruths" : "customDares"]: {
            text: content,
            addedBy: interaction.user.id,
            addedAt: new Date(),
          },
        },
      },
      { upsert: true, new: true }
    );

    await interaction.reply({
      flags: 32768, // IS_COMPONENTS_V2 flag
      components: [
        {
          type: 17, // Container
          accent_color: 0x00ff00, // Green
          components: [
            {
              type: 10, // Text Display
              content:
                "# ✅ Added Successfully\nYour custom " +
                type +
                " has been added to the server!",
            },
            {
              type: 14, // Separator
              divider: true,
              spacing: 1,
            },
            {
              type: 9, // Section
              components: [
                {
                  type: 10,
                  content: `**${
                    type.charAt(0).toUpperCase() + type.slice(1)
                  }:** ${content}`,
                },
              ],
              accessory: {
                type: 2, // Button
                style: 1, // Primary
                label: "Add Another",
                custom_id: `tod_add_another_${interaction.user.id}`,
              },
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Error adding truth/dare:", error);
    throw error;
  }
}

async function handleConfig(interaction, db) {
  if (!interaction.member.permissions.has("Administrator")) {
    const noPermEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ No Permission")
      .setDescription(
        "You need Administrator permissions to configure Truth or Dare settings."
      )
      .setTimestamp();

    return interaction.reply({
      embeds: [noPermEmbed],
      flags: MessageFlags.Ephemeral,
    });
  }

  const channel = interaction.options.getChannel("channel");
  const enabled = interaction.options.getBoolean("enabled");
  const cooldown = interaction.options.getInteger("cooldown");

  try {
    const config = await db.TruthOrDareConfig.findOne({
      guildId: interaction.guild.id,
    });
    const updateData = {};

    if (channel) {
      const allowedChannels = config?.allowedChannels || [];
      if (allowedChannels.includes(channel.id)) {
        updateData.$pull = { allowedChannels: channel.id };
      } else {
        updateData.$push = { allowedChannels: channel.id };
      }
    }

    if (enabled !== null) updateData.enabled = enabled;
    if (cooldown !== null) updateData.cooldownTime = cooldown;

    if (Object.keys(updateData).length === 0) {
      // Show current config
      const configEmbed = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("🎮 Truth or Dare Configuration")
        .addFields(
          {
            name: "Status",
            value: config?.enabled !== false ? "✅ Enabled" : "❌ Disabled",
            inline: true,
          },
          {
            name: "Cooldown",
            value: `${config?.cooldownTime || 5} seconds`,
            inline: true,
          },
          {
            name: "Allowed Channels",
            value:
              config?.allowedChannels?.length > 0
                ? config.allowedChannels.map((id) => `<#${id}>`).join(", ")
                : "All channels",
            inline: false,
          }
        )
        .setTimestamp();

      return interaction.reply({
        embeds: [configEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }

    await db.TruthOrDareConfig.findOneAndUpdate(
      { guildId: interaction.guild.id },
      updateData,
      { upsert: true, new: true }
    );

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ Configuration Updated")
      .setDescription("Truth or Dare settings have been updated successfully!")
      .setTimestamp();

    await interaction.reply({
      embeds: [successEmbed],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("Error configuring truth or dare:", error);
    throw error;
  }
}

async function handleList(interaction, db) {
  const type = interaction.options.getString("type") || "both";

  try {
    const config = await db.TruthOrDareConfig.findOne({
      guildId: interaction.guild.id,
    });

    if (
      !config ||
      ((!config.customTruths || config.customTruths.length === 0) &&
        (!config.customDares || config.customDares.length === 0))
    ) {
      const emptyEmbed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("📝 No Custom Content")
        .setDescription(
          "No custom truths or dares have been added to this server yet."
        )
        .setTimestamp();

      return interaction.reply({
        embeds: [emptyEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }

    const listEmbed = new EmbedBuilder()
      .setColor("#ff6b9d")
      .setTitle("📝 Custom Truth or Dare Content")
      .setTimestamp();

    if (type === "truth" || type === "both") {
      if (config.customTruths && config.customTruths.length > 0) {
        const truthsList = config.customTruths
          .slice(0, 10)
          .map((truth, index) => `${index + 1}. ${truth.text}`)
          .join("\n");

        listEmbed.addFields({
          name: "💭 Custom Truths",
          value: truthsList || "None",
          inline: false,
        });
      }
    }

    if (type === "dare" || type === "both") {
      if (config.customDares && config.customDares.length > 0) {
        const daresList = config.customDares
          .slice(0, 10)
          .map((dare, index) => `${index + 1}. ${dare.text}`)
          .join("\n");

        listEmbed.addFields({
          name: "🎯 Custom Dares",
          value: daresList || "None",
          inline: false,
        });
      }
    }

    const totalTruths = config.customTruths?.length || 0;
    const totalDares = config.customDares?.length || 0;

    listEmbed.setFooter({
      text: `Showing up to 10 items per category • Total: ${totalTruths} truths, ${totalDares} dares`,
    });

    await interaction.reply({
      embeds: [listEmbed],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("Error listing truth or dare content:", error);
    throw error;
  }
}

// Function to get a random truth or dare
async function getRandomTruthOrDare(db, guildId, type) {
  const config = await db.TruthOrDareConfig.findOne({ guildId });

  let items = [];

  if (type === "truth") {
    items = [...defaultTruths];
    if (config && config.customTruths) {
      items.push(...config.customTruths.map((t) => t.text));
    }
  } else {
    items = [...defaultDares];
    if (config && config.customDares) {
      items.push(...config.customDares.map((d) => d.text));
    }
  }

  return items[Math.floor(Math.random() * items.length)];
}

module.exports.getRandomTruthOrDare = getRandomTruthOrDare;
