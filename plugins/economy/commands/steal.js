const { SlashCommandBuilder, EmbedBuilder, Collection, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

// Cooldown collection to prevent spam
const stealCooldowns = new Collection();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("steal")
    .setDescription("💰 Attempt to steal coins from another user's wallet (risky).")
    .addUserOption(option =>
      option.setName("victim")
        .setDescription("The user you want to attempt to steal from.")
        .setRequired(true)
    ),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const stealer = interaction.user;
    const victim = interaction.options.getUser("victim");

    // --- Cooldown Check ---
    const cooldownKey = `${interaction.guild.id}-${stealer.id}`;
    const cooldownTime = 2 * 60 * 60 * 1000; // 1 hour in milliseconds

    if (stealCooldowns.has(cooldownKey)) {
        const expirationTime = stealCooldowns.get(cooldownKey);
        if (Date.now() < expirationTime) {
            const expiredTimestamp = Math.round(expirationTime / 1000);
            return await interaction.reply({
                content: `You're laying low after your last attempt. You can try again <t:${expiredTimestamp}:R>.`,
                flags: [MessageFlags.Ephemeral],
            });
        }
    }

    // --- Validation Checks ---
    if (victim.bot) {
      return await interaction.reply({ content: "You can't steal from a bot, they have no pockets!", flags: [MessageFlags.Ephemeral] });
    }
    if (victim.id === stealer.id) {
      return await interaction.reply({ content: "You can't steal from yourself, silly.", flags: [MessageFlags.Ephemeral] });
    }

    const stealerProfile = await db.getUserProfile(stealer.id, interaction.guild.id);
    const victimProfile = await db.getUserProfile(victim.id, interaction.guild.id);

    if (stealerProfile.wallet < 100) {
      return await interaction.reply({ content: "You need at least **100** coins in your wallet to attempt a heist.", flags: [MessageFlags.Ephemeral] });
    }
    if (victimProfile.wallet < 100) {
      return await interaction.reply({ content: `**${victim.username}** doesn't have enough coins to be worth the risk (less than 100).`, flags: [MessageFlags.Ephemeral] });
    }

    // --- Steal Logic ---
    const successChance = 0.60; // 60% chance of success
    const isSuccessful = Math.random() < successChance;

    const embed = new EmbedBuilder().setTitle(`Heist against ${victim.username}`);

    if (isSuccessful) {
      // SUCCESS: Steal a random percentage (20% to 50%) of the victim's wallet
      const stealPercentage = Math.random() * (0.5 - 0.2) + 0.2;
      const amountStolen = Math.floor(victimProfile.wallet * stealPercentage);

      stealerProfile.wallet += amountStolen;
      victimProfile.wallet -= amountStolen;

      embed.setColor("#2ECC71") // Green
           .setDescription(`✅ Success! You skillfully swiped **${amountStolen.toLocaleString()}** coins from **${victim.username}**!`);
    } else {
      // FAILURE: Stealer pays a 50% penalty of their wallet to the victim
      const penaltyAmount = Math.floor(stealerProfile.wallet * 0.50);

      stealerProfile.wallet -= penaltyAmount;
      victimProfile.wallet += penaltyAmount;

      embed.setColor("#E74C3C") // Red
           .setDescription(`❌ Failed! You were caught trying to steal from **${victim.username}**! You paid them **${penaltyAmount.toLocaleString()}** coins for your failure.`);
    }

    // Save both profiles and set cooldown
    await stealerProfile.save();
    await victimProfile.save();
    stealCooldowns.set(cooldownKey, Date.now() + cooldownTime);
    setTimeout(() => stealCooldowns.delete(cooldownKey), cooldownTime);

    await interaction.reply({ embeds: [embed] });
  },
};
