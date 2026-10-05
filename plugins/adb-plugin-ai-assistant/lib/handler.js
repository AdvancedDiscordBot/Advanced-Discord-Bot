"use strict";

const { UserCooldown, normalizeCooldownSeconds } = require("./cooldown");

const NOTICE_MODES = new Set(["silent", "notice"]);

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: cfg.enabled !== false,
    aiChannel: typeof cfg.aiChannel === "string" && cfg.aiChannel ? cfg.aiChannel : null,
    cooldownMs: normalizeCooldownSeconds(cfg.userCooldownSeconds) * 1000,
    noticeMode: NOTICE_MODES.has(cfg.cooldownNoticeMode) ? cfg.cooldownNoticeMode : "notice",
  };
}

/**
 * Build the messageCreate handler. All side effects are injected so the
 * cooldown flow is unit-testable without Discord or Gemini.
 *
 * @param {object} deps
 * @param {(guildId: string) => Promise<object>} deps.getConfig
 * @param {UserCooldown} deps.cooldown
 * @param {(msg: object, cfg: object) => Promise<string>} deps.ask   Calls the model, returns reply text.
 * @param {(channelId: string, payload: object) => Promise<any>} deps.send
 * @param {{warn: Function, error: Function}} [deps.logger]
 */
function createMessageHandler({ getConfig, cooldown, ask, send, logger = console }) {
  return async function onMessage(msg) {
    // Cheap rejections first: never spend a DB read or a cooldown slot on these.
    if (!msg || !msg.guildId || !msg.channelId || !msg.author?.id) return;
    if (msg.author.bot) return;
    if (typeof msg.content !== "string" || !msg.content.trim()) return;

    let cfg;
    try {
      cfg = normalizeConfig(await getConfig(msg.guildId));
    } catch (err) {
      logger.error?.(`ai-assistant: config load failed: ${err.message}`);
      return;
    }
    if (!cfg.enabled || !cfg.aiChannel || msg.channelId !== cfg.aiChannel) return;

    const gate = cooldown.attempt(msg.guildId, msg.author.id, cfg.cooldownMs);
    if (!gate.allowed) {
      if (cfg.noticeMode === "notice" && gate.shouldNotify) {
        const secs = Math.max(1, Math.ceil(gate.retryAfterMs / 1000));
        try {
          await send(msg.channelId, {
            content: `<@${msg.author.id}> please wait ${secs}s before asking the AI again.`,
          });
        } catch (err) {
          logger.warn?.(`ai-assistant: cooldown notice failed: ${err.message}`);
        }
      }
      return;
    }

    try {
      const text = await ask(msg, cfg);
      if (text) await send(msg.channelId, { content: text });
    } catch (err) {
      // The request never produced a reply, so don't punish the user for it.
      cooldown.release(msg.guildId, msg.author.id);
      logger.error?.(`ai-assistant: request failed: ${err.message}`);
    }
  };
}

module.exports = { createMessageHandler, normalizeConfig };
