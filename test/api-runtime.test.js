const { test, mock, after } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const childProcess = require("node:child_process");
const { Collection } = require("discord.js");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const axios = require("axios");
const { PluginManager } = require("../core/PluginManager");
const { HookBus } = require("../core/HookBus");
const persistence = require("../core/plugin-persistence");
const { registry } = require("../core/pluginRegistry");
const models = require("../models/schemas");

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const ROLE = "200000000000000001";
const CHANNEL = "300000000000000001";
const ADMIN = "400000000000000001";
const MEMBER = "400000000000000002";
const OWNER = "400000000000000003";
const OUTSIDER = "400000000000000004";
const PLUGIN = "adb-plugin-runtime";
const clone = (value) => JSON.parse(JSON.stringify(value));
const quiet = { info() {}, warn() {}, error() {} };
const responseCookie = (response) => {
	const header = response.headers["set-cookie"];
	return (Array.isArray(header) ? header[0] : header)?.split(";")[0];
};

// No credentials, sockets, MongoDB, npm processes, or persistent files are used.
// Keep the real Fastify cookie/session hooks and seed their injected store.
let spawnFake;
mock.method(childProcess, "spawn", (...args) => spawnFake(...args));
const { startApiServer } = require("../core/api/server");
after(() => mock.restoreAll());

async function harness(t, { grants = [], env = {} } = {}) {
	const testEnv = {
		BOT_API_PORT: "3099", BOT_API_BASE_URL: "http://dashboard.test",
		SESSION_SECRET: "runtime-tests-only-not-a-secret-1234567890",
		DISCORD_OAUTH_CLIENT_ID: "runtime-client", DISCORD_OAUTH_CLIENT_SECRET: "runtime-secret",
		DISCORD_OAUTH_REDIRECT_URI: "http://dashboard.test/auth/discord/callback",
		DASHBOARD_REDIRECT_URL: "", WATCHDOG_PORT: "", MONGODB_URI: "",
		OWNER_IDS: OWNER, ...env,
	};
	const previous = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));
	Object.assign(process.env, testEnv);
	t.after(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
	t.mock.method(mongoose, "connect", () => assert.fail("Real MongoDB connection attempted"));
	t.mock.method(global, "fetch", async () => assert.fail("Real HTTP request attempted"));
	t.mock.method(axios, "get", async () => assert.fail("Real axios request attempted"));
	t.mock.method(axios, "post", async () => assert.fail("Real OAuth request attempted"));
	t.mock.method(registry, "getFreshPluginVersions", async () => null);
	t.mock.method(registry, "saveCache", () => {});
	registry.registry = [];
	registry.lastFetch = Date.now();

	const sessions = new Map();
	const store = {
		get(id, cb) { cb(null, sessions.has(id) ? clone(sessions.get(id)) : null); },
		set(id, value, cb) { sessions.set(id, clone(value)); cb(); },
		destroy(id, cb) { setImmediate(() => { sessions.delete(id); cb(); }); },
		async close() {},
	};
	const createStore = t.mock.method(MongoStore, "create", () => store);
	const configs = new Map();
	const serverConfigs = new Map();
	const roleGrants = new Map([[GUILD, clone(grants)]]);
	const db = {
		ServerConfig: models.ServerConfig,
		AntiRaid: models.AntiRaid,
		GuildEconomy: models.GuildEconomy,
		async ensureConnection() {},
		async getServerConfig(guildId) {
			const value = serverConfigs.get(guildId) || { guildId, aiEnabled: false };
			return { ...clone(value), toObject: () => clone(value) };
		},
		async updateServerConfig(guildId, data) {
			const value = { ...(serverConfigs.get(guildId) || { guildId }), ...clone(data) };
			serverConfigs.set(guildId, value);
			return clone(value);
		},
		async getPluginConfig(guildId, pluginName) {
			return clone(configs.get(`${guildId}:${pluginName}`) || { guildId, pluginName, enabled: false, data: {} });
		},
		async updatePluginConfig(guildId, pluginName, data) {
			const value = { ...(await this.getPluginConfig(guildId, pluginName)), data: clone(data) };
			configs.set(`${guildId}:${pluginName}`, value);
			return clone(value);
		},
		async getAllPluginConfigs(guildId) {
			return [...configs.values()].filter((row) => row.guildId === guildId).map(clone);
		},
		async setPluginEnabledForGuild(guildId, pluginName, enabled) {
			const value = { ...(await this.getPluginConfig(guildId, pluginName)), enabled };
			configs.set(`${guildId}:${pluginName}`, value);
			return clone(value);
		},
		async getEnabledPluginNames(guildId) {
			return [...configs.values()].filter((row) => row.guildId === guildId && row.enabled).map((row) => row.pluginName);
		},
		async getAllEnabledPluginRows() { return [...configs.values()].filter((row) => row.enabled).map(clone); },
		async getGuildRoleGrants(guildId) { return clone(roleGrants.get(guildId) || []); },
		async setGuildRoleGrant(guildId, roleId, permissions) {
			roleGrants.set(guildId, [...(roleGrants.get(guildId) || []).filter((g) => g.roleId !== roleId), { roleId, permissions }]);
		},
		async deleteGuildRoleGrant(guildId, roleId) {
			roleGrants.set(guildId, (roleGrants.get(guildId) || []).filter((g) => g.roleId !== roleId));
		},
		async getTopUsers() { return []; },
	};
	const client = new EventEmitter();
	client.commands = new Collection();
	client.ws = { status: 0, ping: 5 };
	client.user = { tag: "runtime#0001", displayAvatarURL: () => null };
	const makeGuild = (id, members) => {
		const cache = new Collection(members.map(([uid, bits]) => [uid, {
			id: uid, guild: { id }, permissions: { bitfield: bits },
			roles: { cache: new Collection([[ROLE, { id: ROLE }]]) },
		}]));
		return {
			id, name: `Guild ${id}`, icon: null, iconURL: () => null, ownerId: ADMIN, memberCount: members.length,
			members: { cache, fetch: async (input) => cache.get(input.user || input) || null },
			roles: { cache: new Collection([[ROLE, { id: ROLE, name: "Staff", color: 0, position: 1 }]]) },
			channels: { cache: new Collection([[CHANNEL, { id: CHANNEL, name: "general", type: 0 }]]) },
			commands: { async set(body) { this.body = clone(body); } },
		};
	};
	client.guilds = { cache: new Collection([
		[GUILD, makeGuild(GUILD, [[ADMIN, 8n], [MEMBER, 0n]])],
		[OTHER_GUILD, makeGuild(OTHER_GUILD, [[MEMBER, 0n]])],
	]) };
	const hooks = new HookBus(quiet);
	const pm = new PluginManager({ client, db, hooks, scheduler: {} });
	pm.logger = quiet;
	const manifest = {
		name: PLUGIN, version: "1.0.0", permissions: {}, capabilities: {},
		settings: { commandPermissions: true, schema: [
			{ key: "label", type: "string" }, { key: "count", type: "number", min: 1, max: 20 },
			{ key: "active", type: "boolean" }, { key: "channel", type: "channel" },
			{ key: "role", type: "role" }, { key: "mode", type: "select", options: ["safe", "strict"] },
		] },
		webUi: { memberPages: [{
			path: "/items", label: "My items", source: { model: "Item", sort: { createdAt: -1 }, limit: 10 },
			view: { type: "list", title: "label", actions: [
				{ id: "done", label: "Done", op: "set", field: "done", value: true },
				{ id: "delete", label: "Delete", op: "delete" },
			] },
		}] },
	};
	const disk = new Map([[PLUGIN, { name: PLUGIN, manifest: clone(manifest), source: "package", packageName: PLUGIN, basePath: `/virtual/${PLUGIN}`, entryPath: `/virtual/${PLUGIN}/index.js` }]]);
	pm.plugins.set(PLUGIN, { ...pm.initPluginState(PLUGIN, manifest), loaded: true, source: "package", packageName: PLUGIN, path: `/virtual/${PLUGIN}`, entryPath: `/virtual/${PLUGIN}/index.js` });
	pm.registerCommand(PLUGIN, { data: { name: "runtime", description: "Runtime test" }, execute() {} });
	pm._enableIndexAt = Date.now();
	t.mock.method(pm, "loadCore", async () => {});
	t.mock.method(pm, "discoverPlugins", () => [...disk.values()]);
	t.mock.method(pm, "setupHotReload", () => {});
	t.mock.method(pm, "_loadPluginDirect", async (plugin) => {
		const name = plugin.name === PLUGIN ? "runtime" : plugin.name.split("/").pop().slice(0, 32);
		pm.registerCommand(plugin.name, { data: { name, description: plugin.manifest.version }, execute() {} });
	});
	const npmCalls = [];
	spawnFake = (command, args) => {
		npmCalls.push({ command, args });
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		setImmediate(() => child.emit("close", 0));
		return child;
	};
	const recordInstall = t.mock.method(persistence, "recordInstall", () => {});
	t.mock.method(persistence, "recordUninstall", () => {});
	const api = await startApiServer({ client, db, pluginManager: pm, hooks, startListening: false });
	if (!api) return { api, createStore };
	t.after(() => api.fastify.close());
	await api.fastify.ready();
	const cookieFor = (id) => {
		const sid = `runtime-${id}`;
		sessions.set(sid, { user: { id, username: `user-${id}` }, candidateGuildIds: [GUILD, OTHER_GUILD] });
		return `adb.sid=${encodeURIComponent(api.fastify.signCookie(sid))}`;
	};
	const cookies = Object.fromEntries([ADMIN, MEMBER, OWNER, OUTSIDER].map((id) => [id, cookieFor(id)]));
	const inject = (user, method, url, payload, extra = {}) => api.fastify.inject({
		method, url, ...(payload !== undefined ? { payload } : {}),
		...extra, headers: { ...(user ? { cookie: cookies[user] } : {}), ...extra.headers },
	});
	return { ...api, api, inject, client, db, pm, hooks, configs, serverConfigs, roleGrants, disk, npmCalls, recordInstall, sessions, store, createStore };
}

