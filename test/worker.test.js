const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("events");

// ── Mock Setup ────────────────────────────────────────────────────────────

// Mock worker_threads.Worker to avoid spawning real workers
let mockWorkers = [];
const originalWorker = require("worker_threads").Worker;

class MockWorker {
	constructor(scriptPath, opts) {
		this.scriptPath = scriptPath;
		this.opts = opts;
		this.emitter = new EventEmitter();
		this.postMessage = this.emitter.emit.bind(this.emitter, "message");
		this.on = this.emitter.on.bind(this.emitter);
		this.once = this.emitter.once.bind(this.emitter);
		this.removeListener = this.emitter.removeListener.bind(this.emitter);
		this._terminated = false;
		mockWorkers.push(this);
	}
	async terminate() {
		this._terminated = true;
		return 0;
	}
	// Simulate the worker sending a ready message
	simulateReady() {
		this.postMessage({ type: "worker:ready" });
	}
	// Simulate the worker sending an error
	simulateError(msg) {
		this.postMessage({ type: "worker:error", error: msg });
	}
	// Simulate an RPC request from the worker
	simulateRpcRequest(request) {
		this.postMessage(request);
	}
}

// We can't easily mock worker_threads.Worker at module level,
// so we test the WorkerManager's logic directly by mocking its internals.

// ── WorkerManager Tests (logic-level) ─────────────────────────────────────

const { CapabilityBroker } = require("../core/rpc/broker");
const { WorkerManager } = require("../core/rpc/worker-manager");

function makeMockDb() {
	return {
		getPluginConfig: async (guildId, pluginId) => ({ guildId, pluginId, data: {} }),
	};
}

function makeMockHooks() {
	const emitter = new EventEmitter();
	return {
		emitHook: async () => ({ ok: true }),
		onAny: (handler) => {
			emitter.on("any", handler);
			return () => emitter.removeListener("any", handler);
		},
		_emitAny: (hookName, payload) => emitter.emit("any", hookName, payload),
	};
}

test("WorkerManager: getWorkerStatus returns empty when no workers", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	const hooks = makeMockHooks();
	const mgr = new WorkerManager({ broker, hooks });

	const status = mgr.getWorkerStatus();
	assert.deepStrictEqual(status, {});
});

test("WorkerManager: hasWorker returns false for unknown plugin", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	const hooks = makeMockHooks();
	const mgr = new WorkerManager({ broker, hooks });

	assert.strictEqual(mgr.hasWorker("unknown"), false);
});

test("WorkerManager: activeCount is 0 initially", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	const hooks = makeMockHooks();
	const mgr = new WorkerManager({ broker, hooks });

	assert.strictEqual(mgr.activeCount, 0);
});

test("WorkerManager: broadcastEvent does nothing with no workers", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	const hooks = makeMockHooks();
	const mgr = new WorkerManager({ broker, hooks });

	// Should not throw
	mgr.broadcastEvent("guildMemberAdd", { id: "123" });
});

test("WorkerManager: sendEvent does nothing for unknown plugin", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	const hooks = makeMockHooks();
	const mgr = new WorkerManager({ broker, hooks });

	// Should not throw
	mgr.sendEvent("unknown", "guildMemberAdd", { id: "123" });
});

test("WorkerManager: shutdown does nothing with no workers", async () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	const hooks = makeMockHooks();
	const mgr = new WorkerManager({ broker, hooks });

	// Should not throw
	await mgr.shutdown();
});

test("WorkerManager: terminateWorker does nothing for unknown plugin", async () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	const hooks = makeMockHooks();
	const mgr = new WorkerManager({ broker, hooks });

	// Should not throw
	await mgr.terminateWorker("unknown");
});

// ── Integration: Broker + Worker Communication ────────────────────────────

test("broker: full round-trip — worker sends request, broker responds", async () => {
	const db = makeMockDb();
	const hooks = makeMockHooks();
	const broker = new CapabilityBroker({ db, client: null, hooks });

	// Register a plugin with capabilities
	broker.registerCapabilities("test-plugin", { storage: ["own-collection"] }, "Test Plugin");

	// Simulate a worker sending an RPC request
	const request = {
		type: "rpc:request",
		id: "req-test-1",
		method: "db.getPluginConfig",
		params: { guildId: "guild-123" },
	};

	const response = await broker.handleRequest("test-plugin", request);

	assert.strictEqual(response.ok, true);
	assert.strictEqual(response.id, "req-test-1");
	assert.deepStrictEqual(response.result, { guildId: "guild-123", pluginId: "test-plugin", data: {} });
});

test("broker: capability denied — worker sends request without capability", async () => {
	const db = makeMockDb();
	const hooks = makeMockHooks();
	const broker = new CapabilityBroker({ db, client: null, hooks });

	// Register with limited capabilities (no storage)
	broker.registerCapabilities("test-plugin", { discord: ["SendMessages"] }, "Test Plugin");

	const request = {
		type: "rpc:request",
		id: "req-test-2",
		method: "db.getPluginConfig",
		params: { guildId: "guild-123" },
	};

	const response = await broker.handleRequest("test-plugin", request);

	assert.strictEqual(response.ok, false);
	assert.ok(response.error.includes("Missing capability"));
});

