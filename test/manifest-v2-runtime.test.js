const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PluginManager } = require("../core/PluginManager");

function makeManager() {
	return new PluginManager({
		client: { commands: new Map(), on() {}, once() {}, off() {} },
		db: {},
		scheduler: {},
		hooks: { emitHook: async () => {} },
	});
}

test("a v2 manifest drives worker capabilities, env grants, and network hosts", async (t) => {
	const manager = makeManager();
	manager.isolationEnabled = true;
	let spawn;
	manager.workerManager = {
		workers: new Map(),
		spawnWorker: async (...args) => {
			spawn = args;
		},
	};
	t.after(async () => {
		if (manager.plugins.has("v2-plugin")) {
			await manager.unloadPlugin("v2-plugin", "test");
		}
	});

	const previousToken = process.env.DISCORD_TOKEN;
	const previousVisible = process.env.ADB_TEST_VISIBLE;
	process.env.DISCORD_TOKEN = "must-not-leak";
	process.env.ADB_TEST_VISIBLE = "visible";
	t.after(() => {
		if (previousToken === undefined) delete process.env.DISCORD_TOKEN;
		else process.env.DISCORD_TOKEN = previousToken;
		if (previousVisible === undefined) delete process.env.ADB_TEST_VISIBLE;
		else process.env.ADB_TEST_VISIBLE = previousVisible;
	});

	await manager.loadPlugin({
		name: "v2-plugin",
		source: "package",
		entryPath: "/nonexistent/v2-plugin/index.js",
		basePath: "/nonexistent/v2-plugin",
		manifest: {
			manifestVersion: 2,
			permissions: {
				storage: ["own-collection"],
				discord: ["SendMessages"],
				system: ["env"],
				network: { outbound: ["api.example.com"] },
			},
		},
	});

	const state = manager.plugins.get("v2-plugin");
	assert.ok(spawn, "worker should be spawned");
	const [pluginId, , capabilities, , options] = spawn;
	assert.equal(pluginId, "v2-plugin");
	assert.deepEqual(capabilities.storage, ["own-collection"]);
	assert.deepEqual(capabilities.discord, ["SendMessages"]);
	assert.deepEqual(capabilities.network, ["outbound-http"]);
	assert.deepEqual(capabilities.system, ["env"]);
	assert.deepEqual(options.networkAllowlist, ["api.example.com"]);

	const env = manager.grantedEnv(state.permissions);
	assert.equal(env.ADB_TEST_VISIBLE, "visible");
	assert.equal(env.DISCORD_TOKEN, undefined);
});

test("v2 raw-client permission disables the per-guild gate", () => {
	const manager = makeManager();
	const state = manager.initPluginState("raw-plugin", {
		manifestVersion: 2,
		permissions: { system: ["raw-client"] },
	});
	state.source = "package";
	manager.plugins.set("raw-plugin", state);

	assert.equal(manager.isGuildGateable("raw-plugin"), false);
});