test("api-runtime: private routes require a session before accessing data or mutating plugins", async (t) => {
	const h = await harness(t);
	for (const [method, url] of [
		["GET", "/api/guilds"], ["GET", `/api/guild/${GUILD}`],
		["GET", `/api/me/guild/${GUILD}/pages`], ["POST", "/api/plugins/install"],
		["PUT", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`],
	]) {
		assert.equal((await h.inject(null, method, url)).statusCode, 401, url);
	}
	assert.equal(h.npmCalls.length, 0);
	assert.equal(h.configs.size, 0);
});

test("api-runtime: port validation rejects non-TCP ports before creating resources", async (t) => {
	for (const port of ["-1", "1.5", "65536", "Infinity"]) {
		await t.test(port, async (t) => {
			const h = await harness(t, { env: { BOT_API_PORT: port } });
			assert.equal(h.api, null);
			assert.equal(h.createStore.mock.callCount(), 0);
		});
	}
});

test("api-runtime: settings round-trip preserves command permissions and internal plugin data", async (t) => {
	const h = await harness(t);
	const original = { label: "before", internal: { cursor: 4 }, _commands: { runtime: { enabled: false, allowedRoles: [ROLE] } } };
	await h.db.updatePluginConfig(GUILD, PLUGIN, original);
	const write = await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`, { label: "after" });
	assert.equal(write.statusCode, 200);
	const read = await h.inject(ADMIN, "GET", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`);
	assert.deepEqual(read.json().config, { ...original, label: "after" });
});

test("api-runtime: legacy bulk plugin settings merge instead of deleting _commands", async (t) => {
	const h = await harness(t);
	const original = { label: "before", _commands: { runtime: { enabled: false, allowedRoles: [ROLE] } } };
	await h.db.updatePluginConfig(GUILD, PLUGIN, original);
	for (const body of [
		{ pluginConfig: { pluginName: PLUGIN, data: { count: 5 } } },
		{ pluginConfigs: [{ pluginName: PLUGIN, data: { count: 6 } }] },
	]) {
		const write = await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/config`, body);
		assert.equal(write.statusCode, 200);
		assert.deepEqual((await h.db.getPluginConfig(GUILD, PLUGIN)).data._commands, original._commands);
	}
});

test("api-runtime: settings reject malformed or undeclared fields without changing saved data", async (t) => {
	const h = await harness(t);
	await h.db.updatePluginConfig(GUILD, PLUGIN, { count: 2 });
	for (const body of [[], { count: "many" }, { count: 0 }, { count: 21 }, { active: "false" }, { mode: "invalid" }, { channel: OTHER_GUILD }, { role: OTHER_GUILD }, { surprise: true }, { _commands: {} }]) {
		const write = await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`, body);
		assert.equal(write.statusCode, 400, JSON.stringify(body));
		assert.deepEqual((await h.db.getPluginConfig(GUILD, PLUGIN)).data, { count: 2 });
	}
});

test("api-runtime: partial command edits do not silently remove restrictions or re-enable commands", async (t) => {
	const h = await harness(t);
	await h.db.updatePluginConfig(GUILD, PLUGIN, { label: "saved", _commands: { runtime: { enabled: false, allowedRoles: [ROLE] } } });
	const route = `/api/guild/${GUILD}/plugins/${PLUGIN}/commands/runtime`;
	assert.equal((await h.inject(ADMIN, "PUT", route, { enabled: true })).statusCode, 200);
	assert.deepEqual((await h.db.getPluginConfig(GUILD, PLUGIN)).data._commands.runtime, { enabled: true, allowedRoles: [ROLE] });
	for (const body of [{ allowedRoles: ["bad"] }, { allowedRoles: "everyone" }, { enabled: "false" }, []]) {
		assert.equal((await h.inject(ADMIN, "PUT", route, body)).statusCode, 400, JSON.stringify(body));
	}
	assert.equal((await h.inject(ADMIN, "PUT", route, { enabled: false, allowedRoles: [] })).statusCode, 200);
	assert.equal((await h.db.getPluginConfig(GUILD, PLUGIN)).data.label, "saved");
});

test("api-runtime: bulk config cannot bypass plugin-specific read or write grants", async (t) => {
	const h = await harness(t, { grants: [{ roleId: ROLE, permissions: ["guild.view", "guild.configure"] }] });
	await h.db.updatePluginConfig(GUILD, PLUGIN, { label: "private" });
	assert.equal((await h.inject(MEMBER, "GET", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`)).statusCode, 403);
	const read = await h.inject(MEMBER, "GET", `/api/guild/${GUILD}/config`);
	assert.equal(read.statusCode, 200);
	assert.deepEqual(read.json().pluginConfigs, []);
	const write = await h.inject(MEMBER, "PUT", `/api/guild/${GUILD}/config`, {
		serverConfig: { aiEnabled: true }, pluginConfig: { pluginName: PLUGIN, data: { label: "changed" } },
	});
	assert.equal(write.statusCode, 403);
	assert.equal(h.serverConfigs.size, 0, "authorize the whole request before any writes");
	assert.equal((await h.db.getPluginConfig(GUILD, PLUGIN)).data.label, "private");
});