test("broker: multiple plugins have isolated capabilities", async () => {
	const db = makeMockDb();
	const hooks = makeMockHooks();
	const broker = new CapabilityBroker({ db, client: null, hooks });

	broker.registerCapabilities("plugin-a", { storage: ["own-collection"] }, "Plugin A");
	broker.registerCapabilities("plugin-b", { storage: ["read-profiles"] }, "Plugin B");

	// Plugin A can access own-collection
	assert.strictEqual(broker.hasCapability("plugin-a", "storage:own-collection"), true);
	assert.strictEqual(broker.hasCapability("plugin-a", "storage:read-profiles"), false);

	// Plugin B can access read-profiles but not own-collection
	assert.strictEqual(broker.hasCapability("plugin-b", "storage:read-profiles"), true);
	assert.strictEqual(broker.hasCapability("plugin-b", "storage:own-collection"), false);
});

// ── Crash-Loop Circuit Breaker ────────────────────────────────────────────

// A plugin that throws in load() exits non-zero every time. Each respawn used
// to create a fresh WorkerEntry with crashCount:0, so MAX_CRASH_COUNT never
// tripped and the worker crash-looped forever, flooding logs. This drives the
// REAL spawnWorker (with a mocked Worker ctor) to prove crashCount survives
// respawns and the breaker gives up after MAX_CRASH_COUNT attempts.
test("WorkerManager: crash-looping plugin gives up after MAX_CRASH_COUNT", async () => {
	const wt = require("worker_threads");
	const realWorkerCtor = wt.Worker;
	const realSetTimeout = global.setTimeout;
	const modPath = require.resolve("../core/rpc/worker-manager");

	let spawnCount = 0;
	// A Worker that always "crashes in load()": exits non-zero right after spawn
	// and never signals ready. Hard-capped so a regressed (never-tripping) breaker
	// fails the assertion cleanly instead of crash-looping the event loop forever.
	const SPAWN_CAP = 20;
	class CrashWorker extends EventEmitter {
		constructor() {
			super();
			spawnCount++;
			this.postMessage = () => {};
			this.terminate = async () => 0;
			if (spawnCount <= SPAWN_CAP) realSetTimeout(() => this.emit("exit", 1), 0);
		}
	}

	wt.Worker = CrashWorker;
	// Collapse the 2s restart backoff (and 15s startup timeout) to near-instant.
	global.setTimeout = (fn) => realSetTimeout(fn, 0);
	// Re-require WorkerManager so its module-level `Worker` binds to CrashWorker.
	delete require.cache[modPath];
	const { WorkerManager: WM, MAX_CRASH_COUNT } = require(modPath);

	try {
		const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
		const hooks = makeMockHooks();
		const mgr = new WM({ broker, hooks });

		// The initial startup promise never resolves (worker never readies) — it
		// rejects on the (now-instant) startup timeout; swallow that.
		mgr.spawnWorker("bad-plugin", "/x/index.js", {}, "Bad Plugin").catch(() => {});

		// Let the crash → respawn chain run to completion.
		await new Promise((r) => realSetTimeout(r, 150));

		// 1 initial spawn + 2 restarts (crashCounts 1,2), then the breaker trips
		// at crashCount 3 and stops respawning.
		assert.strictEqual(spawnCount, MAX_CRASH_COUNT);
		assert.strictEqual(mgr.hasWorker("bad-plugin"), false);
	} finally {
		wt.Worker = realWorkerCtor;
		global.setTimeout = realSetTimeout;
		delete require.cache[modPath];
	}
});

// ── RpcClient Protocol Tests ──────────────────────────────────────────────
const { RpcClient } = require("../core/rpc/worker-client");
const { MSG } = require("../core/rpc/protocol");

function createMockPort() {
	const emitter = new EventEmitter();
	return {
		on: emitter.on.bind(emitter),
		postMessage: (msg) => emitter.emit("_outgoing", msg),
		_outgoing: emitter,
		_incoming: emitter,
		simulateMessage: (msg) => emitter.emit("message", msg),
	};
}

test("RpcClient: convenience methods build correct params", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	const sent = [];
	port._outgoing.on("_outgoing", (msg) => sent.push(msg));

	// Intercept and respond
	port._outgoing.on("_outgoing", (msg) => {
		if (msg.type === MSG.REQUEST) {
			setTimeout(() => {
				port.simulateMessage({ type: MSG.RESPONSE, id: msg.id, ok: true, result: "ok" });
			}, 5);
		}
	});

	await client.getPluginConfig("guild-1");
	assert.strictEqual(sent.length, 1);
	assert.strictEqual(sent[0].method, "db.getPluginConfig");
	assert.deepStrictEqual(sent[0].params, { guildId: "guild-1" });

	await client.updateUserProfile("user-1", "guild-1", { username: "test" });
	assert.strictEqual(sent.length, 2);
	assert.strictEqual(sent[1].method, "db.updateUserProfile");
	assert.deepStrictEqual(sent[1].params, { userId: "user-1", guildId: "guild-1", data: { username: "test" } });

	await client.addXP("user-1", "guild-1", 10, "message", "test reason");
	assert.strictEqual(sent.length, 3);
	assert.strictEqual(sent[2].method, "db.addXP");
	assert.deepStrictEqual(sent[2].params, { userId: "user-1", guildId: "guild-1", amount: 10, type: "message", reason: "test reason" });

	client.close();
});
