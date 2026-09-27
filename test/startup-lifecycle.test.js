const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { Collection, Events, GatewayIntentBits } = require("discord.js");

function loadRuntime(t) {
	t.mock.method(require("dotenv"), "config", () => { throw new Error("Import must not load .env"); });
	t.mock.method(require("mongoose"), "connect", () => { throw new Error("Unexpected live database connection"); });
	t.mock.method(require("node-cron"), "schedule", () => { throw new Error("Unexpected live cron task"); });
	t.mock.method(global, "setInterval", () => { throw new Error("Unexpected unmanaged interval"); });
	return require("../index");
}

function fixture(t, env = { DISCORD_TOKEN: "test-token", BOT_API_ENABLED: "true" }) {
	const { createADB } = loadRuntime(t);
	const calls = [];
	const host = new EventEmitter();
	const client = new EventEmitter();
	client.guilds = { cache: new Collection() };
	client.users = { cache: new Collection() };
	client.user = { id: "bot", tag: "bot#0001", setPresence: () => { calls.push("presence"); } };
	client.login = async () => { calls.push("login"); };
	client.destroy = async () => { calls.push("discord.close"); };
	const db = { close: async () => { calls.push("db.close"); } };
	const scheduler = { shutdown: async () => { calls.push("scheduler.close"); } };
	const manager = {
		enableIsolation: () => { calls.push("isolation"); },
		loadAll: async () => { calls.push("plugins.load"); },
		shutdown: async () => { calls.push("plugins.close"); },
	};
	const api = { fastify: { close: async () => { calls.push("api.close"); } }, listen: async () => { calls.push("api.listen"); } };
	const intervals = new Set();
	const timers = {
		setInterval(fn) { intervals.add(fn); return fn; },
		clearInterval(fn) { intervals.delete(fn); },
	};
	const options = {
		env, process: host, timers,
		logger: { info() {}, warn() {}, error() {} },
		createClient: (config) => { calls.push("client.create"); client.options = config; return client; },
		getDatabase: async () => { calls.push("db.open"); return db; },
		createScheduler: () => { calls.push("scheduler.create"); return scheduler; },
		createPluginManager: () => manager,
		startApiServer: async () => api,
		reconcileInstalledPlugins: async () => ({ changed: 0 }),
		syncAllGuilds: async () => { calls.push("sync.all"); },
		syncGuildCommands: async () => { calls.push("sync.guild"); },
	};
	const runtime = createADB(options);
	t.after(async () => { await runtime.shutdown().catch(() => {}); });
	return { runtime, createADB, options, calls, host, client, db, scheduler, manager, api, intervals };
}

test("startup: importing index exports lifecycle functions without environment or process side effects", (t) => {
	const before = ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"].map((event) => process.listenerCount(event));
	const exports = loadRuntime(t);
	assert.equal(typeof exports.createADB, "function");
	assert.equal(typeof exports.startADB, "function");
	assert.deepEqual(["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"].map((event) => process.listenerCount(event)), before);
});

test("startup: missing token is rejected before client, database, or cron creation", async (t) => {
	const h = fixture(t, { DISCORD_TOKEN: "   " });
	await assert.rejects(h.runtime.start(), /DISCORD_TOKEN/);
	assert.deepEqual(h.calls, []);
});

test("startup: incomplete OAuth disables the API without breaking bot login", async (t) => {
	const h = fixture(t);
	const runtime = h.createADB({ ...h.options, startApiServer: async () => null });
	t.after(() => runtime.shutdown());
	await runtime.start();
	assert.ok(h.calls.includes("login"));
	assert.equal(h.calls.includes("api.listen"), false);
	assert.equal(h.client.fastify, null);
	assert.ok(h.client.options.intents.includes(GatewayIntentBits.GuildInvites));
	assert.ok(h.client.options.intents.includes(GatewayIntentBits.GuildModeration));
	assert.equal(h.client.db, h.db);
	assert.equal(h.client.scheduler, h.scheduler);
});

test("startup: ready owns exactly one activity interval and shutdown removes it and sync listeners", async (t) => {
	const h = fixture(t);
	await Promise.all([h.runtime.start(), h.runtime.start()]);
	h.client.emit(Events.ClientReady, h.client);
	require("../events/ready").execute(h.client);
	h.client.emit(Events.ClientReady, h.client);
	await nextTurn();
	assert.equal(h.intervals.size, 1);
	assert.equal(h.calls.filter((call) => call === "login").length, 1);
	assert.equal(h.calls.filter((call) => call === "sync.all").length, 1);
	await h.runtime.shutdown();
	assert.equal(h.intervals.size, 0);
	h.client.emit("guildCreate", { id: "late" });
	assert.equal(h.calls.includes("sync.guild"), false);
});