test("api-runtime: core config writes cannot move a document to another guild", async (t) => {
	const h = await harness(t);
	const write = await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/config`, { serverConfig: { guildId: OTHER_GUILD } });
	assert.equal(write.statusCode, 400);
	assert.equal(h.serverConfigs.size, 0);
});

test("api-runtime: plugin toggles are explicit booleans and scoped to one guild", async (t) => {
	const h = await harness(t);
	const route = `/api/guild/${GUILD}/plugins/${PLUGIN}/enabled`;
	assert.equal((await h.inject(ADMIN, "PUT", route, { enabled: true })).statusCode, 200);
	assert.equal(h.pm.isEnabledForGuild(GUILD, PLUGIN), true);
	assert.equal(h.pm.isEnabledForGuild(OTHER_GUILD, PLUGIN), false);
	assert.equal(h.client.guilds.cache.get(GUILD).commands.body.length, 1);
	for (const body of [{}, { enabled: "true" }, { enabled: null }]) {
		assert.equal((await h.inject(ADMIN, "PUT", route, body)).statusCode, 400);
		assert.equal(h.pm.isEnabledForGuild(GUILD, PLUGIN), true);
	}
	assert.equal((await h.inject(ADMIN, "PUT", route, { enabled: false })).statusCode, 200);
	assert.equal(h.client.guilds.cache.get(GUILD).commands.body.length, 0);
});

test("api-runtime: failed persistence cannot change the runtime enable gate", async (t) => {
	const h = await harness(t);
	t.mock.method(h.db, "setPluginEnabledForGuild", async () => { throw new Error("fake database unavailable"); });
	assert.equal((await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/plugins/${PLUGIN}/enabled`, { enabled: true })).statusCode, 500);
	assert.equal(h.pm.isEnabledForGuild(GUILD, PLUGIN), false);
});

test("api-runtime: only host owners can lift a global plugin suspension", async (t) => {
	const h = await harness(t);
	let suspended = true;
	h.pm.broker = { reinstate() { suspended = false; return true; } };
	for (const user of [MEMBER, ADMIN, OUTSIDER]) {
		assert.equal((await h.inject(user, "POST", `/api/plugins/${PLUGIN}/reinstate`)).statusCode, 403);
		assert.equal(suspended, true);
	}
	assert.equal((await h.inject(OWNER, "POST", `/api/plugins/${PLUGIN}/reinstate`)).statusCode, 200);
	assert.equal(suspended, false);
});

