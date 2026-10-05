"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  UserCooldown,
  normalizeCooldownSeconds,
} = require("../plugins/adb-plugin-ai-assistant/lib/cooldown");
const { createMessageHandler, normalizeConfig } = require("../plugins/adb-plugin-ai-assistant/lib/handler");

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test("normalizeCooldownSeconds: defaults, clamps, 0 disables", () => {
  assert.strictEqual(normalizeCooldownSeconds(undefined), 12);
  assert.strictEqual(normalizeCooldownSeconds(null), 12);
  assert.strictEqual(normalizeCooldownSeconds("abc"), 12);
  assert.strictEqual(normalizeCooldownSeconds(NaN), 12);
  assert.strictEqual(normalizeCooldownSeconds("15"), 15);
  assert.strictEqual(normalizeCooldownSeconds(7.9), 7);
  assert.strictEqual(normalizeCooldownSeconds(-5), 0);
  assert.strictEqual(normalizeCooldownSeconds(0), 0);
  assert.strictEqual(normalizeCooldownSeconds(999999), 3600);
});

test("UserCooldown: second attempt inside window is blocked, allowed after", () => {
  const now = clock();
  const cd = new UserCooldown({ now });
  assert.deepStrictEqual(cd.attempt("g", "u", 10_000), { allowed: true });
  now.advance(4_000);
  const blocked = cd.attempt("g", "u", 10_000);
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.retryAfterMs, 6_000);
  now.advance(6_000);
  assert.deepStrictEqual(cd.attempt("g", "u", 10_000), { allowed: true });
});

test("UserCooldown: users and guilds are isolated", () => {
  const cd = new UserCooldown({ now: clock() });
  cd.attempt("g1", "u1", 10_000);
  assert.strictEqual(cd.attempt("g1", "u2", 10_000).allowed, true);
  assert.strictEqual(cd.attempt("g2", "u1", 10_000).allowed, true);
  assert.strictEqual(cd.attempt("g1", "u1", 10_000).allowed, false);
});

test("UserCooldown: notice is offered once per window only", () => {
  const now = clock();
  const cd = new UserCooldown({ now });
  cd.attempt("g", "u", 10_000);
  assert.strictEqual(cd.attempt("g", "u", 10_000).shouldNotify, true);
  assert.strictEqual(cd.attempt("g", "u", 10_000).shouldNotify, false);
  now.advance(10_000);
  cd.attempt("g", "u", 10_000); // new window
  assert.strictEqual(cd.attempt("g", "u", 10_000).shouldNotify, true);
});

test("UserCooldown: cooldown 0 never blocks and stores nothing", () => {
  const cd = new UserCooldown({ now: clock() });
  for (let i = 0; i < 5; i++) assert.strictEqual(cd.attempt("g", "u", 0).allowed, true);
  assert.strictEqual(cd.size, 0);
});

test("UserCooldown: lowering the cooldown applies to users already waiting", () => {
  const now = clock();
  const cd = new UserCooldown({ now });
  cd.attempt("g", "u", 60_000);
  now.advance(5_000);
  assert.strictEqual(cd.attempt("g", "u", 60_000).allowed, false);
  assert.strictEqual(cd.attempt("g", "u", 3_000).allowed, true);
});

test("UserCooldown: clock going backwards does not lock the user out", () => {
  const now = clock();
  const cd = new UserCooldown({ now });
  cd.attempt("g", "u", 10_000);
  now.advance(-3_600_000);
  assert.strictEqual(cd.attempt("g", "u", 10_000).allowed, true);
});

test("UserCooldown: release gives the slot back", () => {
  const cd = new UserCooldown({ now: clock() });
  cd.attempt("g", "u", 10_000);
  cd.release("g", "u");
  assert.strictEqual(cd.attempt("g", "u", 10_000).allowed, true);
});

test("UserCooldown: memory is bounded and expired entries are pruned first", () => {
  const now = clock();
  const cd = new UserCooldown({ now, maxEntries: 3 });
  cd.attempt("g", "a", 1_000);
  cd.attempt("g", "b", 1_000);
  now.advance(2_000); // a and b expired
  cd.attempt("g", "c", 60_000);
  cd.attempt("g", "d", 60_000);
  assert.ok(cd.size <= 3);
  assert.strictEqual(cd.attempt("g", "c", 60_000).allowed, false);
  // Flood with live entries: cap still holds, oldest evicted.
  for (let i = 0; i < 50; i++) cd.attempt("g", `x${i}`, 60_000);
  assert.ok(cd.size <= 3);
});

test("UserCooldown: clearGuild only removes that guild", () => {
  const cd = new UserCooldown({ now: clock() });
  cd.attempt("g1", "u", 10_000);
  cd.attempt("g2", "u", 10_000);
  cd.clearGuild("g1");
  assert.strictEqual(cd.attempt("g1", "u", 10_000).allowed, true);
  assert.strictEqual(cd.attempt("g2", "u", 10_000).allowed, false);
});

