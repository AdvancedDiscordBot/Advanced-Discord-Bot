const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("economy-setup")
    .setDescription("⚙️ Configure economy settings for this server (Admin Only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(option =>
      option.setName("min-work-amount")
        .setDescription("The minimum amount of coins users get from /work.")
        .setRequired(false)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option.setName("max-work-amount")
        .setDescription("The maximum amount of coins users get from /work.")
        .setRequired(false)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option.setName("work-cooldown")
        .setDescription("The cooldown for /work in minutes.")
        .setRequired(false)
        .setMinValue(1)
    ),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const economySettings = await db.getGuildEconomy(interaction.guild.id);

    const minWorkAmount = interaction.options.getInteger("min-work-amount");
    const maxWorkAmount = interaction.options.getInteger("max-work-amount");
    const workCooldownMinutes = interaction.options.getInteger("work-cooldown");

    const changes = [];

    // Validation to ensure min isn't higher than max
    const finalMin = minWorkAmount ?? economySettings.minWorkAmount;
    const finalMax = maxWorkAmount ?? economySettings.maxWorkAmount;

    if (finalMin > finalMax) {
        return await interaction.reply({
            content: "❌ Error: The minimum work amount cannot be greater than the maximum amount.",
            flags: [MessageFlags.Ephemeral]
        });
    }

    if (minWorkAmount !== null) {
      economySettings.minWorkAmount = minWorkAmount;
      changes.push(`Set **Minimum Work Amount** to **${minWorkAmount}** coins.`);
    }
    if (maxWorkAmount !== null) {
      economySettings.maxWorkAmount = maxWorkAmount;
      changes.push(`Set **Maximum Work Amount** to **${maxWorkAmount}** coins.`);
    }
    if (workCooldownMinutes !== null) {
      economySettings.workCooldown = workCooldownMinutes * 60; // Convert minutes to seconds
      changes.push(`Set **Work Cooldown** to **${workCooldownMinutes}** minutes.`);
    }

    if (changes.length === 0) {
      return await interaction.reply({
        content: "You must provide at least one option to configure.",
        flags: [MessageFlags.Ephemeral]
      });
    }

    await economySettings.save();

    const setupEmbed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle("✅ Economy Settings Updated")
      .setDescription(changes.join("\n"))
      .addFields(
        { name: "Current Work Range", value: `${economySettings.minWorkAmount} - ${economySettings.maxWorkAmount} coins`, inline: true },
        { name: "Current Work Cooldown", value: `${economySettings.workCooldown / 60} minutes`, inline: true }
      )
      .setFooter({ text: "More settings will be available in the future!" })
      .setTimestamp();

    await interaction.reply({ embeds: [setupEmbed] });
  },
};
