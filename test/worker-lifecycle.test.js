const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { setImmediate: nextTurn } = require("node:timers/promises");
const workerThreads = require("node:worker_threads");
const { Worker: RealWorker } = workerThreads;
const { HookBus } = require("../core/HookBus");
const { CapabilityBroker } = require("../core/rpc/broker");
const { metricsCollector } = require("../core/rpc/metrics");

// Separate inbound messages from postMessage, enforce structured cloning, and
// emit a nonzero exit on termination, just like a running Node Worker.
class ControlledWorker extends EventEmitter {
	constructor(_script, options) {
		super();
		this.options = structuredClone(options);
		this.sent = [];
		this.terminateCalls = 0;
		this.delayTermination = false;
	}

	postMessage(message) {
		this.sent.push(structuredClone(message));
	}

	exit(code) {
		this.exited = true;
		this.emit("exit", code);
	}

	terminate() {
		this.terminateCalls++;
		if (!this.termination) {
			this.termination = new Promise((resolve) => {
				this.finishTermination = () => {
					if (!this.exited) this.exit(1);
					resolve(1);
				};
			});
			if (!this.delayTermination) this.finishTermination();
		}
		return this.termination;
	}
}

function makeHarness(t, createWorker = (script, options) => new ControlledWorker(script, options)) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const workers = [];
	const modulePath = require.resolve("../core/rpc/worker-manager");
	const cached = require.cache[modulePath];
	let WorkerManager, MAX_CRASH_COUNT;
	try {
		workerThreads.Worker = function (script, options) {
			const worker = createWorker(script, options);
			workers.push(worker);
			return worker;
		};
		delete require.cache[modulePath];
		({ WorkerManager, MAX_CRASH_COUNT } = require(modulePath));
	} finally {
		workerThreads.Worker = RealWorker;
		if (cached) require.cache[modulePath] = cached;
		else delete require.cache[modulePath];
	}

	const logger = { info() {}, warn() {}, error() {}, debug() {} };
	const hooks = new HookBus(logger);
	const db = { getPluginConfig: async (guildId, pluginId) => ({ guildId, pluginId }) };
	const broker = new CapabilityBroker({ db, hooks, client: null });
	const metricsListeners = metricsCollector.listenerCount("call:recorded");
	const manager = new WorkerManager({ broker, hooks });
	manager.logger = broker.logger = logger;
	t.after(async () => {
		for (const worker of workers) {
			worker.delayTermination = false;
			worker.finishTermination?.();
		}
		await manager.shutdown();
		metricsCollector.stop();
		t.mock.timers.reset();
	});
	return {
		manager, broker, hooks, db, workers, MAX_CRASH_COUNT, metricsListeners,
		async tick(ms) {
			t.mock.timers.tick(ms);
			await nextTurn();
		},
		async ready(pluginId = "plugin", capabilities = {}, options = {}) {
			const starting = manager.spawnWorker(pluginId, `/test/${pluginId}.js`, capabilities, pluginId, options);
			await nextTurn();
			const worker = workers.at(-1);
			worker.emit("message", { type: "worker:ready" });
			await starting;
			return worker;
		},
	};
}

function observe(promise) {
	const outcome = {};
	promise.then(() => { outcome.ready = true; }, (error) => { outcome.error = error; });
	return outcome;
}

test("lifecycle: intentional termination does not restart or count as a crash", async (t) => {
	const h = makeHarness(t);
	const worker = await h.ready("plugin", { storage: ["own-collection"] });
	const entry = h.manager.workers.get("plugin");
	await h.manager.terminateWorker("plugin");
	await h.tick(2000);
	assert.equal(h.workers.length, 1);
	assert.equal(worker.terminateCalls, 1);
	assert.equal(entry.crashCount, 0);
	assert.equal(h.manager.hasWorker("plugin"), false);
	assert.equal(h.broker.hasCapability("plugin", "storage:own-collection"), false);
	assert.equal(h.broker.resourceTrackers.size, 0);
	assert.equal(h.manager._resourceEventHandlers.size, 0);
});

