const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");
const Database = require("../utils/database");
const TaskScheduler = require("../utils/scheduler");
const { UserProfile } = require("../models/schemas");
const messages = require("../events/messageCreate");
const voice = require("../events/voiceStateUpdate");
const joins = require("../events/guildMemberAdd");

function fixture(t) {
	t.mock.method(console, "log", () => {});
	const errors = t.mock.method(console, "error", () => {});
	const config = { xpEnabled: true, xpPerMessage: 3, xpPerVoiceMinute: 2, roleAutomation: false, birthdayEnabled: false };
	const hooks = [];
	const awards = [];
	const writes = [];
	const sent = [];
	const guild = { id: "guild", name: "Guild", memberCount: 2 };
	const user = { id: "user", username: "User", tag: "User#0001", bot: false, createdTimestamp: 1, displayAvatarURL: () => "https://example.test/avatar.png" };
	const member = { id: user.id, user, guild, roles: { cache: new Collection() } };
	const channel = { id: "channel", name: "general", type: 0, permissionsFor: () => ({ has: () => true }), send: async (payload) => { sent.push(payload); return { react: async () => {} }; } };
	guild.channels = { cache: new Collection([[channel.id, channel]]) };
	guild.members = { cache: new Collection([[user.id, member]]) };
	// Use the shipped schema: unknown voiceJoinedAt/currentVoiceChannelId writes
	// are discarded by Mongoose, so the fallback cannot depend on those fields.
	const profile = new UserProfile({ userId: user.id, guildId: guild.id });
	const db = {
		ensureConnection: async () => {},
		getServerConfig: async () => config,
		getUserProfile: async () => profile,
		updateUserProfile: async (_user, _guild, data) => {
			writes.push(data);
			for (const [key, value] of Object.entries(data)) {
				if (UserProfile.schema.path(key)) profile.set(key, value);
			}
		},
		addXP: async (...args) => {
			awards.push(args);
			return { levelUp: true, oldLevel: 1, newLevel: 2, profile: { totalXp: 100, messageCount: 1 } };
		},
		Birthday: { find: async () => [] },
		ServerConfig: { findOne: async () => config },
	};
	t.mock.method(Database, "getInstance", async () => db);
	const client = {
		db, user, colors: { success: "#00ff00" }, guilds: { cache: new Collection([[guild.id, guild]]) },
		pluginManager: { plugins: new Map(), isEnabledForGuild: () => true },
		hooks: { emitHook: async (name, payload) => { hooks.push({ name, payload }); return { cancelled: false, payload }; } },
	};
	const message = { author: user, guild, channel, member };
	const disconnected = { guild, member, channelId: null };
	const connected = { guild, member, channelId: "voice", channel: { name: "Voice" } };
	return { client, config, db, profile, member, message, disconnected, connected, hooks, awards, writes, sent, errors };
}

test("core events: no unsolicited welcome, including when a welcome plugin owns onboarding", async (t) => {
	const h = fixture(t);
	t.mock.method(require("node-cron"), "schedule", () => ({ start() {}, stop() {} }));
	h.client.scheduler = new TaskScheduler(h.client, { env: {} });
	t.after(() => h.client.scheduler.shutdown());
	await joins.execute(h.member, h.client);
	h.client.pluginManager.plugins.set("adb-plugin-welcome", { enabled: true });
	await joins.execute(h.member, h.client);
	assert.deepEqual(h.sent, []);
});

test("core events: active levels plugin owns XP without suppressing message hooks", async (t) => {
	const h = fixture(t);
	h.client.pluginManager.plugins.set("adb-plugin-levels", { enabled: true });
	await messages.execute(h.message, h.client);
	assert.deepEqual(h.awards, []);
	assert.deepEqual(h.writes, []);
	assert.deepEqual(h.hooks.map((hook) => hook.name), ["beforeMessage", "afterMessage"]);
});

