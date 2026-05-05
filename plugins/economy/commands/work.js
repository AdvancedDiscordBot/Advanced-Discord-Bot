const { SlashCommandBuilder, EmbedBuilder, Collection, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

// Cooldown collection specifically for this command
const workCooldowns = new Collection();

// A list of fun messages for the work command
const workMessages = [
    "You worked as a getaway driver and earned $_ for all that risk.",
    "You cleaned toilets all night and found $_ in a clogged drain.",
    "You sold your old socks online to a weirdo for $_.",
    "You were a professional cuddler for a day and made $_.",
    "You found a wallet on the street with $_ inside. Lucky you!",
    "You worked as a taste tester for a new brand of dog food and got paid $_.",
    "You spent the day debugging a junior developer's code and they paid you $_ in gratitude.",
    "You taught a parrot to say 'buy crypto' and sold it for $_.",
    "You won a hot-dog eating contest and the prize was $_.",
    "You rented out your pet rock as a paperweight and earned $_.",
    "You became a professional mourner at a funeral for a rich person and got $_.",
    "You found a glitch in the Matrix and extracted $_ before they patched it.",
    "You worked as a stunt double for a low-budget film and made $_.",
    "You sold your soul to a demon for $_, but bought it back for half price.",
    "You convinced a tourist you were a famous celebrity and they paid $_ for your autograph.",
    "You were a human scarecrow for a day and earned $_.",
    "You started a professional thumb wrestling league and your cut was $_.",
    "You translated 'meow' to English for a cat lady and she paid you $_.",
    "You worked as a professional line-stander for a new phone release and made $_.",
    "You found $_ in the pocket of your old jeans.",
    "You created a viral TikTok dance and made $_ from the creator fund.",
    "You helped an old lady cross the street and she gave you $_.",
    "You sold a very convincing bridge to a gullible millionaire for $_.",
    "You worked as a professional sleeper for a mattress company and they paid you $_.",
    "You were a bingo caller at a retirement home and earned $_.",
    "You counted all the grains of sand on a beach and were paid $_ for your accuracy.",
    "You ghostwrote a hit pop song and received $_ in royalties.",
    "You delivered a pizza in a blizzard and got a generous tip of $_."
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("work")
    .setDescription("💪 Work to earn some coins."),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const economySettings = await db.getGuildEconomy(interaction.guild.id);
    
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    
    // Dynamic Cooldown Logic
    const cooldownKey = `${guildId}-${userId}`;
    const cooldownTime = economySettings.workCooldown * 1000; // in milliseconds
    
    if (workCooldowns.has(cooldownKey)) {
        const expirationTime = workCooldowns.get(cooldownKey);
        if (Date.now() < expirationTime) {
            const expiredTimestamp = Math.round(expirationTime / 1000);
            return await interaction.reply({
                content: `You need to rest! You can work again <t:${expiredTimestamp}:R>.`,
                flags: [MessageFlags.Ephemeral],
            });
        }
    }

    const profile = await db.getUserProfile(userId, guildId);
    
    // Generate random amount based on server settings
    const { minWorkAmount, maxWorkAmount } = economySettings;
    const amountEarned = Math.floor(Math.random() * (maxWorkAmount - minWorkAmount + 1)) + minWorkAmount;

    // Pick a random message and replace the placeholder
    const randomMessage = workMessages[Math.floor(Math.random() * workMessages.length)];
    const workDescription = randomMessage.replace('$_', `**${amountEarned.toLocaleString()}** coins`);

    // Update wallet and set new cooldown
    profile.wallet += amountEarned;
    await profile.save();
    
    workCooldowns.set(cooldownKey, Date.now() + cooldownTime);
    setTimeout(() => workCooldowns.delete(cooldownKey), cooldownTime); // Remove after cooldown expires

    const workEmbed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle("It Ain't Much, But It's Honest Work")
      .setDescription(workDescription)
      .addFields({
        name: "New Wallet Balance",
        value: `**${profile.wallet.toLocaleString()}** coins`,
      })
      .setTimestamp();

    await interaction.reply({ embeds: [workEmbed] });
  },
};
