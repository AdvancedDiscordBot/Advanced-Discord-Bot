const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("deposit")
    .setDescription("🏦 Deposit coins from your wallet into the bank.")
    .addStringOption((option) =>
      option
        .setName("amount")
        .setDescription(
          "The amount to deposit, or 'all' to deposit everything."
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

    let amountToDeposit;

    if (amountString.toLowerCase() === "all") {
      amountToDeposit = profile.wallet;
    } else {
      amountToDeposit = parseInt(amountString, 10);
    }

    // Validation
    if (isNaN(amountToDeposit) || amountToDeposit <= 0) {
      return await interaction.reply({
        content: "❌ Please provide a valid, positive number for the amount.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (profile.wallet < amountToDeposit) {
      return await interaction.reply({
        content: "❌ You don't have enough coins in your wallet to deposit that much.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Perform the transaction
    profile.wallet -= amountToDeposit;
    profile.bank += amountToDeposit;
    await profile.save();

    const depositEmbed = new EmbedBuilder()
      .setColor("#3498DB") // Blue color for banking
      .setTitle("✅ Deposit Successful")
      .setDescription(
        `You have successfully deposited **${amountToDeposit.toLocaleString()}** coins into your bank.`
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

    await interaction.reply({ embeds: [depositEmbed] });
  },
};