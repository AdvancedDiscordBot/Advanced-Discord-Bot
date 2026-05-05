const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const Database = require("../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("🎂 Manage birthdays in the server")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set your birthday")
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Your birthday (MM-DD format, e.g., 03-15)")
            .setRequired(true)
        )
        .addBooleanOption((option) =>
          option
            .setName("private")
            .setDescription("Keep your birthday private (default: false)")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("view")
        .setDescription("View your or someone's birthday")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription(
              "User to view birthday for (leave empty for yourself)"
            )
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List upcoming birthdays in the server")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("remove").setDescription("Remove your birthday")
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established

      switch (subcommand) {
        case "set":
          await handleSetBirthday(interaction, db);
          break;
        case "view":
          await handleViewBirthday(interaction, db);
          break;
        case "list":
          await handleListBirthdays(interaction, db);
          break;
        case "remove":
          await handleRemoveBirthday(interaction, db);
          break;
      }
    } catch (error) {
      console.error("Birthday command error:", error);

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
                  "# ❌ Error\nAn error occurred while processing your birthday request.",
              },
              {
                type: 1, // Action Row
                components: [
                  {
                    type: 2, // Button
                    style: 4, // Danger
                    label: "Report Issue",
                    custom_id: `birthday_report_error_${interaction.user.id}`,
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

async function handleSetBirthday(interaction, db) {
  const dateString = interaction.options.getString("date");
  const isPrivate = interaction.options.getBoolean("private") || false;

  // Validate date format (MM-DD)
  const dateRegex = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  if (!dateRegex.test(dateString)) {
    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Invalid Date Format")
      .setDescription("Please use MM-DD format (e.g., 03-15 for March 15th)")
      .addFields({
        name: "📅 Examples",
        value:
          "• `01-15` - January 15th\n• `12-25` - December 25th\n• `07-04` - July 4th",
        inline: false,
      })
      .setTimestamp();

    return interaction.reply({
      embeds: [errorEmbed],
      flags: 64,
    });
  }

  try {
    // Use the User model to store birthday info
    await db.User.findOneAndUpdate(
      { userId: interaction.user.id, guildId: interaction.guild.id },
      {
        $set: {
          birthday: dateString,
          birthdayPrivate: isPrivate,
        },
      },
      { upsert: true, new: true }
    );

    const [month, day] = dateString.split("-");
    const monthNames = [
      "",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🎂 Birthday Set!")
      .setDescription(
        `Your birthday has been set to **${
          monthNames[parseInt(month)]
        } ${parseInt(day)}**`
      )
      .addFields(
        {
          name: "🔒 Privacy",
          value: isPrivate ? "Private" : "Public",
          inline: true,
        },
        {
          name: "🎉 Announcements",
          value: isPrivate ? "No announcements" : "Will be announced",
          inline: true,
        }
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setFooter({ text: "Happy early birthday! 🎂" })
      .setTimestamp();

    await interaction.reply({
      embeds: [successEmbed],
      flags: 64,
    });
  } catch (error) {
    console.error("Error setting birthday:", error);
    throw error;
  }
}

async function handleViewBirthday(interaction, db) {
  const targetUser = interaction.options.getUser("user") || interaction.user;

  try {
    const userData = await db.User.findOne({
      userId: targetUser.id,
      guildId: interaction.guild.id,
    });

    if (!userData || !userData.birthday) {
      const noBirthdayEmbed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("🎂 No Birthday Set")
        .setDescription(
          targetUser.id === interaction.user.id
            ? "You haven't set your birthday yet!"
            : `${targetUser.displayName} hasn't set their birthday yet.`
        )
        .addFields({
          name: "💡 How to set",
          value: "Use `/birthday set` to set your birthday!",
          inline: false,
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [noBirthdayEmbed],
        flags: 64,
      });
    }

    if (userData.birthdayPrivate && targetUser.id !== interaction.user.id) {
      const privateEmbed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("🔒 Private Birthday")
        .setDescription(
          `${targetUser.displayName}'s birthday is set to private.`
        )
        .setTimestamp();

      return interaction.reply({
        embeds: [privateEmbed],
        flags: 64,
      });
    }

    const [month, day] = userData.birthday.split("-");
    const monthNames = [
      "",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const birthdayEmbed = new EmbedBuilder()
      .setColor("#ff6b9d")
      .setTitle("🎂 Birthday Information")
      .setDescription(
        `**${targetUser.displayName}'s** birthday is on **${
          monthNames[parseInt(month)]
        } ${parseInt(day)}**`
      )
      .addFields({
        name: "🔒 Privacy",
        value: userData.birthdayPrivate ? "Private" : "Public",
        inline: true,
      })
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp();

    await interaction.reply({
      embeds: [birthdayEmbed],
      flags: 64,
    });
  } catch (error) {
    console.error("Error viewing birthday:", error);
    throw error;
  }
}

async function handleListBirthdays(interaction, db) {
  try {
    const users = await db.User.find({
      guildId: interaction.guild.id,
      birthday: { $exists: true, $ne: null },
      birthdayPrivate: { $ne: true },
    }).limit(20);

    if (users.length === 0) {
      const noBirthdaysEmbed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("🎂 No Public Birthdays")
        .setDescription("No public birthdays have been set in this server yet.")
        .addFields({
          name: "💡 Be the first!",
          value: "Use `/birthday set` to set your birthday!",
          inline: false,
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [noBirthdaysEmbed],
        flags: 64,
      });
    }

    const monthNames = [
      "",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const birthdayList = users
      .map((user) => {
        const [month, day] = user.birthday.split("-");
        const member = interaction.guild.members.cache.get(user.userId);
        const displayName = member ? member.displayName : `<@${user.userId}>`;
        return `• **${displayName}** - ${
          monthNames[parseInt(month)]
        } ${parseInt(day)}`;
      })
      .join("\n");

    const listEmbed = new EmbedBuilder()
      .setColor("#ff6b9d")
      .setTitle("🎂 Server Birthdays")
      .setDescription(birthdayList)
      .setFooter({
        text: `${users.length} public birthday${
          users.length === 1 ? "" : "s"
        } • Private birthdays not shown`,
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [listEmbed],
      flags: 64,
    });
  } catch (error) {
    console.error("Error listing birthdays:", error);
    throw error;
  }
}

async function handleRemoveBirthday(interaction, db) {
  try {
    const result = await db.User.findOneAndUpdate(
      { userId: interaction.user.id, guildId: interaction.guild.id },
      {
        $unset: {
          birthday: "",
          birthdayPrivate: "",
        },
      },
      { new: true }
    );

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🗑️ Birthday Removed")
      .setDescription("Your birthday has been successfully removed.")
      .setTimestamp();

    await interaction.reply({
      embeds: [successEmbed],
      flags: 64,
    });
  } catch (error) {
    console.error("Error removing birthday:", error);
    throw error;
  }
}