test("normalizeConfig: safe defaults for missing/garbage config", () => {
  const d = normalizeConfig(undefined);
  assert.deepStrictEqual(d, { enabled: true, aiChannel: null, cooldownMs: 12_000, noticeMode: "notice" });
  assert.strictEqual(normalizeConfig({ cooldownNoticeMode: "bogus" }).noticeMode, "notice");
  assert.strictEqual(normalizeConfig({ userCooldownSeconds: "20" }).cooldownMs, 20_000);
});

// ── handler ──────────────────────────────────────────────────────────────

function setup(config = {}, askImpl) {
  const now = clock();
  const sent = [];
  const asked = [];
  const handler = createMessageHandler({
    getConfig: async () => ({ aiChannel: "chan", userCooldownSeconds: 10, ...config }),
    cooldown: new UserCooldown({ now }),
    ask: askImpl || (async (msg) => { asked.push(msg.content); return `re: ${msg.content}`; }),
    send: async (channelId, payload) => { sent.push({ channelId, ...payload }); },
    logger: { warn() {}, error() {} },
  });
  const msg = (over = {}) => ({
    guildId: "g", channelId: "chan", content: "hi", author: { id: "u", bot: false }, ...over,
  });
  return { handler, now, sent, asked, msg };
}

test("handler: rapid-fire from one user calls the model once", async () => {
  const { handler, asked, msg } = setup();
  await Promise.all([handler(msg()), handler(msg()), handler(msg())]);
  assert.strictEqual(asked.length, 1);
});

test("handler: a different user is not blocked by the spammer", async () => {
  const { handler, asked, msg } = setup();
  await handler(msg());
  await handler(msg({ author: { id: "other", bot: false } }));
  assert.strictEqual(asked.length, 2);
});

test("handler: notice mode sends exactly one wait notice per window", async () => {
  const { handler, sent, msg } = setup();
  await handler(msg());
  await handler(msg());
  await handler(msg());
  const notices = sent.filter((s) => /please wait/.test(s.content));
  assert.strictEqual(notices.length, 1);
  assert.match(notices[0].content, /<@u>/);
});

test("handler: silent mode sends no notice", async () => {
  const { handler, sent, msg } = setup({ cooldownNoticeMode: "silent" });
  await handler(msg());
  await handler(msg());
  assert.strictEqual(sent.filter((s) => /please wait/.test(s.content)).length, 0);
});

test("handler: ignores bots, other channels, DMs, empty content, disabled", async () => {
  const { handler, asked, msg } = setup();
  await handler(msg({ author: { id: "b", bot: true } }));
  await handler(msg({ channelId: "elsewhere" }));
  await handler(msg({ guildId: undefined }));
  await handler(msg({ content: "   " }));
  assert.strictEqual(asked.length, 0);
  const off = setup({ enabled: false });
  await off.handler(off.msg());
  assert.strictEqual(off.asked.length, 0);
});

test("handler: cooldown 0 disables limiting", async () => {
  const { handler, asked, msg } = setup({ userCooldownSeconds: 0 });
  await handler(msg());
  await handler(msg());
  assert.strictEqual(asked.length, 2);
});

test("handler: failed model call refunds the slot so the user can retry", async () => {
  let calls = 0;
  const { handler, msg } = setup({}, async () => { calls++; if (calls === 1) throw new Error("boom"); return "ok"; });
  await handler(msg());
  await handler(msg());
  assert.strictEqual(calls, 2);
});

test("handler: config load failure does not throw or call the model", async () => {
  const asked = [];
  const handler = createMessageHandler({
    getConfig: async () => { throw new Error("db down"); },
    cooldown: new UserCooldown(),
    ask: async (m) => { asked.push(m); return "x"; },
    send: async () => {},
    logger: { warn() {}, error() {} },
  });
  await handler({ guildId: "g", channelId: "chan", content: "hi", author: { id: "u" } });
  assert.strictEqual(asked.length, 0);
});

test("handler: a failing notice send does not break handling", async () => {
  const cd = new UserCooldown({ now: clock() });
  const handler = createMessageHandler({
    getConfig: async () => ({ aiChannel: "chan", userCooldownSeconds: 10 }),
    cooldown: cd,
    ask: async () => "ok",
    send: async (_c, p) => { if (/please wait/.test(p.content)) throw new Error("no perms"); },
    logger: { warn() {}, error() {} },
  });
  const m = { guildId: "g", channelId: "chan", content: "hi", author: { id: "u" } };
  await handler(m);
  await assert.doesNotReject(handler(m));
});
