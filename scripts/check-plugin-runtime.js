"use strict";

// Opt-in integration check: real bot, workers, schemas and MongoDB; fake Discord I/O.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const { Collection, Events, PermissionsBitField, PermissionFlagsBits: P, ApplicationCommandManager } = require("discord.js");
const { createADB } = require("../index");
const Database = require("../utils/database");
const { PluginManager } = require("../core/PluginManager");
const { startApiServer } = require("../core/api/server");
const { validateCapabilities } = require("../core/capabilities");
const { validateManifestV2 } = require("../core/manifest-schema");
const { generateFullRiskCard } = require("../core/risk-disclosure");
const { guildCommandBody, syncAllGuilds } = require("../core/command-sync");
const interactionRouter = require("../events/interactionCreate");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACE = process.env.ADB_PLUGIN_WORKSPACE && path.resolve(process.env.ADB_PLUGIN_WORKSPACE);
const SOURCE = WORKSPACE || path.join(ROOT, "node_modules");
const {
	discordBoundary,
	GUILD,
	OTHER_GUILD,
	ADMIN,
	MEMBER,
	BOT,
	ROLE,
} = require("./discord-boundary");

async function eventually(check, label) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.fail(`Timed out: ${label}`);
}


if (require.main === module) {
	test("all installed/workspace plugins run against the real bot and MongoDB", { timeout: 90000 }, async (t) => {
	const input = process.env.ADB_INTEGRATION_MONGODB_URI;
	assert.ok(input, "Set ADB_INTEGRATION_MONGODB_URI to a disposable loopback MongoDB (never production)");
	const url = new URL(input);
	assert.ok(url.protocol === "mongodb:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Integration MongoDB must use loopback");
	assert.ok(url.pathname.startsWith("/adb_verify_"), "Integration database name must start with adb_verify_");
	url.pathname += `_${process.pid}_${randomUUID().replaceAll("-", "")}`;
	const plugins = fs.readdirSync(SOURCE).filter((name) => name.startsWith("adb-plugin-") && fs.existsSync(path.join(SOURCE, name, "plugin.json")));
	assert.ok(plugins.length, `No plugins found under ${SOURCE}`);
	const tempParent = path.join(os.tmpdir(), "opencode");
	fs.mkdirSync(tempParent, { recursive: true });
	const temp = fs.mkdtempSync(path.join(tempParent, "adb-plugin-runtime-"));
	for (const name of plugins) fs.symlinkSync(path.join(SOURCE, name), path.join(temp, name), "dir");
	process.env.MONGODB_URI = url.href;
	Object.assign(process.env, {
		BOT_API_PORT: "3210",
		SESSION_SECRET: "offline-integration-session-secret-32-characters",
		DISCORD_OAUTH_CLIENT_ID: BOT,
		DISCORD_OAUTH_CLIENT_SECRET: "offline-placeholder",
		DISCORD_OAUTH_REDIRECT_URI: "http://localhost/auth/discord/callback",
	});
	let runtime;
	let boundary;
	t.after(async () => {
		try { await runtime?.shutdown(); }
		finally {
			try {
				if (mongoose.connection.readyState !== 1) await mongoose.connect(url.href);
				await mongoose.connection.dropDatabase();
			} finally { await mongoose.disconnect(); fs.rmSync(temp, { recursive: true, force: true }); }
		}
	});
	// Raw-client access is intentional for these first-party integrations.
	const warn = console.warn;
	t.mock.method(console, "warn", (...args) => { if (!String(args[0]).startsWith("[DEPRECATION]")) warn(...args); });
	async function start() {
		boundary = discordBoundary();
		Database.instance = new Database();
		runtime = createADB({
			env: { DISCORD_TOKEN: "offline-test-token", PLUGIN_ISOLATION: "true", BOT_API_ENABLED: "true" },
			createClient: () => boundary.client,
			createPluginManager: (options) => new PluginManager({ ...options, config: { pluginsDir: path.join(ROOT, "plugins"), nodeModulesDir: temp } }),
			startApiServer: async (options) => {
				const api = await startApiServer(options);
				assert.ok(api, "Configured API must initialize");
				return { ...api, listen: () => api.fastify.listen({ port: 0, host: "127.0.0.1" }) };
			},
			reconcileInstalledPlugins: async () => ({ changed: 0 }),
		});
		await runtime.start();
		for (const name of plugins) {
			const state = runtime.pluginManager.plugins.get(name);
			assert.equal(state?.enabled, true, `${name}: ${state?.lastError || "missing"}`);
			assert.deepEqual(validateCapabilities(state.manifest.capabilities), [], `${name} capabilities`);
			assert.deepEqual(validateManifestV2(state.manifest), [], `${name} manifest`);
			assert.doesNotThrow(() => generateFullRiskCard(state.manifest), `${name} permission disclosure`);
			if (runtime.pluginManager.isGuildGateable(name)) {
				await runtime.db.setPluginEnabledForGuild(GUILD, name, true, ADMIN);
				runtime.pluginManager.setEnabledForGuild(GUILD, name, true);
				assert.equal(state.isolated, true, `${name} must really run in a worker`);
			}
		}
		assert.ok((await syncAllGuilds(runtime.pluginManager, boundary.client)).every((result) => result.ok));
	}
	await start();
	const model = (plugin, name) => {
		const Model = mongoose.models[`plugin_adb-plugin-${plugin}_${name}`];
		assert.ok(Model, `Missing model ${plugin}:${name}`);
		return Model;
	};
	async function command(name, sub, values, options) {
		boundary.client.cooldowns.clear();
		const i = boundary.interaction(name, sub, values, options);
		await interactionRouter.execute(i, boundary.client);
		assert.ok(i.responses.length, `/${name} did not complete its response`);
		assert.doesNotMatch(JSON.stringify(i.responses), /Something went wrong|Error executing|An error occurred|Unable to update or read|Unable to submit|Failed to execute custom|command is unavailable/i);
		return i;
	}
	async function event(plugin, name, ...args) {
		const handlers = runtime.pluginManager.plugins.get(`adb-plugin-${plugin}`).eventHandlers.filter((handler) => handler.name === name);
		assert.ok(handlers.length, `No ${name} handler for ${plugin}`);
		for (const handler of handlers) await handler.wrapper(...args);
	}
	async function scenario(name, run) {
		if (plugins.includes(`adb-plugin-${name}`)) await t.test(name, run);
	}
	await t.test("every plugin loads, registers valid commands and owns its handlers", async () => {
		await Promise.all(Object.values(mongoose.models).map((Model) => Model.init()));
		for (const [name, cmd] of boundary.client.commands) {
			assert.ok(runtime.pluginManager.getCommandOwner(cmd), `No owner for /${name}`);
			const data = ApplicationCommandManager.transformCommand(cmd.data);
			assert.ok((data.options || []).length <= 25, `Too many options in /${name}`);
		}
		t.diagnostic(`${plugins.length} plugins; ${boundary.client.commands.size} commands; ${Object.keys(mongoose.models).length} real Mongoose models`);
	});
	await t.test("HTTP dashboard serves deep links and assets without exposing authenticated APIs", async () => {
		const base = `http://127.0.0.1:${runtime.apiServer.fastify.server.address().port}`;
		const health = await fetch(`${base}/health`);
		assert.equal(health.status, 200);
		assert.equal((await health.json()).status, "ok");
		const page = await fetch(`${base}/dashboard/guild/${GUILD}/plugins`);
		assert.equal(page.status, 200);
		const html = await page.text();
		assert.match(html, /id="root"/);
		const script = html.match(/<script[^>]*src="([^"]+)"/);
		assert.ok(script, "Build dashboard assets before the integration check");
		const assetUrl = new URL(script[1], base);
		assert.equal(assetUrl.origin, base);
		const asset = await fetch(assetUrl);
		assert.equal(asset.status, 200);
		assert.match(asset.headers.get("content-type"), /javascript/);
		await asset.arrayBuffer();
		const privateData = await fetch(`${base}/api/guild/${GUILD}/config`);
		assert.equal(privateData.status, 401);
		await privateData.arrayBuffer();
	});
	await scenario("todo", async () => {
		const i = await command("todo", "add", { task: "Persistent integration task" });
		assert.equal(i.ephemeral, true);
		const doc = await model("todo", "todo").findOne({ guildId: GUILD, userId: ADMIN });
		assert.equal(doc.content, "Persistent integration task");
		await command("todo", "done", { id: String(doc._id) });
		assert.equal((await model("todo", "todo").findById(doc._id)).done, true);
	});
	await scenario("reminders", async () => {
		await command("remind", "set", { time: "1h", message: "Real worker reminder" });
		const Model = model("reminders", "reminder");
		const reminder = await Model.findOne({ guildId: GUILD, userId: ADMIN });
		assert.equal(reminder.notified, false);
		await Model.updateOne({ _id: reminder._id }, { $set: { remindAt: new Date(Date.now() - 1000) } });
		const [taskId] = [...runtime.pluginManager.broker._scheduledTasks].find(([, task]) => task.pluginId === "adb-plugin-reminders");
		runtime.pluginManager.broker.emit("cron:tick", { pluginId: "adb-plugin-reminders", taskId });
		await eventually(() => Model.exists({ _id: reminder._id, notified: true }), "worker reminder persisted delivery");
		assert.ok(boundary.sent.some((msg) => msg.kind === "dm" && msg.content.includes("Real worker reminder")));
	});
	await scenario("template", async () => {
		await command("example", null, { text: "Template real worker" });
		assert.equal(await model("template", "example").countDocuments({ guildId: GUILD, data: "Template real worker" }), 1);
	});
	await scenario("autorole", async () => {
		await command("autorole", "enable");
		await command("autorole", "add", { role: boundary.primary.roles.cache.get(ROLE), type: "join" });
		await event("autorole", "guildMemberAdd", boundary.primary.members.cache.get(MEMBER));
		assert.equal(boundary.primary.members.cache.get(MEMBER).roles.cache.has(ROLE), true);
	});
	await scenario("reaction-roles", async () => {
		await command("reactionrole", "list");
		const msg = await boundary.primary.text.send("Role panel");
		await model("reaction-roles", "reactionPanel").create({ guildId: GUILD, channelId: msg.channelId, messageId: msg.id, title: "Test roles", groups: [{ name: "test", label: "Test", type: "button", selectionMode: "multiple", roles: [{ roleId: ROLE, label: "Member" }] }] });
		const i = boundary.interaction(null, null, {}, { type: 3, customId: `reactionrole:button:${msg.id}:test:${ROLE}`, sourceMessage: msg });
		await event("reaction-roles", "interactionCreate", i);
		assert.equal(boundary.primary.members.cache.get(ADMIN).roles.cache.has(ROLE), true);
		assert.equal(await model("reaction-roles", "selection").countDocuments({ guildId: GUILD, userId: ADMIN }), 1);
	});
	await scenario("welcome", async () => {
		await command("welcome", "channel", { channel: boundary.primary.text });
		await event("welcome", "guildMemberAdd", boundary.primary.members.cache.get(MEMBER));
		assert.equal((await model("welcome", "joinHistory").findOne({ guildId: GUILD, userId: MEMBER })).welcomed, true);
	});
	await scenario("counting", async () => {
		await runtime.db.updatePluginConfig(GUILD, "adb-plugin-counting", { channel: boundary.primary.text.id, milestones: "" });
		const msg = boundary.message("1", boundary.primary.text, boundary.client.users.cache.get(ADMIN));
		await event("counting", "messageCreate", msg);
		assert.equal((await model("counting", "counting").findOne({ guildId: GUILD })).count, 1);
		assert.equal((await model("counting", "userStats").findOne({ guildId: GUILD, userId: ADMIN })).highest, 1);
	});
	await scenario("levels", async () => {
		await command("level-config", null, { "xp-per-message": 50, "xp-cooldown": 10, "xp-per-minute-limit": 200 });
		await event("levels", "messageCreate", boundary.message("XP integration", boundary.primary.text, boundary.client.users.cache.get(MEMBER)));
		assert.equal((await model("levels", "Level").findOne({ guildId: GUILD, userId: MEMBER })).xp, 50);
		await command("level", null);
	});
	await scenario("automod", async () => {
		await command("automod", "list");
		await model("automod", "AutoModRule").create({ guildId: GUILD, type: "word", action: "delete", enabled: true, config: { words: ["blocked"] } });
		const msg = boundary.message("blocked", boundary.primary.text, boundary.client.users.cache.get(MEMBER));
		await event("automod", "messageCreate", msg);
		assert.equal(msg.deleted, true);
		assert.equal(await model("automod", "violation").countDocuments({ guildId: GUILD, userId: MEMBER }), 1);
	});
	await scenario("aegis", async () => {
		await command("antimod", "status");
		await runtime.db.updatePluginConfig(GUILD, "adb-plugin-aegis", { link_enabled: true, link_block_invites: true });
		const msg = boundary.message("https://discord.gg/integration", boundary.primary.text, boundary.client.users.cache.get(MEMBER));
		await event("aegis", "messageCreate", msg);
		assert.equal(msg.deleted, true);
		assert.equal(await model("aegis", "log").countDocuments({ guildId: GUILD, module: "link" }), 1);
	});
	await scenario("moderation", async () => {
		await command("warn", null, { user: boundary.client.users.cache.get(MEMBER), reason: "Integration check" });
		assert.equal(await model("moderation", "Case").countDocuments({ guildId: GUILD, targetUserId: MEMBER, type: "warn" }), 1);
		assert.equal((await runtime.db.getUserProfile(MEMBER, GUILD)).warnings, 1);
	});
	await scenario("confessions", async () => {
		await runtime.db.updatePluginConfig(GUILD, "adb-plugin-confessions", { channel: boundary.primary.text.id, requireApproval: true });
		const i = await command("confess", "text", { message: "Pending integration confession" });
		assert.equal(i.ephemeral, true);
		assert.equal(await model("confessions", "confession").countDocuments({ guildId: GUILD, userId: ADMIN, approved: null }), 1);
	});
	await scenario("giveaways", async () => {
		const i = await command("giveaway", "start", { prize: "Integration prize", duration: "1h", winners: 1 });
		const msg = await i.fetchReply();
		const entry = boundary.interaction(null, null, {}, { type: 3, userId: MEMBER, customId: "giveaway_enter", sourceMessage: msg });
		await event("giveaways", "interactionCreate", entry);
		assert.equal(await model("giveaways", "entry").countDocuments({ guildId: GUILD, userId: MEMBER }), 1);
		await command("giveaway", "end", { message_id: msg.id });
		assert.deepEqual((await model("giveaways", "giveaway").findOne({ messageId: msg.id })).winners, [MEMBER]);
	});
	await scenario("invite-tracker", async () => {
		await runtime.db.updatePluginConfig(GUILD, "adb-plugin-invite-tracker", { enabled: true, trackLeaves: true });
		await eventually(() => model("invite-tracker", "inviteCode").exists({ guildId: GUILD, code: "offline-invite" }), "initial invite cache");
		boundary.primary.invite.uses = 1;
		await event("invite-tracker", "guildMemberAdd", boundary.primary.members.cache.get(MEMBER));
		assert.equal((await model("invite-tracker", "inviteStats").findOne({ guildId: GUILD, userId: ADMIN })).totalInvites, 1);
		await command("invites", "me");
	});
	await scenario("server-logs", async () => {
		await runtime.db.updatePluginConfig(GUILD, "adb-plugin-server-logs", { enabled: true, membersChannelId: boundary.primary.text.id });
		await command("log", "list");
		await event("server-logs", "guildMemberAdd", boundary.primary.members.cache.get(MEMBER));
		assert.equal(await model("server-logs", "memberEvent").countDocuments({ guildId: GUILD, userId: MEMBER }), 1);
	});
	await scenario("custom-commands", async () => {
		await command("customcommand", "create", { name: "integration-hello", type: "slash", response: "Hello {user}" });
		const i = await command("integration-hello", null);
		assert.match(i.responses[0].content, /Hello/);
		assert.ok(guildCommandBody(runtime.pluginManager, boundary.client, GUILD).some((cmd) => cmd.name === "integration-hello"));
		assert.equal(guildCommandBody(runtime.pluginManager, boundary.client, OTHER_GUILD).some((cmd) => cmd.name === "integration-hello"), false);
	});
	await scenario("tempvoice", async () => {
		const guild = boundary.primary;
		await command("voice", "setup", { "creation-channel": guild.lobby, category: guild.category });
		const member = guild.members.cache.get(MEMBER);
		await member.voice.setChannel(guild.lobby);
		await event("tempvoice", "voiceStateUpdate", { guild, channelId: null, member }, guild.voiceStates.cache.get(MEMBER));
		const room = await model("tempvoice", "TempVoiceChannel").findOne({ guildId: GUILD, creatorId: MEMBER });
		assert.ok(room, "join-to-create must persist a room");
		assert.equal(member.voice.channelId, room.channelId);
		assert.equal(room.deleteAt, null, "occupied room must not expire");
	});
	await scenario("music", async () => {
		await boundary.primary.members.cache.get(ADMIN).voice.setChannel(boundary.primary.lobby);
		const i = await command("play", null, { query: "integration music" });
		assert.match(i.responses[0].content, /not configured|lavalink_host/i);
	});
	await t.test("shutdown and restart preserve data and recreate all plugin registrations", async () => {
		const previous = runtime;
		await previous.shutdown();
		assert.equal(previous.pluginManager.workerManager.activeCount, 0);
		assert.equal(previous.client.commands.size, 0);
		assert.equal(previous.pluginManager.watchers.size, 0);
		await start();
		if (plugins.includes("adb-plugin-todo")) assert.equal((await model("todo", "todo").findOne({ guildId: GUILD, userId: ADMIN })).done, true);
		if (plugins.includes("adb-plugin-counting")) assert.equal((await model("counting", "counting").findOne({ guildId: GUILD })).count, 1);
		if (plugins.includes("adb-plugin-custom-commands")) assert.ok(boundary.client.commands.has("integration-hello"));
	});
});
}

module.exports = {
	discordBoundary,
	GUILD,
	OTHER_GUILD,
	ADMIN,
	MEMBER,
	BOT,
	ROLE,
};
