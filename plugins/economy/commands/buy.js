const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("buy")
    .setDescription("🛒 Buy a role from the shop.")
    .addStringOption(option =>
      option.setName("item")
        .setDescription("The name of the role you want to buy.")
        .setRequired(true)),
  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const itemName = interaction.options.getString("item");

    const item = await db.ShopItem.findOne({ guildId: interaction.guild.id, name: itemName });
    if (!item) {
      return await interaction.reply({ content: "❌ That item does not exist in the shop.", flags: [MessageFlags.Ephemeral] });
    }

    const profile = await db.getUserProfile(interaction.user.id, interaction.guild.id);
    if (profile.wallet < item.price) {
      return await interaction.reply({ content: `❌ You don't have enough coins. You need **${item.price.toLocaleString()}** coins to buy this.`, flags: [MessageFlags.Ephemeral] });
    }
    
    const member = interaction.member;
    if (member.roles.cache.has(item.roleId)) {
        return await interaction.reply({ content: "❌ You already own this role!", flags: [MessageFlags.Ephemeral] });
    }

    try {
        // Perform transaction
        profile.wallet -= item.price;
        profile.inventory.push(item.roleId);
        await profile.save();

        await member.roles.add(item.roleId, "Purchased from shop");

        await interaction.reply({ content: `✅ Congratulations! You have purchased the **${item.name}** role.` });
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: "❌ There was an error while trying to give you the role. Please contact an admin.", flags: [MessageFlags.Ephemeral] });
    }
  },
};