test("lifecycle: a clean exit after readiness cleans up without restarting", async (t) => {
	const h = makeHarness(t);
	const worker = await h.ready("plugin", { storage: ["own-collection"] });
	worker.exit(0);
	await nextTurn();
	assert.equal(h.manager.hasWorker("plugin"), false);
	assert.equal(h.broker.pluginCapabilities.size, 0);
	assert.equal(h.broker.resourceTrackers.size, 0);
	assert.equal(h.manager._resourceEventHandlers.size, 0);
	await h.tick(60000);
	assert.equal(h.workers.length, 1);
});

for (const signal of ["error", "worker:error", "exit:0", "exit:1"]) {
	test(`lifecycle: startup ${signal} rejects immediately and releases capabilities`, async (t) => {
		const h = makeHarness(t);
		const outcome = observe(h.manager.spawnWorker("plugin", "/test/plugin.js", { hooks: ["subscribe"] }));
		const worker = h.workers[0];
		if (signal === "error") worker.emit("error", new Error("startup exploded"));
		else if (signal === "worker:error") worker.emit("message", { type: signal, error: "startup exploded" });
		else worker.exit(Number(signal.slice(-1)));
		await nextTurn();
		assert.ok(outcome.error instanceof Error, "startup must reject without advancing the startup timeout");
		assert.match(outcome.error.message, signal.startsWith("exit:") ? /exit/i : /startup exploded/);
		assert.equal(h.broker.hasCapability("plugin", "hooks:subscribe"), false);
		assert.equal(h.broker.resourceTrackers.size, 0);
		assert.equal(h.manager._resourceEventHandlers.size, 0);
		assert.ok(worker.exited, "failed startup must not leave a running worker");
		await h.manager.terminateWorker("plugin");
		await h.tick(60000);
		assert.equal(h.workers.length, 1);
	});
}

test("lifecycle: startup timeout terminates the worker and can be unloaded without resurrection", async (t) => {
	const h = makeHarness(t);
	const outcome = observe(h.manager.spawnWorker("plugin", "/test/plugin.js", {}));
	const entry = h.manager.workers.get("plugin");
	await h.tick(15000);
	assert.match(outcome.error?.message || "", /startup timeout/);
	assert.equal(h.workers[0].terminateCalls, 1);
	assert.equal(h.broker.pluginCapabilities.size, 0);
	assert.equal(entry._startupResolve, null);
	assert.equal(entry._startupReject, null);
	await h.manager.terminateWorker("plugin");
	await h.tick(60000);
	assert.equal(h.workers.length, 1);
});

test("lifecycle: Worker construction failure rolls back broker registration", async (t) => {
	const h = makeHarness(t, () => { throw new Error("cannot construct worker"); });
	await assert.rejects(h.manager.spawnWorker("plugin", "/test/plugin.js", {}), /cannot construct worker/);
	assert.equal(h.manager.hasWorker("plugin"), false);
	assert.equal(h.broker.pluginCapabilities.size, 0);
	assert.equal(h.broker.resourceTrackers.size, 0);
	assert.equal(metricsCollector.pluginMetrics.has("plugin"), false);
});

test("lifecycle: error plus exit counts once and stops after MAX_CRASH_COUNT attempts", async (t) => {
	const h = makeHarness(t);
	let worker = await h.ready();
	for (let attempt = 1; attempt <= h.MAX_CRASH_COUNT; attempt++) {
		const entry = h.manager.workers.get("plugin");
		worker.emit("error", new Error("runtime exploded"));
		worker.exit(1);
		await nextTurn();
		assert.equal(entry.crashCount, attempt);
		assert.equal(h.broker.pluginCapabilities.size, 0);
		assert.equal(h.manager._resourceEventHandlers.size, 0);
		await h.tick(2000);
		if (attempt < h.MAX_CRASH_COUNT) {
			assert.equal(h.workers.length, attempt + 1);
			worker = h.workers.at(-1);
			worker.emit("message", { type: "worker:ready" });
			await nextTurn();
		}
	}
	await h.tick(60000);
	assert.equal(h.workers.length, h.MAX_CRASH_COUNT);
	assert.equal(h.manager.hasWorker("plugin"), false);
	assert.equal(h.broker.resourceTrackers.size, 0);
});

