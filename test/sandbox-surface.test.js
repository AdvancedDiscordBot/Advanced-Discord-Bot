/**
 * Expanded isolated-plugin surface (#39) and the ai.generate proxy (#42).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { CapabilityBroker } = require("../core/rpc/broker");
const { RPC_METHODS } = require("../core/rpc/methods");
const { createShimContext } = require("../core/rpc/worker-bootstrap");

function makeBroker({ client = null, db = {} } = {}) {
	return new CapabilityBroker({ db, client, hooks: { emitHook: async () => ({}) } });
}

function recordingRpc() {
	const calls = [];
	return { calls, call: async (method, params, timeoutMs) => { calls.push({ method, params, timeoutMs }); return { ok: true }; }, on: () => () => {} };
}

test("every ctx.discord / ctx.ai shim method maps to a declared RPC method", async () => {
	const rpc = recordingRpc();
	const ctx = createShimContext(rpc, {});
	for (const fn of Object.values(ctx.discord)) await fn("a", "b", "c", "d");
	await ctx.ai.generate("g", "u", "hi");
	for (const { method } of rpc.calls) assert.ok(RPC_METHODS[method], `${method} is not in methods.js`);
});

test("shim sends the param names the broker handlers read", async () => {
	const rpc = recordingRpc();
	const { discord, ai } = createShimContext(rpc, {});
	await discord.addRole("g", "u", "r", "why");
	await discord.deleteMessage("c", "m");
	await discord.addReaction("c", "m", "✅");
	await discord.timeout("g", "u", 1000, "spam");
	await discord.ban("g", "u", "bye", 2);
	await discord.setSlowmode("c", 5);
	await discord.editMessage("c", "m", "edited");
	await ai.generate("g", "u", "hello", { systemInstruction: "sys" });
	assert.deepEqual(rpc.calls.map((c) => [c.method, c.params]), [
		["discord.addRole", { guildId: "g", userId: "u", roleId: "r", reason: "why" }],
		["discord.deleteMessage", { channelId: "c", messageId: "m" }],
		["discord.addReaction", { channelId: "c", messageId: "m", emoji: "✅" }],
		["discord.timeout", { guildId: "g", userId: "u", durationMs: 1000, reason: "spam" }],
		["discord.ban", { guildId: "g", userId: "u", reason: "bye", deleteMessageDays: 2 }],
		["discord.editChannel", { channelId: "c", rateLimitPerUser: 5, reason: undefined }],
		["discord.editMessage", { content: "edited", channelId: "c", messageId: "m" }],
		["ai.generate", { guildId: "g", userId: "u", prompt: "hello", systemInstruction: "sys" }],
	]);
	assert.equal(rpc.calls.at(-1).timeoutMs, 30000, "AI calls outlive the 10s default RPC timeout");
});

test("discord.ban bans by user id (works for users who left) and honors deleteMessageDays", async () => {
	let banned;
	const client = { guilds: { fetch: async () => ({ members: { ban: async (id, opts) => { banned = { id, opts }; } } }) } };
	const broker = makeBroker({ client });
	broker.registerCapabilities("p", { discord: ["BanMembers"] }, "P");
	const res = await broker.handleRequest("p", { id: "1", method: "discord.ban", params: { guildId: "g", userId: "u", deleteMessageDays: 9 } });
	assert.equal(res.ok, true, res.error);
	assert.deepEqual(banned, { id: "u", opts: { reason: "Plugin action", deleteMessageSeconds: 7 * 86400 } });
});

test("discord.editMessage refuses messages the bot did not send", async () => {
	const message = { id: "m", author: { id: "someone" }, edit: async () => assert.fail("must not edit") };
	const client = { user: { id: "bot" }, channels: { fetch: async () => ({ messages: { fetch: async () => message } }) } };
	const broker = makeBroker({ client });
	broker.registerCapabilities("p", { discord: ["SendMessages"] }, "P");
	const res = await broker.handleRequest("p", { id: "1", method: "discord.editMessage", params: { channelId: "c", messageId: "m", content: "x" } });
	assert.equal(res.ok, false);
	assert.match(res.error, /sent by the bot/);
});

test("discord.sendViaWebhook reuses the bot's webhook and never returns its token", async () => {
	let sent;
	const hook = { owner: { id: "bot" }, token: "secret", send: async (payload) => { sent = payload; return { id: "msg" }; } };
	const channel = { guild: {}, fetchWebhooks: async () => [{ owner: { id: "other" }, token: "x" }, hook], createWebhook: async () => assert.fail("must reuse") };
	const client = { user: { id: "bot" }, channels: { fetch: async () => channel } };
	const broker = makeBroker({ client });
	broker.registerCapabilities("p", { discord: ["ManageWebhooks"] }, "P");
	const res = await broker.handleRequest("p", { id: "1", method: "discord.sendViaWebhook", params: { channelId: "c", content: "hi", username: "Anon" } });
	assert.deepEqual(res.result, { messageId: "msg" });
	assert.deepEqual(sent, { content: "hi", username: "Anon" });
});

test("channel management RPCs refuse DM channels", async () => {
	const client = { channels: { fetch: async () => ({ id: "dm", edit: async () => assert.fail("must not edit") }) } };
	const broker = makeBroker({ client });
	broker.registerCapabilities("p", { discord: ["ManageChannels"] }, "P");
	const res = await broker.handleRequest("p", { id: "1", method: "discord.editChannel", params: { channelId: "dm", name: "x" } });
	assert.equal(res.ok, false);
	assert.match(res.error, /Guild channel not found/);
});

test("components on plugin-posted messages route by '<pluginId>:' customId prefix", () => {
	const broker = makeBroker();
	broker.registerCapabilities("adb-plugin-giveaways", {}, "Giveaways");
	assert.equal(broker.interactionOwner({ type: 3, customId: "adb-plugin-giveaways:enter", message: { id: "m" } }), "adb-plugin-giveaways");
	assert.equal(broker.interactionOwner({ type: 5, customId: "adb-plugin-giveaways:form", user: { id: "u" } }), "adb-plugin-giveaways");
	assert.equal(broker.interactionOwner({ type: 3, customId: "unknown-plugin:enter", message: { id: "m" } }), null);
	assert.equal(broker.interactionOwner({ type: 3, customId: "ticket_claim_1", message: { id: "m" } }), null);
	assert.equal(broker.interactionOwner({ type: 2, customId: "adb-plugin-giveaways:x" }), null, "slash commands don't route by prefix");
});

// ── ai.generate (#42) ────────────────────────────────────────────────────

// Each test file runs in its own process, so this doesn't leak.
process.env.GEMINI_API_KEY = "test-key";

function aiBroker(settings = {}) {
	const prompts = [];
	const broker = makeBroker({ db: { getPluginConfig: async () => ({ data: settings }) } });
	broker._genai = { models: { generateContent: async (req) => { prompts.push(req); return { text: `echo:${req.contents}` }; } } };
	broker.registerCapabilities("ai", { ai: ["gemini-proxy"] }, "AI");
	const ask = (userId, prompt = "q", guildId = "g") =>
		broker.handleRequest("ai", { id: "1", method: "ai.generate", params: { guildId, userId, prompt } }).then((r) => {
			assert.equal(r.ok, true, r.error);
			return r.result;
		});
	return { broker, ask, prompts };
}

test("ai.generate: per-user cooldown blocks the same user but not others", async () => {
	const { ask, prompts } = aiBroker();
	assert.deepEqual(await ask("alice", "one"), { text: "echo:one" });
	const blocked = await ask("alice", "two");
	assert.equal(blocked.text, null);
	assert.equal(blocked.limited, "user");
	assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 10_000, "default cooldown is 10s");
	assert.deepEqual(await ask("bob", "three"), { text: "echo:three" });
	assert.equal(prompts.length, 2, "cooldown is enforced before the Gemini call");
});

test("ai.generate: cooldown comes from the plugin's guild setting; 0 disables it", async () => {
	const { ask } = aiBroker({ ai_user_cooldown_seconds: 0 });
	assert.equal((await ask("alice")).text, "echo:q");
	assert.equal((await ask("alice")).text, "echo:q");

	const custom = aiBroker({ ai_user_cooldown_seconds: 120 });
	await custom.ask("alice");
	assert.ok((await custom.ask("alice")).retryAfterMs > 60_000);
});

test("ai.generate: concurrent spam from one user makes a single API call", async () => {
	const { ask, prompts } = aiBroker();
	const results = await Promise.all(Array.from({ length: 5 }, () => ask("spammer")));
	assert.equal(prompts.length, 1);
	assert.equal(results.filter((r) => r.limited === "user").length, 4);
});

test("ai.generate: per-guild window is the outer safety net", async () => {
	const { ask } = aiBroker({ ai_user_cooldown_seconds: 0 });
	for (let i = 0; i < 20; i++) assert.equal((await ask(`u${i}`)).limited, undefined);
	const res = await ask("late");
	assert.equal(res.limited, "guild");
	assert.equal((await ask("other-guild-user", "q", "g2")).limited, undefined, "limit is per guild");
});

test("ai.generate: fails clearly without an API key or with bad input", async () => {
	const { broker } = aiBroker();
	const saved = process.env.GEMINI_API_KEY;
	delete process.env.GEMINI_API_KEY;
	try {
		const res = await broker.handleRequest("ai", { id: "1", method: "ai.generate", params: { guildId: "g", userId: "u", prompt: "q" } });
		assert.match(res.error, /GEMINI_API_KEY/);
	} finally {
		process.env.GEMINI_API_KEY = saved;
	}
	const bad = await broker.handleRequest("ai", { id: "2", method: "ai.generate", params: { guildId: "g", prompt: "q" } });
	assert.match(bad.error, /userId/);
});
