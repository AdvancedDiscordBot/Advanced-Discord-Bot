const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isMainThread, workerData } = require("node:worker_threads");
const { PluginManager } = require("../core/PluginManager");
const { HookBus } = require("../core/HookBus");

let scenario;
module.exports.load = (ctx) => !isMainThread && workerData.pluginId === "starting-worker"
	? new Promise(() => {}) : scenario(ctx);

function setup(t, config = {}) {
	const client = new EventEmitter();
	client.commands = new Map();
	const hooks = new HookBus();
	const manager = new PluginManager({ client, hooks, db: {}, scheduler: {}, config });
	t.after(() => manager.shutdown());
	const load = (name = "fixture", manifest = {}) => manager.loadPlugin({ name, manifest, source: "local", entryPath: __filename });
	return { client, hooks, manager, load };
}

if (require.main === module) {
	test("real PluginContext off/offAny remove only that plugin's wrapped handlers", async (t) => {
		const f = setup(t);
		let ctx;
		let count = 0;
		const handler = () => { count++; };
		const removeExternal = f.hooks.on("test", handler);
		const removeExternalAny = f.hooks.onAny(handler);
		scenario = (context) => {
			ctx = context;
			ctx.hooks.on("test", handler);
			ctx.hooks.onAny(handler);
		};
		await f.load();
		ctx.hooks.off("test", handler);
		ctx.hooks.offAny(handler);
		count = 0;
		await f.hooks.emitHook("test", {});
		assert.equal(count, 2, "external handlers survive; plugin wrappers do not");
		removeExternal();
		removeExternalAny();
		count = 0;
		await f.hooks.emitHook("test", {});
		assert.equal(count, 0);
	});

	test("unload awaits self-cleanup, then removes hooks, events and commands", async (t) => {
		const f = setup(t);
		let cleaned = false;
		let calls = 0;
		scenario = (ctx) => {
			ctx.registerCommand({ data: { name: "fixture" }, execute() {} });
			ctx.registerEvent("messageCreate", () => { calls++; });
			ctx.hooks.on("test", () => { calls++; });
			ctx.hooks.onAny(() => { calls++; });
			ctx.hooks.on("onPluginUnload", async ({ pluginName }) => {
				if (pluginName !== "fixture") return;
				assert.equal(f.client.commands.has("fixture"), true, "self-cleanup runs before removal");
				await new Promise((resolve) => setImmediate(resolve));
				cleaned = true;
			});
		};
		await f.load();
		await f.manager.unloadPlugin("fixture");
		assert.equal(cleaned, true);
		assert.equal(f.client.commands.size, 0);
		assert.equal(f.client.listenerCount("messageCreate"), 0);
		calls = 0;
		await f.hooks.emitHook("test", {});
		assert.equal(calls, 0);
	});

	test("partial load failure runs registered cleanup and removes all hook subscriptions", async (t) => {
		const f = setup(t);
		let cleanups = 0;
		scenario = (ctx) => {
			ctx.hooks.on("test", () => { throw new Error("must be removed"); });
			ctx.hooks.onAny(() => {});
			ctx.hooks.on("onPluginUnload", ({ pluginName, reason }) => {
				if (pluginName === "fixture" && reason === "load-failed") cleanups++;
			});
			throw new Error("load failed");
		};
		await f.load();
		assert.equal(cleanups, 1);
		assert.equal(f.manager.plugins.get("fixture").enabled, false);
		assert.equal(f.hooks.anyHandlers.length, 0);
		assert.equal(f.hooks.handlers.get("test").length, 0);
	});

	test("shutdown closes real watchers, cancels reloads, unloads in reverse order and clears core", async (t) => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "adb-hook-shutdown-"));
		t.after(() => fs.rmSync(root, { force: true, recursive: true }));
		const f = setup(t);
		const unloaded = [];
		const core = f.manager.initPluginState("core", {});
		f.manager.plugins.set("core", core);
		f.manager.registerEvent("core", "core-test", () => {});
		for (const name of ["first", "second"]) {
			scenario = (ctx) => ctx.hooks.on("onPluginUnload", ({ pluginName }) => { if (pluginName === name) unloaded.push(name); });
			await f.load(name);
			f.manager.plugins.get(name).path = root;
		}
		f.manager.setupHotReload();
		const watchers = [...f.manager.watchers.values()];
		await Promise.all(watchers.map((watcher) => once(watcher, "ready")));
		for (const watcher of watchers) watcher.emit("change", path.join(root, "changed.js"));
		const first = f.manager.shutdown();
		assert.equal(f.manager.shutdown(), first);
		await first;
		assert.deepEqual(unloaded, ["second", "first"]);
		assert.equal(f.manager.watchers.size, 0);
		assert.ok(watchers.every((watcher) => watcher.closed));
		assert.equal(f.client.listenerCount("core-test"), 0);
		assert.equal(f.manager.plugins.size, 0);
		await assert.rejects(f.load("late"), /shut/i);
		await new Promise((resolve) => setTimeout(resolve, 250));
		assert.equal(f.manager.plugins.size, 0);
	});

	test("shutdown waits for an in-flight load and tears down the worker manager exactly once", async (t) => {
		const f = setup(t);
		let release;
		const gate = new Promise((resolve) => { release = resolve; });
		let stopped = 0;
		f.manager.workerManager = { workers: new Map(), async shutdown() { stopped++; } };
		scenario = async (ctx) => {
			ctx.hooks.on("onPluginUnload", () => {});
			await gate;
		};
		const loading = f.load();
		let finished = false;
		const shutdown = f.manager.shutdown().then(() => { finished = true; });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(finished, false);
		release();
		await Promise.all([loading, shutdown]);
		assert.equal(stopped, 1);
		assert.equal(f.manager.plugins.size, 0);
	});

	test("shutdown waits for core load hooks and removes the real core event registrations", async (t) => {
		const f = setup(t);
		let release;
		const gate = new Promise((resolve) => { release = resolve; });
		f.hooks.on("onPluginLoad", ({ pluginName }) => pluginName === "core" ? gate : undefined);
		const loading = f.manager.loadCore();
		assert.ok(f.client.listenerCount("interactionCreate") > 0);
		let finished = false;
		const shutdown = f.manager.shutdown().then(() => { finished = true; });
		try {
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(finished, false);
		} finally { release(); }
		await Promise.all([loading, shutdown]);
		assert.equal(f.client.listenerCount("interactionCreate"), 0);
		assert.equal(f.client.runtimeCommandDispatch, false);
	});

	test("shutdown interrupts an actual worker still starting without waiting for its startup timeout", async (t) => {
		const f = setup(t);
		f.manager.enableIsolation();
		const loading = f.manager.loadPlugin({ name: "starting-worker", manifest: {}, source: "package", entryPath: __filename });
		await once(f.manager.workerManager.workers.get("starting-worker").worker, "online");
		let deadline;
		try {
			await Promise.race([
				f.manager.shutdown(),
				new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("shutdown waited for worker startup")), 2000); }),
			]);
		} finally {
			clearTimeout(deadline);
			await f.manager.workerManager.terminateWorker("starting-worker");
			await loading;
		}
		assert.equal(f.manager.plugins.size, 0);
		assert.equal(f.manager.workerManager.workers.size, 0);
	});
}