test("lifecycle: unload cancels a queued crash restart", async (t) => {
	const h = makeHarness(t);
	const worker = await h.ready();
	worker.exit(1);
	await h.manager.terminateWorker("plugin");
	await h.tick(60000);
	assert.equal(h.workers.length, 1);
	assert.equal(h.manager.hasWorker("plugin"), false);
	assert.equal(h.broker.pluginCapabilities.size, 0);
});

test("lifecycle: unload cancels a retry already waiting for the crashed worker to terminate", async (t) => {
	const h = makeHarness(t);
	const worker = await h.ready();
	worker.delayTermination = true;
	worker.emit("error", new Error("runtime exploded"));
	await h.tick(2000);
	const unloading = h.manager.terminateWorker("plugin");
	worker.finishTermination();
	await unloading;
	await nextTurn();
	await h.tick(60000);
	assert.equal(h.workers.length, 1);
	assert.equal(h.manager.hasWorker("plugin"), false);
});

test("lifecycle: manual and crash restarts retain the granted env, network hosts, and capabilities", async (t) => {
	const h = makeHarness(t);
	const grantedEnv = { LIFECYCLE_TEST_VALUE: "allowed-value" };
	const networkAllowlist = ["api.example.test"];
	const capabilities = { storage: ["own-collection"], network: ["outbound-http"] };
	await h.ready("plugin", capabilities, { grantedEnv, networkAllowlist, crashCount: 1 });
	grantedEnv.LIFECYCLE_TEST_VALUE = "changed-after-spawn";
	networkAllowlist.push("not-granted.example.test");
	const restarting = h.manager.restartWorker("plugin");
	await nextTurn();
	let worker = h.workers.at(-1);
	worker.emit("message", { type: "worker:ready" });
	await restarting;
	assert.equal(h.manager.workers.get("plugin").crashCount, 0);
	for (let restart = 0; restart < 2; restart++) {
		assert.deepEqual(worker.options.workerData.grantedEnv, { LIFECYCLE_TEST_VALUE: "allowed-value" });
		assert.deepEqual(h.manager.workers.get("plugin").grantedEnv, { LIFECYCLE_TEST_VALUE: "allowed-value" });
		assert.deepEqual(h.broker.networkAllowlists.get("plugin"), ["api.example.test"]);
		assert.equal(h.broker.hasCapability("plugin", "storage:own-collection"), true);
		assert.equal(h.broker.hasCapability("plugin", "storage:read-profiles"), false);
		assert.equal(h.broker._checkNetworkAllowed("plugin", "https://not-granted.example.test").ok, false);
		if (restart === 0) {
			worker.exit(1);
			await h.tick(2000);
			worker = h.workers.at(-1);
			worker.emit("message", { type: "worker:ready" });
			await nextTurn();
		}
	}
	assert.equal(h.manager.workers.get("plugin").crashCount, 1);
});

test("lifecycle: stale ready, error, exit, resource and RPC callbacks cannot affect a replacement", async (t) => {
	const h = makeHarness(t);
	const old = await h.ready("plugin", { storage: ["own-collection"] });
	const onMessage = old.listeners("message")[0];
	const onError = old.listeners("error")[0];
	const onExit = old.listeners("exit")[0];
	const outcome = observe(h.manager.restartWorker("plugin"));
	await nextTurn();
	const replacement = h.manager.workers.get("plugin");
	onMessage({ type: "worker:ready" });
	onMessage({ type: "worker:error", error: "old startup error" });
	onMessage({ type: "resource.memoryExceeded", memoryMB: 1000, limitMB: 512 });
	onMessage({ type: "rpc:request", id: "stale", method: "db.getPluginConfig", params: { guildId: "g" } });
	onError(new Error("old worker error"));
	onExit(1);
	onExit(0);
	await nextTurn();
	assert.equal(h.manager.workers.get("plugin"), replacement);
	assert.equal(replacement.ready, false);
	assert.equal(replacement.crashCount, 0);
	assert.deepEqual(outcome, {});
	assert.equal(h.broker.stats.requests, 0);
	assert.equal(h.broker.hasCapability("plugin", "storage:own-collection"), true);
	replacement.worker.emit("message", { type: "worker:ready" });
	await nextTurn();
	assert.equal(outcome.ready, true);
});