test("api-runtime: grants take effect and revoke cached access without a new login", async (t) => {
	const h = await harness(t);
	assert.equal((await h.inject(MEMBER, "GET", `/api/guild/${GUILD}`)).statusCode, 403);
	const grant = `/api/guild/${GUILD}/roles/grants/${ROLE}`;
	assert.equal((await h.inject(ADMIN, "PUT", grant, { permissions: ["guild.view"] })).statusCode, 200);
	assert.equal((await h.inject(MEMBER, "GET", `/api/guild/${GUILD}`)).statusCode, 200);
	assert.equal((await h.inject(MEMBER, "POST", "/api/plugins/install", { packageName: PLUGIN })).statusCode, 403);
	assert.equal((await h.inject(ADMIN, "DELETE", grant)).statusCode, 200);
	assert.equal((await h.inject(MEMBER, "GET", `/api/guild/${GUILD}`)).statusCode, 403);
});

function registryEntry(overrides = {}) {
	return { name: PLUGIN, npmPackage: PLUGIN, displayName: "Runtime", description: "Test plugin", author: "Tests", category: "utility", version: "2.0.0", permissions: ["db.read"], ...overrides };
}

test("api-runtime: update installs the registry version, not the already-installed local version", async (t) => {
	const h = await harness(t);
	registry.registry = [registryEntry()];
	t.mock.method(registry, "getFreshPluginVersions", async () => new Map([[PLUGIN, { version: "1.0.0", npmPackage: PLUGIN, fromLocal: true }]]));
	h.disk.get(PLUGIN).manifest.version = "2.0.0";
	const res = await h.inject(OWNER, "POST", "/api/plugins/update", { packageName: PLUGIN });
	assert.equal(res.statusCode, 200, res.body);
	assert.deepEqual(h.npmCalls[0], { command: "npm", args: ["install", `${PLUGIN}@2.0.0`] });
	assert.equal(h.pm.getManifest(PLUGIN).version, "2.0.0");
});

test("api-runtime: registry metadata never fabricates npmPackage from a local manifest", async (t) => {
	const h = await harness(t);
	const entry = registryEntry();
	delete entry.npmPackage;
	registry.registry = [entry];
	t.mock.method(registry, "getFreshPluginVersions", async () => new Map([[PLUGIN, { version: "1.0.0", npmPackage: PLUGIN }]]));
	assert.equal((await h.inject(OWNER, "POST", "/api/plugins/update", { packageName: PLUGIN })).statusCode, 422);
	assert.equal(h.npmCalls.length, 0);
});

test("api-runtime: update rejects missing registry versions before invoking npm", async (t) => {
	const h = await harness(t);
	const entry = registryEntry();
	delete entry.version;
	registry.registry = [entry];
	assert.equal((await h.inject(OWNER, "POST", "/api/plugins/update", { packageName: PLUGIN })).statusCode, 422);
	assert.equal(h.npmCalls.length, 0);
});

test("api-runtime: pre-install risk disclosure fails closed without permission metadata", async (t) => {
	const h = await harness(t);
	const entry = registryEntry();
	delete entry.permissions;
	registry.registry = [entry];
	assert.equal((await h.inject(OWNER, "GET", `/api/plugins/registry/${PLUGIN}/risk-card`)).statusCode, 422);
	entry.permissions = ["future.unknown"];
	assert.equal((await h.inject(OWNER, "GET", `/api/plugins/registry/${PLUGIN}/risk-card`)).statusCode, 422);
	entry.permissions = ["db.read"];
	const response = await h.inject(OWNER, "GET", `/api/plugins/registry/${PLUGIN}/risk-card`);
	assert.equal(response.statusCode, 200);
	assert.ok(response.json().granted.length > 0);
	assert.ok(response.json().withheld.length > 0);
});

test("api-runtime: successful npm completion refreshes live plugin code and metadata", async (t) => {
	const h = await harness(t);
	h.disk.get(PLUGIN).manifest.version = "2.0.0";
	const res = await h.inject(OWNER, "POST", "/api/plugins/install", { packageName: `${PLUGIN}@2.0.0` });
	assert.equal(res.statusCode, 200, res.body);
	assert.equal(h.pm.getManifest(PLUGIN).version, "2.0.0");
	assert.equal(h.client.commands.get("runtime").data.description, "2.0.0");
});

test("api-runtime: install does not claim success when the plugin fails to load", async (t) => {
	const h = await harness(t);
	h.pm.plugins.delete(PLUGIN);
	t.mock.method(h.pm, "_loadPluginDirect", async () => { throw new Error("runtime load failed"); });
	const response = await h.inject(OWNER, "POST", "/api/plugins/install", { packageName: PLUGIN });
	assert.equal(response.statusCode, 500);
	assert.match(response.json().error, /runtime load failed/);
});

test("api-runtime: scoped npm installs preserve the package name in persistence", async (t) => {
	const h = await harness(t);
	const pkg = "@runtime/adb-plugin-example";
	h.disk.set(pkg, { ...h.disk.get(PLUGIN), name: pkg, packageName: pkg, manifest: { ...h.disk.get(PLUGIN).manifest, name: pkg } });
	assert.equal((await h.inject(OWNER, "POST", "/api/plugins/install", { packageName: `${pkg}@1.0.0` })).statusCode, 200);
	assert.equal(h.recordInstall.mock.calls[0].arguments[0], pkg);
});

