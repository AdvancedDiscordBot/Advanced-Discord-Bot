const { SlashCommandBuilder, EmbedBuilder ,MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("collect")
    .setDescription("📥 Collect income from your purchased roles."),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const profile = await db.getUserProfile(interaction.user.id, interaction.guild.id);

    if (!profile.inventory || profile.inventory.length === 0) {
      return await interaction.reply({ content: "You don't own any items from the shop.", flags: [MessageFlags.Ephemeral] });
    }

    const ownedItems = await db.ShopItem.find({ guildId: interaction.guild.id, roleId: { $in: profile.inventory } });
    const incomeItems = ownedItems.filter(item => item.itemType === 'income');

    if (incomeItems.length === 0) {
      return await interaction.reply({ content: "You don't own any income-generating roles. Buy one from the `/shop`!", flags: [MessageFlags.Ephemeral] });
    }

    let totalCollected = 0;
    const collectedMessages = [];
    const cooldownMessages = [];
    const now = new Date();

    for (const item of incomeItems) {
      const cooldownEnd = profile.collectCooldowns.get(item.roleId);
      
      if (!cooldownEnd || now >= cooldownEnd) {
        // Collect income
        totalCollected += item.incomeAmount;
        const newCooldownEnd = new Date(now.getTime() + item.incomeCooldown * 1000);
        profile.collectCooldowns.set(item.roleId, newCooldownEnd);
        collectedMessages.push(`+**${item.incomeAmount}** coins from **${item.name}** role.`);
      } else {
        // On cooldown
        const timeLeft = Math.round((cooldownEnd.getTime() - now.getTime()) / 1000);
        cooldownMessages.push(`**${item.name}** is on cooldown. Available <t:${Math.round(cooldownEnd.getTime() / 1000)}:R>.`);
      }
    }

    const embed = new EmbedBuilder().setTitle("Income Collection");

    if (totalCollected > 0) {
      profile.wallet += totalCollected;
      await profile.save();
      embed.setColor("#2ECC71") // Green
           .setDescription(`You collected a total of **${totalCollected.toLocaleString()}** coins!`)
           .addFields({ name: "Collected From", value: collectedMessages.join("\n") });
    } else {
      embed.setColor("#E67E22") // Orange
           .setDescription("You have no income to collect at this time.");
    }
    
    if (cooldownMessages.length > 0) {
        embed.addFields({ name: "On Cooldown", value: cooldownMessages.join("\n") });
    }
    
    embed.addFields({ name: "New Wallet Balance", value: `**${profile.wallet.toLocaleString()}** coins` });

    await interaction.reply({ embeds: [embed] });
  },
};