test("lifecycle: an in-flight RPC result is dropped after replacement, and caller namespace stays enforced", async (t) => {
	const h = makeHarness(t);
	let finishRequest;
	h.db.getPluginConfig = () => new Promise((resolve) => { finishRequest = resolve; });
	const old = await h.ready("plugin", { storage: ["own-collection"] });
	old.emit("message", { type: "rpc:request", id: "pending", method: "db.getPluginConfig", params: { guildId: "g" } });
	await nextTurn();
	const restarting = h.manager.restartWorker("plugin");
	await nextTurn();
	const worker = h.workers.at(-1);
	worker.emit("message", { type: "worker:ready" });
	await restarting;
	finishRequest({ old: true });
	await nextTurn();
	assert.deepEqual(old.sent, []);
	assert.deepEqual(worker.sent, []);
	h.db.getPluginConfig = async (guildId, pluginId) => ({ guildId, pluginId });
	worker.emit("message", {
		type: "rpc:request", id: "current", method: "db.getPluginConfig", pluginId: "other-plugin",
		params: { guildId: "g", pluginId: "other-plugin" },
	});
	await nextTurn();
	assert.equal(worker.sent[0].type, "rpc:response");
	assert.equal(worker.sent[0].ok, true);
	assert.deepEqual(worker.sent[0].result, { guildId: "g", pluginId: "plugin" });
});

test("lifecycle: concurrent replacements keep only the latest spawn and share termination", async (t) => {
	const h = makeHarness(t);
	const old = await h.ready();
	old.delayTermination = true;
	const first = observe(h.manager.spawnWorker("plugin", "/test/first.js", {}));
	const last = observe(h.manager.spawnWorker("plugin", "/test/last.js", { hooks: ["subscribe"] }));
	old.finishTermination();
	await nextTurn();
	assert.equal(old.terminateCalls, 1);
	assert.equal(h.workers.length, 2);
	assert.ok(first.error instanceof Error);
	assert.equal(h.workers[1].options.workerData.entryPath, "/test/last.js");
	h.workers[1].emit("message", { type: "worker:ready" });
	await nextTurn();
	assert.equal(last.ready, true);
	assert.equal(h.broker.hasCapability("plugin", "hooks:subscribe"), true);
});

test("lifecycle: overlapping shutdowns wait for termination and cancel a pending replacement", async (t) => {
	const h = makeHarness(t);
	const old = await h.ready();
	old.delayTermination = true;
	const replacement = observe(h.manager.restartWorker("plugin"));
	const first = h.manager.shutdown();
	const second = h.manager.shutdown();
	const shutdown = observe(second);
	await nextTurn();
	assert.deepEqual(shutdown, {}, "shutdown must wait for the physical worker to exit");
	assert.doesNotThrow(() => old.emit("error", new Error("error while terminating")));
	old.finishTermination();
	await Promise.all([first, second]);
	await nextTurn();
	assert.ok(replacement.error instanceof Error);
	assert.equal(old.terminateCalls, 1);
	assert.equal(h.manager.workers.size, 0);
	await h.tick(60000);
	assert.equal(h.workers.length, 1);
});