test("api-runtime: member data and declared actions stay scoped to guild and user", async (t) => {
	const h = await harness(t);
	h.pm.setEnabledForGuild(GUILD, PLUGIN, true);
	const rows = [
		{ _id: "row1", guildId: GUILD, userId: MEMBER, label: "mine", done: false },
		{ _id: "row2", guildId: GUILD, userId: ADMIN, label: "not mine", done: false },
		{ _id: "row3", guildId: OTHER_GUILD, userId: MEMBER, label: "other guild", done: false },
	];
	const matches = (row, scope) => Object.entries(scope).every(([key, value]) => row[key] === value);
	const modelName = `plugin_${PLUGIN}_Item`;
	mongoose.models[modelName] = {
		find(scope) {
			return { lean() { return this; }, sort() { return this; }, limit() { return this; }, async exec() { return rows.filter((r) => matches(r, scope)).map(clone); } };
		},
		async updateOne(scope, update) {
			const row = rows.find((r) => matches(r, scope));
			if (row) Object.assign(row, update.$set);
			return { matchedCount: row ? 1 : 0 };
		},
		async deleteOne(scope) {
			const index = rows.findIndex((r) => matches(r, scope));
			if (index >= 0) rows.splice(index, 1);
			return { deletedCount: index >= 0 ? 1 : 0 };
		},
	};
	t.after(() => { delete mongoose.models[modelName]; });
	const base = `/api/me/guild/${GUILD}/plugins/${PLUGIN}`;
	const data = await h.inject(MEMBER, "GET", `${base}/data?path=%2Fitems&userId=${ADMIN}&guildId=${OTHER_GUILD}`);
	assert.equal(data.statusCode, 200);
	assert.deepEqual(data.json().rows.map((r) => r.id), ["row1"]);
	for (const rowId of ["row2", "row3"]) {
		assert.deepEqual((await h.inject(MEMBER, "POST", `${base}/action`, { path: "/items", actionId: "delete", rowId })).json(), { ok: false });
	}
	assert.deepEqual((await h.inject(MEMBER, "POST", `${base}/action`, { path: "/items", actionId: "done", rowId: "row1", op: "delete", userId: ADMIN })).json(), { ok: true });
	assert.equal(rows[0].done, true);
	assert.equal(rows.length, 3);
	assert.equal((await h.inject(OUTSIDER, "GET", `${base}/data?path=%2Fitems`)).statusCode, 403);
	h.pm.setEnabledForGuild(GUILD, PLUGIN, false);
	assert.equal((await h.inject(MEMBER, "GET", `${base}/data?path=%2Fitems`)).statusCode, 404);
});

test("api-runtime: member actions reject query objects rather than forwarding Mongo operators", async (t) => {
	const h = await harness(t);
	h.pm.setEnabledForGuild(GUILD, PLUGIN, true);
	const modelName = `plugin_${PLUGIN}_Item`;
	let writes = 0;
	mongoose.models[modelName] = { async deleteOne() { writes++; return { deletedCount: 1 }; } };
	t.after(() => { delete mongoose.models[modelName]; });
	const response = await h.inject(MEMBER, "POST", `/api/me/guild/${GUILD}/plugins/${PLUGIN}/action`, { path: "/items", actionId: "delete", rowId: { $ne: null } });
	assert.equal(response.statusCode, 400);
	assert.equal(writes, 0);
});

test("api-runtime: OAuth rejects external return URLs and consumes state after login", async (t) => {
	const h = await harness(t);
	for (const redirect of ["https://outside.test", "//outside.test", "/\\outside.test", "/\n/outside.test"]) {
		assert.equal((await h.inject(null, "GET", `/auth/discord?redirect=${encodeURIComponent(redirect)}`)).statusCode, 400, redirect);
	}
	t.mock.method(axios, "post", async () => ({ data: { access_token: "fake-oauth-token" } }));
	t.mock.method(axios, "get", async (url) => ({ data: url.endsWith("/guilds") ? [{ id: GUILD }] : { id: MEMBER } }));
	const login = await h.inject(null, "GET", "/auth/discord?redirect=%2Fme");
	const state = new URL(login.headers.location).searchParams.get("state");
	const cookie = responseCookie(login);
	const url = `/auth/discord/callback?code=runtime-code&state=${state}`;
	const callback = await h.inject(null, "GET", url, undefined, { headers: { cookie } });
	assert.equal(callback.statusCode, 302);
	assert.equal(callback.headers.location, "/me");
	const authenticatedCookie = responseCookie(callback) || cookie;
	assert.equal((await h.inject(null, "GET", url, undefined, { headers: { cookie: authenticatedCookie } })).statusCode, 400);
});

test("api-runtime: logout waits for session destruction before reporting completion", async (t) => {
	const h = await harness(t);
	const response = await h.inject(MEMBER, "POST", "/auth/logout");
	assert.equal(response.statusCode, 200);
	assert.equal(h.sessions.has(`runtime-${MEMBER}`), false);
	assert.equal((await h.inject(MEMBER, "GET", "/api/me")).statusCode, 401);
});

test("api-runtime: always-on plugins report the same enable state in settings and the guild list", async (t) => {
	const h = await harness(t);
	h.pm.plugins.get(PLUGIN).source = "local";
	const settings = await h.inject(ADMIN, "GET", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`);
	const list = await h.inject(ADMIN, "GET", `/api/guild/${GUILD}/plugins`);
	assert.equal(settings.json().enabled, true);
	assert.equal(list.json().plugins[0].enabledForGuild, true);
	assert.equal((await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/plugins/${PLUGIN}/enabled`, { enabled: false })).statusCode, 400);
});

test("api-runtime: administrator permission catalogs refresh after plugin loads", async (t) => {
	const h = await harness(t);
	await h.inject(ADMIN, "GET", `/api/guild/${GUILD}`);
	const name = "adb-plugin-new";
	h.pm.plugins.set(name, { ...h.pm.initPluginState(name, {}), source: "local" });
	await h.hooks.emitHook("onPluginLoad", { pluginName: name });
	assert.equal((await h.inject(ADMIN, "GET", `/api/guild/${GUILD}/plugins/${name}/settings`)).statusCode, 200);
});