test("core events: configured message XP remains when levels is absent, disabled, or guild-gated off", async (t) => {
	const h = fixture(t);
	await messages.execute(h.message, h.client);
	h.client.pluginManager.plugins.set("adb-plugin-levels", { enabled: false });
	await messages.execute(h.message, h.client);
	h.client.pluginManager.plugins.set("adb-plugin-levels", { enabled: true });
	h.client.pluginManager.isEnabledForGuild = () => false;
	await messages.execute(h.message, h.client);
	assert.equal(h.awards.length, 3);
	assert.ok(h.awards.every((args) => args[2] === 3));
	const levelUp = h.hooks.find((hook) => hook.name === "onLevelUp");
	assert.equal(levelUp.payload.guild, h.message.guild);
	assert.equal(levelUp.payload.guildId, "guild");
	assert.equal(levelUp.payload.user, h.member.user);
});

test("core events: a still-loading levels plugin does not disable the core fallback", async (t) => {
	const h = fixture(t);
	h.client.pluginManager.plugins.set("adb-plugin-levels", { enabled: true, loaded: false });
	await messages.execute(h.message, h.client);
	assert.equal(h.awards.length, 1);
	t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 19, 12) });
	await voice.execute(h.disconnected, h.connected, h.client);
	t.mock.timers.tick(60000);
	await voice.execute(h.connected, h.disconnected, h.client);
	assert.equal(h.awards.length, 2);
});

test("core events: disabled XP, cooldowns, channel filters, bots, and DMs do not award core XP", async (t) => {
	const h = fixture(t);
	h.config.xpEnabled = false;
	await messages.execute(h.message, h.client);
	h.config.xpEnabled = true;
	h.config.excludeChannels = ["channel"];
	await messages.execute(h.message, h.client);
	h.config.excludeChannels = [];
	h.config.trackingChannels = ["another-channel"];
	await messages.execute(h.message, h.client);
	h.config.trackingChannels = [];
	h.profile.lastMessageAt = new Date();
	await messages.execute(h.message, h.client);
	await messages.execute({ ...h.message, guild: null }, h.client);
	await messages.execute({ ...h.message, author: { ...h.member.user, bot: true } }, h.client);
	assert.deepEqual(h.awards, []);
});

test("core events: voice fallback works with the shipped profile schema and consumes each session once", async (t) => {
	const h = fixture(t);
	t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 19, 12) });
	await voice.execute(h.disconnected, h.connected, h.client);
	t.mock.timers.tick(120000);
	await voice.execute(h.connected, h.disconnected, h.client);
	await voice.execute(h.connected, h.disconnected, h.client);
	assert.equal(h.awards.length, 1);
	assert.equal(h.awards[0][2], 4);
	assert.equal(h.awards[0][3], "voice");
	assert.equal(h.hooks.find((hook) => hook.name === "onLevelUp")?.payload.guild, h.member.guild);
});

test("core events: channel switching splits voice sessions without awarding mute changes", async (t) => {
	const h = fixture(t);
	t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 19, 12) });
	await voice.execute(h.disconnected, h.connected, h.client);
	t.mock.timers.tick(120000);
	const nextChannel = { ...h.connected, channelId: "another-voice" };
	await voice.execute(h.connected, nextChannel, h.client);
	await voice.execute(nextChannel, { ...nextChannel, selfMute: true }, h.client);
	t.mock.timers.tick(60000);
	await voice.execute(nextChannel, h.disconnected, h.client);
	assert.deepEqual(h.awards.map((args) => args[2]), [4, 2]);
});

test("core events: active levels plugin, disabled XP, bots, and shutdown suppress voice fallback", async (t) => {
	const h = fixture(t);
	h.client.pluginManager.plugins.set("adb-plugin-levels", { enabled: true });
	await voice.execute(h.disconnected, h.connected, h.client);
	assert.deepEqual(h.writes, []);
	h.client.pluginManager.plugins.clear();
	h.config.xpEnabled = false;
	await voice.execute(h.disconnected, h.connected, h.client);
	h.config.xpEnabled = true;
	h.member.user.bot = true;
	await voice.execute(h.disconnected, h.connected, h.client);
	h.member.user.bot = false;
	h.client.shuttingDown = true;
	await voice.execute(h.disconnected, h.connected, h.client);
	await messages.execute(h.message, h.client);
	assert.deepEqual(h.awards, []);
	assert.deepEqual(h.writes, []);
});
