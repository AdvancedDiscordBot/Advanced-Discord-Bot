const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop-admin")
    .setDescription("🛍️ Manage the server's role shop (Admin Only).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommandGroup(group =>
      group.setName("add")
        .setDescription("Add an item to the shop.")
        .addSubcommand(subcommand =>
          subcommand.setName("cosmetic")
            .setDescription("Add a new cosmetic role to the shop.")
            .addStringOption(option => option.setName("name").setDescription("The name of the role.").setRequired(true))
            .addIntegerOption(option => option.setName("price").setDescription("The price of the role.").setRequired(true).setMinValue(0))
            .addStringOption(option => option.setName("color").setDescription("Hex color for the role (e.g., #5865F2).").setRequired(false))
        )
        .addSubcommand(subcommand =>
          subcommand.setName("income")
            .setDescription("Add a new income-generating role to the shop.")
            .addStringOption(option => option.setName("name").setDescription("The name of the role.").setRequired(true))
            .addIntegerOption(option => option.setName("price").setDescription("The price of the role.").setRequired(true).setMinValue(0))
            .addIntegerOption(option => option.setName("amount").setDescription("The income this role provides.").setRequired(true).setMinValue(1))
            .addNumberOption(option => option.setName("cooldown").setDescription("The cooldown in hours to collect income.").setRequired(true).setMinValue(1))
            .addStringOption(option => option.setName("color").setDescription("Hex color for the role (e.g., #5865F2).").setRequired(false))
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName("delete")
        .setDescription("Delete an item from the shop.")
        .addRoleOption(option => option.setName("role").setDescription("The role to remove from the shop.").setRequired(true))
    ),
    // Edit command can be expanded later if needed

  async execute(interaction) {
    const db = await Database.getInstance();
await db.ensureConnection(); // Ensure connection is established
    const subcommand = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup();

    const hexColorRegex = /^#[0-9A-F]{6}$/i;

    if (group === "add") {
      const name = interaction.options.getString("name");
      const price = interaction.options.getInteger("price");
      const color = interaction.options.getString("color") || 'Random';
      
      if (color !== 'Random' && !hexColorRegex.test(color)) {
        return interaction.reply({ content: "❌ Invalid hex color. Use a format like `#5865F2`.", flags: [MessageFlags.Ephemeral] });
      }

      const existingItem = await db.ShopItem.findOne({ guildId: interaction.guild.id, name: name });
      if (existingItem) {
        return interaction.reply({ content: "❌ An item with this name already exists.", flags: [MessageFlags.Ephemeral] });
      }

      try {
        const newRole = await interaction.guild.roles.create({ name, color, reason: `Shop item added by ${interaction.user.tag}` });
        
        let newItemData = {
          guildId: interaction.guild.id,
          roleId: newRole.id,
          name: name,
          price: price,
        };

        if (subcommand === 'cosmetic') {
          newItemData.itemType = 'cosmetic';
          await new db.ShopItem(newItemData).save();
          await interaction.reply({ content: `✅ Added **${name}** (Cosmetic) to the shop for **${price}** coins.` });
        } else if (subcommand === 'income') {
          const amount = interaction.options.getInteger("amount");
          const cooldownHours = interaction.options.getNumber("cooldown");
          
          newItemData.itemType = 'income';
          newItemData.incomeAmount = amount;
          newItemData.incomeCooldown = cooldownHours * 3600; // Convert hours to seconds
          
          await new db.ShopItem(newItemData).save();
          await interaction.reply({ content: `✅ Added **${name}** (Income Role) to the shop for **${price}** coins. It will generate **${amount}** coins every **${cooldownHours}** hours.` });
        }

      } catch (error) {
        console.error(error);
        await interaction.reply({ content: "❌ Failed to create the role. Do I have 'Manage Roles' permissions?", flags: [MessageFlags.Ephemeral] });
      }
    } else if (subcommand === "delete") {
      const role = interaction.options.getRole("role");
      const item = await db.ShopItem.findOne({ guildId: interaction.guild.id, roleId: role.id });
      if (!item) {
        return interaction.reply({ content: "❌ That role is not in the shop.", flags: [MessageFlags.Ephemeral] });
      }

      try {
        await role.delete("Shop item removed.");
        await db.ShopItem.deleteOne({ _id: item._id });
        await interaction.reply({ content: `✅ Deleted **${item.name}** from the shop.` });
      } catch (error) {
        console.error(error);
        await interaction.reply({ content: "❌ Failed to delete the role. Is my role above the shop roles?", flags: [MessageFlags.Ephemeral] });
      }
    }
  },
};