test("api-runtime: custom dashboard permissions do not remove platform settings permissions", async (t) => {
	const h = await harness(t, { grants: [{ roleId: ROLE, permissions: [`plugin.${PLUGIN}.reports`] }] });
	h.pm.plugins.get(PLUGIN).manifest.dashboard = { permissions: ["reports"] };
	assert.equal((await h.inject(ADMIN, "GET", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`)).statusCode, 200);
	assert.equal((await h.inject(MEMBER, "PUT", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`, { label: "no" })).statusCode, 403);
});

test("api-runtime: role and guild events invalidate cached administrator access", async (t) => {
	const h = await harness(t);
	const guild = h.client.guilds.cache.get(GUILD);
	assert.equal((await h.inject(ADMIN, "GET", `/api/guild/${GUILD}`)).statusCode, 200);
	guild.ownerId = OWNER;
	guild.members.cache.get(ADMIN).permissions.bitfield = 0n;
	h.client.emit("roleUpdate", {}, { guild });
	assert.equal((await h.inject(ADMIN, "GET", `/api/guild/${GUILD}`)).statusCode, 403);
	assert.equal((await h.inject(MEMBER, "GET", `/api/me/guild/${GUILD}/pages`)).statusCode, 200);
	h.client.guilds.cache.delete(GUILD);
	h.client.emit("guildDelete", guild);
	assert.equal((await h.inject(MEMBER, "GET", `/api/me/guild/${GUILD}/pages`)).statusCode, 403);
});

test("api-runtime: closing the API releases Discord listeners, hooks and the session store", async (t) => {
	const h = await harness(t);
	const close = t.mock.method(h.store, "close", async () => {});
	assert.ok(h.client.listenerCount("guildMemberUpdate") > 0);
	await h.fastify.close();
	assert.equal(h.client.listenerCount("guildMemberUpdate"), 0);
	assert.equal(h.hooks.anyHandlers.length, 0);
	assert.equal(close.mock.callCount(), 1);
});

test("api-runtime: a failed update-all job does not abort later plugins", async (t) => {
	const h = await harness(t);
	const next = "adb-plugin-next";
	h.pm.plugins.set(next, { ...h.pm.initPluginState(next, { version: "1.0.0" }), source: "package", packageName: next });
	h.disk.set(next, { ...h.disk.get(PLUGIN), name: next, packageName: next, manifest: { name: next, version: "2.0.0" } });
	t.mock.method(registry, "searchPlugins", async () => [registryEntry(), registryEntry({ name: next, npmPackage: next })]);
	const spawnSuccess = spawnFake;
	spawnFake = (command, args) => {
		if (args[1] === `${PLUGIN}@2.0.0`) throw new Error("fake spawn failed");
		return spawnSuccess(command, args);
	};
	const response = await h.inject(OWNER, "POST", "/api/plugins/update-all");
	assert.equal(response.statusCode, 200, response.body);
	assert.equal(response.json().ok, false);
	assert.deepEqual(response.json().updated.map((row) => row.ok), [false, true]);
	assert.equal(h.pm.getManifest(next).version, "2.0.0");
});

test("api-runtime: npm spawn errors are handled and returned, not emitted unhandled", async (t) => {
	const h = await harness(t);
	spawnFake = () => {
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		// Avoid crashing the runner on the buggy implementation; the route must
		// still handle this error itself rather than waiting for a close code.
		child.on("error", () => {});
		setImmediate(() => { child.emit("error", new Error("spawn npm ENOENT")); child.emit("close", -2); });
		return child;
	};
	for (const operation of ["install", "uninstall"]) {
		const response = await h.inject(OWNER, "POST", `/api/plugins/${operation}`, { packageName: PLUGIN });
		assert.equal(response.statusCode, 500);
		assert.match(response.json().error, /ENOENT/);
	}
});

test("api-runtime: invalid uninstall targets do not unload running plugins", async (t) => {
	const h = await harness(t);
	h.pm.plugins.get(PLUGIN).packageName = "not-an-adb-package";
	const response = await h.inject(OWNER, "POST", "/api/plugins/uninstall", { packageName: PLUGIN });
	assert.equal(response.statusCode, 400);
	assert.equal(h.pm.plugins.has(PLUGIN), true);
});

test("api-runtime: registry version comparison preserves prerelease ordering", async (t) => {
	const h = await harness(t);
	h.pm.plugins.get(PLUGIN).manifest.version = "2.0.0-beta.1";
	registry.registry = [registryEntry()];
	const response = await h.inject(OWNER, "GET", "/api/plugins/marketplace");
	assert.equal(response.json().plugins[0].updateAvailable, true);
	assert.equal(registry.isNewer("2.0.0", "2.0.0-beta.2"), false);
});

test("api-runtime: member row IDs always refer to the database ID, not plugin data fields", async (t) => {
	const h = await harness(t);
	h.pm.setEnabledForGuild(GUILD, PLUGIN, true);
	const modelName = `plugin_${PLUGIN}_Item`;
	mongoose.models[modelName] = {
		find() {
			return { lean() { return this; }, sort() { return this; }, limit() { return this; }, async exec() { return [{ _id: "database-id", id: "plugin-business-id", label: "Mine" }]; } };
		},
	};
	t.after(() => { delete mongoose.models[modelName]; });
	const response = await h.inject(MEMBER, "GET", `/api/me/guild/${GUILD}/plugins/${PLUGIN}/data?path=%2Fitems`);
	assert.equal(response.json().rows[0].id, "database-id");
});

test("api-runtime: malformed member database IDs are client errors, not server failures", async (t) => {
	const h = await harness(t);
	h.pm.setEnabledForGuild(GUILD, PLUGIN, true);
	const modelName = `plugin_${PLUGIN}_Item`;
	mongoose.models[modelName] = { async deleteOne() { throw new mongoose.Error.CastError("ObjectId", "bad-id", "_id"); } };
	t.after(() => { delete mongoose.models[modelName]; });
	const response = await h.inject(MEMBER, "POST", `/api/me/guild/${GUILD}/plugins/${PLUGIN}/action`, { path: "/items", actionId: "delete", rowId: "bad-id" });
	assert.equal(response.statusCode, 400);
});

