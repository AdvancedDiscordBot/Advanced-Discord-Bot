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
const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const ADMIN = "200000000000000001";
const MEMBER = "200000000000000002";
const BOT = "300000000000000001";
const ROLE = "400000000000000001";

async function eventually(check, label) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.fail(`Timed out: ${label}`);
}

function discordBoundary() {
	const client = new EventEmitter();
	const sent = [];
	let nextId = 500000000000000000n;
	let ready = false;
	const id = () => String(++nextId);
	const permissions = new PermissionsBitField(P.Administrator);
	client.guilds = { cache: new Collection() };
	client.channels = { cache: new Collection(), fetch: async (key) => client.channels.cache.get(key) || null };
	client.users = { cache: new Collection(), fetch: async (key) => client.users.cache.get(key) || user(key) };
	client.ws = { ping: 0 };
	client.isReady = () => ready;
	client.destroy = async () => { ready = false; };
	client.login = async () => {
		ready = true;
		client.emit(Events.ClientReady, client);
		client.emit("ready", client);
		return "offline-test-token";
	};

	function payload(value) {
		const data = typeof value === "string" ? { content: value } : value || {};
		const out = { ...data, embeds: (data.embeds || []).map((embed) => embed.toJSON ? embed.toJSON() : embed) };
		assert.ok((out.content || "").length <= 2000, "Discord content limit");
		let embedLength = 0;
		for (const embed of out.embeds) {
			assert.ok((embed.description || "").length <= 4096, "Discord embed description limit");
			assert.ok((embed.fields || []).length <= 25, "Discord embed field count");
			embedLength += (embed.title || "").length + (embed.description || "").length + (embed.footer?.text || "").length;
			for (const field of embed.fields || []) {
				assert.ok(field.name.length <= 256 && field.value.length <= 1024, "Discord embed field limit");
				embedLength += field.name.length + field.value.length;
			}
		}
		assert.ok(embedLength <= 6000, "Discord total embed limit");
		return out;
	}

	function message(data, channel, author = client.user) {
		const msg = {
			id: id(), guild: channel?.guild, guildId: channel?.guildId, channel, channelId: channel?.id,
			author, member: channel?.guild?.members.cache.get(author.id), content: "", embeds: [],
			attachments: new Collection(), reactions: { cache: new Collection() }, createdTimestamp: Date.now(),
			url: "https://discord.com/channels/test/message", deleted: false,
			async edit(value) { Object.assign(msg, payload(value)); return msg; },
			async delete() { msg.deleted = true; channel?.messages.cache.delete(msg.id); },
			async reply(value) { return channel.send(value); },
			async react(emoji) { msg.lastReaction = emoji; },
		};
		Object.assign(msg, payload(data));
		channel?.messages.cache.set(msg.id, msg);
		return msg;
	}

	function user(key, bot = false) {
		const value = {
			id: key, bot, username: `user-${key.slice(-2)}`, tag: `user-${key.slice(-2)}`,
			createdAt: new Date("2020-01-01"), createdTimestamp: Date.parse("2020-01-01"),
			displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
			toString: () => `<@${key}>`, setActivity() {}, setPresence() {},
			async send(data) { const msg = message(data, null, client.user); sent.push({ kind: "dm", userId: key, ...payload(data) }); return msg; },
		};
		client.users.cache.set(key, value);
		return value;
	}
	client.user = user(BOT, true);

	function channel(guild, name, type = 0, options = {}) {
		const value = {
			id: id(), name, type, guild, guildId: guild.id, deletable: true, deleted: false,
			parentId: options.parent || null, parent: guild.channels.cache.get(options.parent),
			bitrate: options.bitrate || 64000, userLimit: options.userLimit || 0, members: new Collection(),
			isTextBased: () => type === 0, isVoiceBased: () => type === 2, permissionsFor: () => permissions,
			toString() { return `<#${value.id}>`; },
			messages: { cache: new Collection(), async fetch(key) { return value.messages.cache.get(key) || null; } },
			permissionOverwrites: {
				cache: new Collection(),
				async edit(target, changes) {
					const key = typeof target === "string" ? target : target.id;
					const overwrite = this.cache.get(key) || { id: key, type: guild.roles.cache.has(key) ? 0 : 1, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
					for (const [name, enabled] of Object.entries(changes)) {
						overwrite.allow.remove(P[name]); overwrite.deny.remove(P[name]);
						if (enabled === true) overwrite.allow.add(P[name]);
						if (enabled === false) overwrite.deny.add(P[name]);
					}
					this.cache.set(key, overwrite);
					return value;
				},
				async set(overwrites) {
					this.cache.clear();
					for (const overwrite of overwrites) this.cache.set(overwrite.id, { ...overwrite, allow: new PermissionsBitField(overwrite.allow || 0n), deny: new PermissionsBitField(overwrite.deny || 0n) });
					return value;
				},
				async delete(target) { this.cache.delete(typeof target === "string" ? target : target.id); },
			},
			async send(data) { const msg = message(data, value); sent.push({ kind: "channel", channelId: value.id, ...payload(data) }); return msg; },
			async delete() { value.deleted = true; guild.channels.cache.delete(value.id); client.channels.cache.delete(value.id); },
			async setName(name) { value.name = name; return value; },
			async fetchWebhooks() { return new Collection(); },
			async createWebhook() { return { owner: client.user, send: (data) => value.send(data) }; },
		};
		guild.channels.cache.set(value.id, value);
		client.channels.cache.set(value.id, value);
		return value;
	}

	function guild(key) {
		const value = { id: key, name: "Offline test guild", ownerId: ADMIN, memberCount: 3, available: true, maximumBitrate: 96000, verificationLevel: 0, iconURL: () => null };
		value.channels = {
			cache: new Collection(), fetch: async (key) => value.channels.cache.get(key) || null,
			async create(options) {
				assert.equal(typeof options, "object", "Discord.js v14 takes one channel options object");
				assert.equal(typeof options.name, "string");
				const result = channel(value, options.name, options.type, options);
				await result.permissionOverwrites.set(options.permissionOverwrites || []);
				return result;
			},
		};
		const makeRole = (id, position) => ({ id, name: `role-${position}`, position, rawPosition: position, managed: false, editable: true, guild: value, permissions: new PermissionsBitField(), toString: () => `<@&${id}>`, comparePositionTo(other) { return position - other.position; } });
		value.roles = { cache: new Collection([[key, makeRole(key, 0)], [ROLE, makeRole(ROLE, 1)]]), fetch: async (key) => value.roles.cache.get(key) || null };
		value.roles.everyone = value.roles.cache.get(key);
		value.voiceStates = { cache: new Collection() };
		value.members = { cache: new Collection(), fetch: async (key) => {
			const member = value.members.cache.get(typeof key === "object" ? key.user : key);
			if (!member) throw Object.assign(new Error("Unknown member"), { code: 10007 });
			return member;
		}, fetchMe: async () => value.members.me };
		for (const key of [ADMIN, MEMBER, BOT]) {
			const person = client.users.cache.get(key) || user(key);
			const member = { id: key, user: person, guild: value, displayName: person.username, permissions: key === MEMBER ? new PermissionsBitField() : permissions, joinedTimestamp: Date.now(), manageable: true, moderatable: true, kickable: true, bannable: true, toString: person.toString, send: person.send };
			member.roles = {
				cache: new Collection([[value.id, value.roles.everyone]]), highest: makeRole(`highest-${key}`, key === BOT ? 100 : key === ADMIN ? 90 : 0),
				async add(roles) { for (const role of Array.isArray(roles) ? roles : [roles]) { const key = typeof role === "string" ? role : role.id; this.cache.set(key, value.roles.cache.get(key)); } },
				async remove(roles) { for (const role of Array.isArray(roles) ? roles : [roles]) this.cache.delete(typeof role === "string" ? role : role.id); },
			};
			member.voice = { channelId: null, async setChannel(destination) {
				value.channels.cache.get(this.channelId)?.members.delete(key);
				const target = typeof destination === "string" ? value.channels.cache.get(destination) : destination;
				this.channelId = target?.id || null;
				target?.members.set(key, member);
				value.voiceStates.cache.set(key, { id: key, guild: value, member, channelId: this.channelId, channel: target });
			} };
			member.timeout = async () => { member.timedOut = true; };
			member.kick = async () => { member.kicked = true; };
			member.ban = async () => { member.banned = true; };
			value.members.cache.set(key, member);
		}
		value.members.me = value.members.cache.get(BOT);
		value.invite = { code: "offline-invite", uses: 0, inviter: client.users.cache.get(ADMIN), maxUses: 0 };
		value.invites = { fetch: async () => new Collection([[value.invite.code, value.invite]]) };
		value.fetchAuditLogs = async () => ({ entries: new Collection() });
		value.setVerificationLevel = async (level) => { value.verificationLevel = level; };
		value.shard = { send() { assert.fail("The integration check must not request a live voice connection"); } };
		value.commands = {
			cache: new Collection(),
			async create(data) { const command = { ...ApplicationCommandManager.transformCommand(data), id: id() }; this.cache.set(command.id, command); return command; },
			async fetch() { return this.cache; },
			async delete(key) { this.cache.delete(key); },
			async set(commands) { this.cache.clear(); for (const command of commands) await this.create(command); value.synced = true; },
		};
		client.guilds.cache.set(key, value);
		value.text = channel(value, "integration-chat");
		value.lobby = channel(value, "Create voice", 2);
		value.category = channel(value, "Voice rooms", 4);
		return value;
	}
	const primary = guild(GUILD);
	const secondary = guild(OTHER_GUILD);

	function interaction(name, sub, values = {}, { guild = primary, userId = ADMIN, type = 2, commandType = 1, customId, sourceMessage } = {}) {
		const responses = [];
		const data = Object.entries(values).map(([name, value]) => ({ name, type: typeof value === "boolean" ? 5 : typeof value === "number" ? 4 : typeof value === "object" ? value.type === undefined ? 8 : 7 : 3, value: value?.id || value }));
		let reply;
		const i = {
			id: id(), client, type, commandType, commandName: name, guildId: guild.id, guild,
			channel: guild.text, channelId: guild.text.id, user: client.users.cache.get(userId), member: guild.members.cache.get(userId),
			memberPermissions: guild.members.cache.get(userId).permissions, appPermissions: permissions,
			customId, message: sourceMessage, responses, replied: false, deferred: false,
			isChatInputCommand: () => type === 2 && commandType === 1,
			isContextMenuCommand: () => type === 2 && commandType !== 1,
			isUserContextMenuCommand: () => type === 2 && commandType === 2,
			isMessageContextMenuCommand: () => type === 2 && commandType === 3,
			isAutocomplete: () => type === 4, isButton: () => type === 3, isStringSelectMenu: () => false, isModalSubmit: () => false, inGuild: () => true,
			options: { data: sub ? [{ name: sub, type: 1, options: data }] : data, getSubcommand: () => sub, getSubcommandGroup: () => null },
			async deferReply(options = {}) { assert.ok(!i.replied && !i.deferred, "Interaction acknowledged once"); i.deferred = true; i.ephemeral = !!(options.ephemeral || Number(options.flags || 0) & 64); },
			async reply(data) { assert.ok(!i.replied && !i.deferred, "Interaction acknowledged once"); i.replied = true; i.ephemeral = !!(data?.ephemeral || Number(data?.flags || 0) & 64); responses.push(payload(data)); reply = message(data, guild.text); return reply; },
			async editReply(data) { assert.ok(i.replied || i.deferred, "Reply must be acknowledged before editing"); responses.push(payload(data)); reply ||= message({}, guild.text); await reply.edit(data); i.replied = true; return reply; },
			async followUp(data) { assert.ok(i.replied || i.deferred); responses.push(payload(data)); return message(data, guild.text); },
			async fetchReply() { assert.ok(i.replied || i.deferred); reply ||= message({}, guild.text); return reply; },
		};
		for (const type of ["String", "Integer", "Boolean", "Number", "Channel", "Role", "User", "Member", "Attachment"]) i.options[`get${type}`] = (name) => values[name] ?? null;
		return i;
	}
	return { client, primary, secondary, sent, interaction, message };
}

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
