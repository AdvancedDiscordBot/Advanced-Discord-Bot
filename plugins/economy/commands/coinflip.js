const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin and gamble your coins.")
    .addIntegerOption(option =>
      option.setName("bet")
        .setDescription("The amount of coins you want to bet.")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(option =>
      option.setName("choice")
        .setDescription("Your choice: Heads or Tails.")
        .setRequired(true)
        .addChoices(
            { name: 'Heads', value: 'heads' },
            { name: 'Tails', value: 'tails' }
        )
    ),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const profile = await db.getUserProfile(interaction.user.id, interaction.guild.id);

    const betAmount = interaction.options.getInteger("bet");
    const userChoice = interaction.options.getString("choice");

    // Validate if the user has enough money in their wallet
    if (profile.wallet < betAmount) {
        return await interaction.reply({
            content: `❌ You don't have enough coins in your wallet! You only have **${profile.wallet.toLocaleString()}** coins.`,
            flags: [MessageFlags.Ephemeral],
        });
    }

    // Flip the coin
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const hasWon = result === userChoice;

    const embed = new EmbedBuilder()
        .setTitle('🪙 Coin Flip!');
    
    if (hasWon) {
        // User won
        profile.wallet += betAmount;
        embed.setColor("#2ECC71") // Green for win
             .setDescription(`The coin landed on **${result}**!\nYou chose correctly and won **${betAmount.toLocaleString()}** coins! 🥳`);
    } else {
        // User lost
        profile.wallet -= betAmount;
        embed.setColor("#E74C3C") // Red for loss
             .setDescription(`The coin landed on **${result}**.\nUnfortunately, you lost **${betAmount.toLocaleString()}** coins. 😢`);
    }

    // Save the updated profile to the database
    await profile.save();

    embed.addFields({
        name: "New Wallet Balance",
        value: `**${profile.wallet.toLocaleString()}** coins`
    });

    await interaction.reply({ embeds: [embed] });
  },
};