test("api-runtime: empty command collections are reported as zero public commands", async (t) => {
	const h = await harness(t);
	h.client.commands.clear();
	assert.equal((await h.inject(null, "GET", "/api/public-stats")).json().commandsCount, 0);
});

test("api-runtime: core config validates schema fields before writing and supports a real round-trip", async (t) => {
	const h = await harness(t);
	const route = `/api/guild/${GUILD}/config`;
	for (const patch of [{ aiMode: "unknown" }, { xpPerMessage: "not-a-number" }, { notASetting: 1 }]) {
		assert.equal((await h.inject(ADMIN, "PUT", route, { serverConfig: patch })).statusCode, 400, JSON.stringify(patch));
		assert.equal(h.serverConfigs.size, 0);
	}
	assert.equal((await h.inject(ADMIN, "PUT", route, { serverConfig: { aiEnabled: true, aiMode: "context" } })).statusCode, 200);
	const read = await h.inject(ADMIN, "GET", route);
	assert.equal(read.json().serverConfig.guildId, GUILD);
	assert.equal(read.json().serverConfig.aiMode, "context");
});

test("api-runtime: settings honor configSchema bounds without discarding unknown stored data", async (t) => {
	const h = await harness(t);
	h.pm.plugins.get(PLUGIN).manifest.configSchema = { properties: { count: { type: "number", minimum: 3, maximum: 5 } } };
	await h.db.updatePluginConfig(GUILD, PLUGIN, { internal: { cursor: 1 } });
	const route = `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`;
	assert.equal((await h.inject(ADMIN, "PUT", route, { count: 2 })).statusCode, 400);
	assert.equal((await h.inject(ADMIN, "PUT", route, { count: 4, role: ROLE, channel: CHANNEL, active: false, mode: "safe" })).statusCode, 200);
	assert.deepEqual((await h.db.getPluginConfig(GUILD, PLUGIN)).data.internal, { cursor: 1 });
});

test("api-runtime: published category IDs find their registry entries", async (t) => {
	const h = await harness(t);
	registry.registry = [registryEntry({ category: "core features" })];
	const categories = (await h.inject(OWNER, "GET", "/api/plugins/categories")).json().categories;
	const category = categories.find((entry) => entry.name === "Features");
	const response = await h.inject(OWNER, "GET", `/api/plugins/marketplace?category=${encodeURIComponent(category.id)}`);
	assert.equal(response.json().plugins.length, 1);
});

test("api-runtime: failed registry refresh retains the last known in-memory metadata", async (t) => {
	const h = await harness(t);
	registry.registry = [registryEntry()];
	t.mock.method(axios, "get", async () => { throw new Error("fake offline registry"); });
	t.mock.method(registry, "loadCache", () => [registryEntry({ version: "1.0.0" })]);
	const response = await h.inject(OWNER, "GET", "/api/plugins/marketplace?refresh=1");
	assert.equal(response.json().plugins[0].version, "2.0.0");
});

