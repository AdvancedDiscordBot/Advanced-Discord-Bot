"use strict";

/**
 * Per-user cooldown for AI requests.
 *
 * Keyed by `${guildId}:${userId}` so a member's cooldown in one server never
 * affects another. In-memory only: a restart resets cooldowns, which is the
 * safe direction for a rate limit (fails open for one window, never locks
 * anyone out).
 *
 * `attempt()` is check-and-reserve in a single synchronous step, so two
 * messages from the same user handled back-to-back cannot both pass.
 */

const DEFAULT_COOLDOWN_SECONDS = 12;
const MAX_COOLDOWN_SECONDS = 3600;
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * Coerce an admin-supplied value into a safe cooldown in whole seconds.
 * Dashboard values can arrive as strings, null, NaN or out-of-range numbers.
 * 0 is valid and means "cooldown disabled".
 */
function normalizeCooldownSeconds(value, fallback = DEFAULT_COOLDOWN_SECONDS) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_COOLDOWN_SECONDS, Math.max(0, Math.floor(n)));
}

class UserCooldown {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now]    Clock (ms). Injectable for tests.
   * @param {number} [opts.maxEntries]   Hard cap on tracked users (memory bound).
   */
  constructor({ now = Date.now, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this._now = now;
    this._maxEntries = Math.max(1, maxEntries);
    /** @type {Map<string, {lastAt:number, cooldownMs:number, notified:boolean}>} */
    this._entries = new Map();
  }

  static key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  get size() {
    return this._entries.size;
  }

  /**
   * Try to start an AI request for this user.
   *
   * @param {string} guildId
   * @param {string} userId
   * @param {number} cooldownMs  Current configured cooldown. 0 disables.
   * @returns {{allowed: true} | {allowed: false, retryAfterMs: number, shouldNotify: boolean}}
   *   `shouldNotify` is true at most once per cooldown window so the
   *   "please wait" notice cannot itself become a spam vector.
   */
  attempt(guildId, userId, cooldownMs) {
    if (!(cooldownMs > 0)) return { allowed: true };

    const key = UserCooldown.key(guildId, userId);
    const now = this._now();
    const entry = this._entries.get(key);

    if (entry) {
      // Compare against the *current* config so lowering the cooldown on the
      // dashboard takes effect immediately for users already on cooldown.
      const elapsed = now - entry.lastAt;
      // elapsed < 0 means the clock went backwards; treat as expired
      // rather than locking the user out until the clock catches up.
      if (elapsed >= 0 && elapsed < cooldownMs) {
        const shouldNotify = !entry.notified;
        entry.notified = true;
        return { allowed: false, retryAfterMs: cooldownMs - elapsed, shouldNotify };
      }
    }

    // Re-insert so Map iteration order stays oldest-first (used for eviction).
    this._entries.delete(key);
    this._entries.set(key, { lastAt: now, cooldownMs, notified: false });
    if (this._entries.size > this._maxEntries) this._prune(now);
    return { allowed: true };
  }

  /**
   * Give the user their slot back (e.g. the request failed before reaching
   * the model, so no quota was spent).
   */
  release(guildId, userId) {
    this._entries.delete(UserCooldown.key(guildId, userId));
  }

  /** Drop expired entries; if still over the cap, evict oldest first. */
  _prune(now = this._now()) {
    for (const [key, e] of this._entries) {
      if (now - e.lastAt >= e.cooldownMs || now < e.lastAt) this._entries.delete(key);
    }
    while (this._entries.size > this._maxEntries) {
      const oldest = this._entries.keys().next().value;
      this._entries.delete(oldest);
    }
  }

  /** Remove all tracked users for a guild (e.g. on guildDelete). */
  clearGuild(guildId) {
    const prefix = `${guildId}:`;
    for (const key of this._entries.keys()) {
      if (key.startsWith(prefix)) this._entries.delete(key);
    }
  }
}

module.exports = {
  UserCooldown,
  normalizeCooldownSeconds,
  DEFAULT_COOLDOWN_SECONDS,
  MAX_COOLDOWN_SECONDS,
};
