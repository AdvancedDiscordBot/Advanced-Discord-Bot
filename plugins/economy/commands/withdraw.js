const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("💸 Withdraw coins from your bank into your wallet.")
    .addStringOption((option) =>
      option
        .setName("amount")
        .setDescription(
          "The amount to withdraw, or 'all' to withdraw everything."
        )
        .setRequired(true)
    ),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const profile = await db.getUserProfile(
      interaction.user.id,
      interaction.guild.id
    );
    const amountString = interaction.options.getString("amount");

    let amountToWithdraw;

    if (amountString.toLowerCase() === "all") {
      amountToWithdraw = profile.bank;
    } else {
      amountToWithdraw = parseInt(amountString, 10);
    }

    // Validation
    if (isNaN(amountToWithdraw) || amountToWithdraw <= 0) {
      return await interaction.reply({
        content: "❌ Please provide a valid, positive number for the amount.",
        ephemeral: true,
      });
    }

    if (profile.bank < amountToWithdraw) {
      return await interaction.reply({
        content: "❌ You don't have enough coins in your bank to withdraw that much.",
        ephemeral: true,
      });
    }

    // Perform the transaction
    profile.bank -= amountToWithdraw;
    profile.wallet += amountToWithdraw;
    await profile.save();

    const withdrawEmbed = new EmbedBuilder()
      .setColor("#E67E22") // Orange color for withdrawing
      .setTitle("✅ Withdrawal Successful")
      .setDescription(
        `You have successfully withdrawn **${amountToWithdraw.toLocaleString()}** coins from your bank.`
      )
      .addFields(
        {
          name: "New Wallet Balance",
          value: `**${profile.wallet.toLocaleString()}** coins`,
          inline: true,
        },
        {
          name: "New Bank Balance",
          value: `**${profile.bank.toLocaleString()}** coins`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [withdrawEmbed] });
  },
};