test("api-runtime: manual unload synchronizes away the unloaded plugin commands", async (t) => {
	const h = await harness(t);
	await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/plugins/${PLUGIN}/enabled`, { enabled: true });
	assert.equal(h.client.guilds.cache.get(GUILD).commands.body.length, 1);
	const response = await h.inject(OWNER, "POST", `/api/plugins/unload/${PLUGIN}`);
	assert.equal(response.statusCode, 200);
	assert.equal(h.client.guilds.cache.get(GUILD).commands.body.length, 0);
});

test("api-runtime: install completion reports failed command synchronization", async (t) => {
	const h = await harness(t);
	t.mock.method(h.client.guilds.cache.get(GUILD).commands, "set", async () => { throw new Error("fake Discord sync failure"); });
	const response = await h.inject(OWNER, "POST", "/api/plugins/install", { packageName: PLUGIN });
	assert.equal(response.statusCode, 500);
	assert.match(response.json().error, /command.*sync/i);
});

test("api-runtime: a failed npm uninstall does not disable the still-installed runtime", async (t) => {
	const h = await harness(t);
	spawnFake = () => {
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		setImmediate(() => child.emit("close", 1));
		return child;
	};
	assert.equal((await h.inject(OWNER, "POST", "/api/plugins/uninstall", { packageName: PLUGIN })).statusCode, 500);
	assert.equal(h.pm.plugins.has(PLUGIN), true);
	assert.equal(h.client.commands.has("runtime"), true);
});

test("api-runtime: grant edits reject unknown roles and malformed permission sets without revoking existing grants", async (t) => {
	const h = await harness(t, { grants: [{ roleId: ROLE, permissions: ["guild.view"] }] });
	for (const [role, body] of [[ROLE, {}], [ROLE, { permissions: "guild.view" }], [ROLE, { permissions: ["nonexistent"] }], [OTHER_GUILD, { permissions: ["guild.view"] }]]) {
		assert.equal((await h.inject(ADMIN, "PUT", `/api/guild/${GUILD}/roles/grants/${role}`, body)).statusCode, 400);
		assert.deepEqual(h.roleGrants.get(GUILD), [{ roleId: ROLE, permissions: ["guild.view"] }]);
	}
});

test("api-runtime: updates that require restart retain the live instance and disclose pending activation", async (t) => {
	const h = await harness(t);
	h.pm.plugins.get(PLUGIN).manifest.requiresRestart = true;
	h.disk.get(PLUGIN).manifest.version = "2.0.0";
	const live = h.pm.plugins.get(PLUGIN);
	registry.registry = [registryEntry()];
	const response = await h.inject(OWNER, "POST", "/api/plugins/update", { packageName: PLUGIN });
	assert.equal(response.statusCode, 200, response.body);
	assert.equal(response.json().restartRequired, true);
	assert.equal(h.pm.plugins.get(PLUGIN), live);
	assert.equal(h.pm.getManifest(PLUGIN).version, "1.0.0");
	assert.equal(h.npmCalls[0].args[1], `${PLUGIN}@2.0.0`);
});

test("api-runtime: a new release can require restart even when its running predecessor did not", async (t) => {
	const h = await harness(t);
	h.disk.get(PLUGIN).manifest.version = "2.0.0";
	h.disk.get(PLUGIN).manifest.requiresRestart = true;
	const live = h.pm.plugins.get(PLUGIN);
	registry.registry = [registryEntry()];
	const response = await h.inject(OWNER, "POST", "/api/plugins/update", { packageName: PLUGIN });
	assert.equal(response.statusCode, 200, response.body);
	assert.equal(response.json().restartRequired, true);
	assert.equal(h.pm.plugins.get(PLUGIN), live, "Keep compiled models and live code together until restart");
});

test("api-runtime: secret settings are write-only in viewer, configure, bulk and member responses", async (t) => {
	const h = await harness(t, { grants: [{ roleId: ROLE, permissions: ["guild.view", `plugin.${PLUGIN}.view`] }] });
	const manifest = h.pm.plugins.get(PLUGIN).manifest;
	manifest.settings.schema.push(
		{ key: "lavalink_password", type: "string", secret: true, default: "secret-default" },
		{ key: "write_only_key", type: "string" },
		{ key: "password_key", type: "string" },
	);
	manifest.configSchema = { properties: { write_only_key: { writeOnly: true }, password_key: { format: "password" } } };
	const stored = { label: "visible", lavalink_password: "stored-secret", write_only_key: "write-only-secret", password_key: "format-secret" };
	await h.db.updatePluginConfig(GUILD, PLUGIN, stored);
	t.mock.method(h.db, "getAllPluginConfigs", async () => [new models.PluginConfig({ guildId: GUILD, pluginName: PLUGIN, data: stored })]);
	for (const user of [MEMBER, ADMIN]) {
		const response = await h.inject(user, "GET", `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`);
		assert.equal(response.statusCode, 200);
		assert.deepEqual(response.json().config, { label: "visible" });
		assert.deepEqual(response.json().configuredSecrets, { lavalink_password: true, write_only_key: true, password_key: true });
		assert.ok(response.json().settingsSchema.filter((field) => field.key.endsWith("_key") || field.key === "lavalink_password").every((field) => field.secret === true && !("default" in field)));
		for (const route of [`/api/guild/${GUILD}/config`, `/api/guild/${GUILD}/plugins`, "/api/plugins"]) {
			const read = await h.inject(user, "GET", route);
			assert.equal(read.statusCode, 200);
			assert.doesNotMatch(read.body, /stored-secret|write-only-secret|format-secret|secret-default/);
		}
	}
	h.pm.setEnabledForGuild(GUILD, PLUGIN, true);
	const modelName = `plugin_${PLUGIN}_Item`;
	mongoose.models[modelName] = { find() { return { lean() { return this; }, sort() { return this; }, limit() { return this; }, async exec() { return [{ _id: "row1", guildId: GUILD, userId: MEMBER, ...stored }]; } }; } };
	t.after(() => { delete mongoose.models[modelName]; });
	const member = await h.inject(MEMBER, "GET", `/api/me/guild/${GUILD}/plugins/${PLUGIN}/data?path=%2Fitems`);
	assert.equal(member.statusCode, 200);
	assert.doesNotMatch(member.body, /stored-secret|write-only-secret|format-secret/);
	assert.deepEqual((await h.db.getPluginConfig(GUILD, PLUGIN)).data, stored, "redaction must not mutate stored settings");
});

test("api-runtime: untouched secrets survive ordinary and bulk saves; only configure grants can replace or clear them", async (t) => {
	const h = await harness(t, { grants: [{ roleId: ROLE, permissions: ["guild.view", "guild.configure", `plugin.${PLUGIN}.view`] }] });
	h.pm.plugins.get(PLUGIN).manifest.settings.schema.push({ key: "lavalink_password", type: "string", secret: true, default: "" });
	await h.db.updatePluginConfig(GUILD, PLUGIN, { label: "before", lavalink_password: "original-secret", _commands: { runtime: { enabled: false } } });
	const route = `/api/guild/${GUILD}/plugins/${PLUGIN}/settings`;
	for (const [url, payload] of [[route, { label: "after" }], [`/api/guild/${GUILD}/config`, { pluginConfig: { pluginName: PLUGIN, data: { count: 5 } } }]]) {
		const write = await h.inject(ADMIN, "PUT", url, payload);
		assert.equal(write.statusCode, 200);
		assert.doesNotMatch(write.body, /original-secret/);
		assert.equal((await h.db.getPluginConfig(GUILD, PLUGIN)).data.lavalink_password, "original-secret");
	}
	for (const value of ["replacement-secret", ""]) {
		assert.equal((await h.inject(MEMBER, "PUT", route, { lavalink_password: value })).statusCode, 403);
		assert.equal((await h.inject(MEMBER, "PUT", `/api/guild/${GUILD}/config`, { pluginConfig: { pluginName: PLUGIN, data: { lavalink_password: value } } })).statusCode, 403);
		const write = await h.inject(ADMIN, "PUT", route, { lavalink_password: value });
		assert.equal(write.statusCode, 200);
		assert.equal(write.json().configuredSecrets.lavalink_password, value !== "");
		assert.ok(!Object.hasOwn(write.json().config, "lavalink_password"));
		const saved = await h.db.getPluginConfig(GUILD, PLUGIN);
		assert.equal(saved.data.lavalink_password, value);
		assert.deepEqual(saved.data._commands, { runtime: { enabled: false } });
	}
});
