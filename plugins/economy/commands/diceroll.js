const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    // V V V CHANGE THIS LINE V V V
    .setName("diceroll") 
    .setDescription("🎲 Roll a die and bet on the outcome (1 in 6 chance to win).")
    .addIntegerOption(option =>
      option.setName("bet")
        .setDescription("The amount of coins you want to bet.")
        .setRequired(true)
        .setMinValue(1)
    )
    .addIntegerOption(option =>
      option.setName("number")
        .setDescription("The number you are betting on (from 1 to 6).")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(6)
    ),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const profile = await db.getUserProfile(interaction.user.id, interaction.guild.id);

    const betAmount = interaction.options.getInteger("bet");
    const userNumber = interaction.options.getInteger("number");

    // Validate if the user has enough money in their wallet
    if (profile.wallet < betAmount) {
        return await interaction.reply({
            content: `❌ You can't bet more than you have! You only have **${profile.wallet.toLocaleString()}** coins in your wallet.`,
            flags: [MessageFlags.Ephemeral],
        });
    }

    // Roll the die
    const dieResult = Math.floor(Math.random() * 6) + 1;
    const hasWon = dieResult === userNumber;
    
    // The payout for winning is 5 times the bet
    const winnings = betAmount * 5;

    const embed = new EmbedBuilder()
        .setTitle('🎲 Die Roll!');
    
    if (hasWon) {
        // User won
        profile.wallet += winnings;
        embed.setColor("#FFD700") // Gold for a big win
             .setDescription(`The die landed on **${dieResult}**!\nYou guessed correctly and won **${winnings.toLocaleString()}** coins! 🎉`);
    } else {
        // User lost
        profile.wallet -= betAmount;
        embed.setColor("#E74C3C") // Red for loss
             .setDescription(`The die landed on **${dieResult}**.\nBad luck! You lost your bet of **${betAmount.toLocaleString()}** coins. 😞`);
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