for (const phase of ["plugins.load", "api.listen", "login"]) {
	test(`startup: ${phase} failure retains its cause and awaits every acquired resource cleanup`, async (t) => {
		const h = fixture(t);
		const failure = new Error(`${phase} failed`);
		const [object, key] = phase === "plugins.load" ? [h.manager, "loadAll"] : phase === "api.listen" ? [h.api, "listen"] : [h.client, "login"];
		object[key] = async () => { throw failure; };
		let finishClose;
		h.db.close = () => new Promise((resolve) => { finishClose = () => { h.calls.push("db.close"); resolve(); }; });
		let settled = false;
		const starting = h.runtime.start().catch((error) => { settled = true; return error; });
		await nextTurn();
		assert.equal(settled, false);
		assert.deepEqual(h.calls.filter((call) => call.endsWith(".close")), ["api.close", "scheduler.close", "plugins.close", "discord.close"]);
		finishClose();
		assert.equal(await starting, failure);
		assert.equal(h.calls.at(-1), "db.close");
	});
}

test("startup: both termination signals share shutdown and cleanup continues past individual failures", async (t) => {
	const h = fixture(t);
	await h.runtime.start();
	h.manager.shutdown = async () => { h.calls.push("plugins.close"); throw new Error("plugin cleanup failed"); };
	h.host.emit("SIGINT");
	h.host.emit("SIGTERM");
	await assert.rejects(h.runtime.shutdown(), /shutdown|cleanup/i);
	await nextTurn();
	for (const label of ["api.close", "scheduler.close", "plugins.close", "discord.close", "db.close"]) {
		assert.equal(h.calls.filter((call) => call === label).length, 1, label);
	}
	assert.equal(h.host.exitCode, 1);
	assert.equal(h.host.listenerCount("SIGINT"), 0);
	assert.equal(h.host.listenerCount("SIGTERM"), 0);
	await assert.rejects(h.runtime.start(), /shut|stop|closed/i);
});

test("startup: shutdown during database initialization prevents later resources and login", async (t) => {
	const h = fixture(t);
	let release;
	const runtime = h.createADB({ ...h.options, getDatabase: () => new Promise((resolve) => { release = () => resolve(h.db); }) });
	const starting = runtime.start().catch((error) => error);
	const stopping = runtime.shutdown();
	release();
	await stopping;
	assert.match((await starting).message, /cancel|shut|stop/i);
	assert.equal(h.calls.includes("login"), false);
	assert.equal(h.calls.includes("scheduler.create"), false);
	assert.equal(h.calls.includes("db.close"), true);
});

test("startup: shutdown interrupts a pending login without waiting forever", async (t) => {
	const h = fixture(t);
	h.client.login = () => new Promise(() => {});
	const starting = h.runtime.start().catch((error) => error);
	await nextTurn();
	await h.runtime.shutdown();
	assert.match((await starting).message, /cancel|shut|stop/i);
	assert.equal(h.calls.at(-1), "db.close");
});

test("startup: SIGINT and SIGTERM share successful awaited cleanup", async (t) => {
	const h = fixture(t);
	await h.runtime.start();
	h.host.emit("SIGINT");
	h.host.emit("SIGTERM");
	await h.runtime.shutdown();
	await nextTurn();
	assert.equal(h.host.exitCode, 0);
	assert.equal(h.calls.filter((call) => call === "db.close").length, 1);
});

test("startup: shutdown interrupts plugin loading and awaits the manager shutdown contract", async (t) => {
	const h = fixture(t);
	let release;
	const loading = new Promise((resolve) => { release = resolve; });
	h.manager.loadAll = () => loading;
	h.manager.shutdown = async () => { h.calls.push("plugins.close"); release(); await loading; };
	const startup = h.runtime.start().catch((error) => error);
	await nextTurn();
	await h.runtime.shutdown();
	assert.match((await startup).message, /cancel|shut|stop/i);
	assert.equal(h.calls.includes("login"), false);
	assert.equal(h.calls.includes("plugins.close"), true);
});

test("startup: database failures retain their cause and still destroy the client", async (t) => {
	const h = fixture(t);
	const failure = new Error("database authentication failed");
	const runtime = h.createADB({ ...h.options, getDatabase: async () => { throw failure; } });
	await assert.rejects(runtime.start(), (error) => error === failure);
	assert.deepEqual(h.calls, ["client.create", "discord.close"]);
});
