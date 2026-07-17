/**
 * adb-plugin-template — Starter template for ADB plugins.
 *
 * This plugin works in both direct mode (main process) and isolated mode
 * (worker thread). It demonstrates the core APIs available in both modes.
 */

async function load(ctx) {
  ctx.logger.info("Template plugin loaded!");

  // ── Slash Command ──────────────────────────────────────────────────
  ctx.registerCommand({
    data: {
      name: "template-hello",
      description: "Say hello from the template plugin",
      options: [
        {
          name: "name",
          type: 3, // STRING
          description: "Your name",
          required: false,
        },
      ],
    },
    async execute(interaction) {
      const name = interaction.options.getString("name") || "World";
      await interaction.reply(`Hello, ${name}! 👋 This is the template plugin.`);
    },
  });

  // ── Event Handler ──────────────────────────────────────────────────
  // Works in both modes: in isolated mode, eventPayload is a serialized
  // object; in direct mode, it's the real Discord.js GuildMember.
  ctx.registerEvent("guildMemberAdd", async (eventPayload) => {
    try {
      const guildId = eventPayload.guildId || eventPayload.guild?.id;
      const userId = eventPayload.userId || eventPayload.user?.id || eventPayload.id;

      if (!guildId) {
        ctx.logger.warn("guildMemberAdd: could not determine guildId");
        return;
      }

      // Read plugin config (works in both modes)
      const config = await ctx.db.getPluginConfig(guildId, "adb-plugin-template");

      // Check if enabled (default: true)
      const data = config?.data || {};
      if (data.enabled === false) return;

      // Get member info via ctx.discord (works in both modes)
      const member = await ctx.discord.getMember(guildId, userId);
      const username = member?.user?.username || "someone";

      // Get the welcome channel from config
      const channelId = data.welcomeChannelId;
      if (!channelId) return;

      // Send welcome message (works in both modes)
      const message = data.welcomeMessage || `Welcome, ${username}!`;
      await ctx.discord.sendToChannel(channelId, {
        content: message.replace("{user}", `<@${userId}>`),
      });

      ctx.logger.info(`Welcomed ${username} to guild ${guildId}`);
    } catch (err) {
      ctx.logger.error("Error in guildMemberAdd handler:", err.message);
    }
  });

  // ── Hook Listener ──────────────────────────────────────────────────
  // Listen for events from other plugins (works in both modes)
  ctx.hooks.on("onPluginLoad", async ({ pluginName }) => {
    ctx.logger.info(`Another plugin loaded: ${pluginName}`);
  });

  ctx.logger.info("Template plugin ready — commands and events registered.");
}

module.exports = { load };
