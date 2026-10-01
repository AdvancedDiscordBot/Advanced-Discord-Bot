async function load(ctx) {
  ctx.logger.info("Auto-Mod Pipeline plugin loaded successfully.");

  // Register the base /automod slash command group
  ctx.registerCommand({
    data: {
      name: "automod",
      description: "Manage advanced auto-moderation rules"
    },
    async execute(interaction) {
      await interaction.reply({
        content: "Auto-mod pipeline is active. Use subcommands to configure rules.",
        ephemeral: true
      });
    }
  });

  // Message pipeline listener for checking chat content
  ctx.client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    // TODO: Build pipeline checks here
  });
}

module.exports = { load };