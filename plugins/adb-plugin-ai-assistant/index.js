"use strict";

const { UserCooldown } = require("./lib/cooldown");
const { createMessageHandler } = require("./lib/handler");

const PLUGIN_NAME = "adb-plugin-ai-assistant";

async function load(ctx) {
  const cooldown = new UserCooldown();

  // INTEGRATION SEAM: core declares the `ai:gemini-proxy` capability but does
  // not yet expose an RPC method for it (see core/capabilities.js). Until it
  // does, `ctx.ai.generate` is absent and this plugin only logs.
  const generate = ctx.ai && typeof ctx.ai.generate === "function" ? ctx.ai.generate.bind(ctx.ai) : null;
  if (!generate) ctx.logger.warn(`${PLUGIN_NAME}: ctx.ai.generate unavailable; AI replies disabled`);

  const handler = createMessageHandler({
    getConfig: (guildId) => ctx.db.getPluginConfig(guildId, PLUGIN_NAME),
    cooldown,
    ask: async (msg) => {
      if (!generate) throw new Error("AI backend not available");
      return generate({ prompt: msg.content, guildId: msg.guildId, userId: msg.author.id });
    },
    send: (channelId, payload) => ctx.discord.sendToChannel(channelId, payload),
    logger: ctx.logger,
  });

  ctx.registerEvent("messageCreate", handler);
  ctx.registerEvent("guildDelete", (guild) => {
    const id = guild?.id || guild?.guildId;
    if (id) cooldown.clearGuild(id);
  });
}

module.exports = { load };