test("lifecycle: shutdown cancels active, starting and backoff workers, removes listeners, and rejects new spawns", async (t) => {
	const h = makeHarness(t);
	await h.ready("running");
	const crashed = await h.ready("crashed");
	crashed.exit(1);
	const startup = observe(h.manager.spawnWorker("starting", "/test/starting.js", {}));
	await h.manager.shutdown();
	await nextTurn();
	assert.ok(startup.error instanceof Error);
	assert.equal(h.manager.activeCount, 0);
	assert.equal(h.manager.workers.size, 0);
	assert.equal(h.broker.pluginCapabilities.size, 0);
	assert.equal(h.broker.resourceTrackers.size, 0);
	assert.equal(h.manager._resourceEventHandlers.size, 0);
	assert.equal(h.hooks.anyHandlers.length, 0);
	assert.equal(h.broker.listenerCount("hook:forward"), 0);
	assert.equal(h.broker.listenerCount("cron:tick"), 0);
	assert.equal(metricsCollector.listenerCount("call:recorded"), h.metricsListeners);
	for (const worker of h.workers) {
		assert.deepEqual(["message", "error", "exit"].map((event) => worker.listenerCount(event)), [0, 0, 0]);
	}
	await assert.rejects(h.manager.spawnWorker("late", "/test/late.js", {}), /shut.?down|shutting|closed/i);
	await h.tick(60000);
	assert.equal(h.workers.length, 3);
});

test("lifecycle: hooks deliver once only to broker subscribers, never through a global broadcast", async (t) => {
	const h = makeHarness(t);
	const subscribed = await h.ready("subscribed", { hooks: ["subscribe"] });
	const denied = await h.ready("denied");
	for (const worker of [subscribed, denied]) {
		worker.emit("message", { type: "rpc:request", id: "subscribe", method: "hooks.on", params: { eventName: "sample" } });
	}
	await nextTurn();
	assert.equal(subscribed.sent[0].ok, true);
	assert.equal(denied.sent[0].ok, false);
	await h.hooks.emitHook("sample", { value: 1 });
	assert.equal(subscribed.sent.filter((msg) => msg.event === "hook:sample").length, 1);
	assert.equal(denied.sent.filter((msg) => msg.type === "rpc:event").length, 0);
	assert.equal(h.hooks.anyHandlers.length, 0);
	await h.hooks.emitHook("onInteraction", { interaction: { reply() {} } });
	assert.equal(subscribed.sent.length, 2);
	assert.doesNotThrow(() => h.broker.emit("hook:forward", {
		pluginId: "subscribed", eventName: "sample", payload: { reply() {} },
	}));
	assert.equal(h.manager.activeCount, 2);
});

test("lifecycle: a real Worker startup throw rejects on error/exit, not the startup timeout", async (t) => {
	const h = makeHarness(t, (_script, options) => new RealWorker("throw new Error('real startup failure');", {
		...options, eval: true, env: {},
	}));
	const outcome = observe(h.manager.spawnWorker("plugin", "/test/plugin.js", {}));
	await new Promise((resolve) => h.workers[0].once("exit", resolve));
	await nextTurn();
	assert.match(outcome.error?.message || "", /real startup failure/);
	assert.equal(h.broker.pluginCapabilities.size, 0);
	await h.manager.terminateWorker("plugin");
	await h.tick(60000);
	assert.equal(h.workers.length, 1);
});

test("lifecycle: terminating a real ready Worker with exit code 1 never respawns it", async (t) => {
	const h = makeHarness(t, (_script, options) => new RealWorker(`
		const { parentPort } = require("node:worker_threads");
		parentPort.on("message", () => {});
		parentPort.postMessage({ type: "worker:ready" });
	`, { ...options, eval: true, env: {} }));
	await h.manager.spawnWorker("plugin", "/test/plugin.js", {});
	let exitCode;
	h.workers[0].once("exit", (code) => { exitCode = code; });
	await h.manager.terminateWorker("plugin");
	assert.equal(exitCode, 1);
	await h.tick(60000);
	assert.equal(h.workers.length, 1);
	assert.equal(h.manager.hasWorker("plugin"), false);
});
