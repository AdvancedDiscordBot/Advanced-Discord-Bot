const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("🛍️ Displays the available roles for purchase."),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const items = await db.ShopItem.find({ guildId: interaction.guild.id }).sort({ price: 1 });

    if (items.length === 0) {
      return await interaction.reply({ content: "The shop is currently empty. An admin can add items with `/shop-admin add`.", flags: [MessageFlags.Ephemeral] });
    }

    const shopEmbed = new EmbedBuilder()
      .setColor("#9B59B6")
      .setTitle(`${interaction.guild.name}'s Role Shop`)
      .setDescription("Use `/buy <item name>` to purchase a role.");

    let itemsDescription = "";
    items.forEach(item => {
      let details = `Price: **${item.price.toLocaleString()}** coins`;
      if (item.itemType === 'income') {
        const cooldownHours = item.incomeCooldown / 3600;
        details += ` | Income: **+${item.incomeAmount}** every **${cooldownHours}h**`;
      }
      itemsDescription += `**${item.name}** - <@&${item.roleId}>\n${details}\n\n`;
    });

    shopEmbed.addFields({ name: "Available Items", value: itemsDescription });
    
    await interaction.reply({ embeds: [shopEmbed] });
  },
};