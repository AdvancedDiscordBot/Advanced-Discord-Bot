const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("events");

// ── Protocol Tests ────────────────────────────────────────────────────────

const {
	MSG,
	createRequest,
	createResponse,
	createErrorResponse,
	createEvent,
	isRequest,
	isResponse,
	isEvent,
} = require("../core/rpc/protocol");

test("protocol: createRequest generates valid request", () => {
	const req = createRequest("db.getPluginConfig", { guildId: "123" });
	assert.strictEqual(req.type, MSG.REQUEST);
	assert.strictEqual(req.method, "db.getPluginConfig");
	assert.deepStrictEqual(req.params, { guildId: "123" });
	assert.ok(typeof req.id === "string");
	assert.ok(req.id.startsWith("rpc-"));
});

test("protocol: createRequest defaults params to empty object", () => {
	const req = createRequest("db.getTopUsers");
	assert.deepStrictEqual(req.params, {});
});

test("protocol: createResponse generates valid response", () => {
	const res = createResponse("rpc-1", { name: "test" });
	assert.strictEqual(res.type, MSG.RESPONSE);
	assert.strictEqual(res.id, "rpc-1");
	assert.strictEqual(res.ok, true);
	assert.deepStrictEqual(res.result, { name: "test" });
});

test("protocol: createErrorResponse generates valid error response", () => {
	const res = createErrorResponse("rpc-1", "not found");
	assert.strictEqual(res.type, MSG.RESPONSE);
	assert.strictEqual(res.id, "rpc-1");
	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.error, "not found");
});

test("protocol: createErrorResponse handles Error objects", () => {
	const res = createErrorResponse("rpc-1", new Error("something broke"));
	assert.strictEqual(res.error, "something broke");
});

test("protocol: createEvent generates valid event", () => {
	const evt = createEvent("guildMemberAdd", { id: "456" });
	assert.strictEqual(evt.type, MSG.EVENT);
	assert.strictEqual(evt.event, "guildMemberAdd");
	assert.deepStrictEqual(evt.payload, { id: "456" });
});

test("protocol: isRequest validates correctly", () => {
	assert.strictEqual(isRequest(createRequest("test")), true);
	assert.strictEqual(isRequest({ type: "rpc:request", id: "1", method: "x" }), true);
	assert.strictEqual(isRequest({ type: "wrong" }), false);
	assert.strictEqual(isRequest(null), false);
	assert.strictEqual(isRequest({}), false);
});

test("protocol: isResponse validates correctly", () => {
	assert.strictEqual(isResponse(createResponse("1", "ok")), true);
	assert.strictEqual(isResponse(createErrorResponse("1", "err")), true);
	assert.strictEqual(isResponse({ type: "wrong" }), false);
	assert.strictEqual(isResponse(null), false);
});

test("protocol: isEvent validates correctly", () => {
	assert.strictEqual(isEvent(createEvent("test", {})), true);
	assert.strictEqual(isEvent({ type: "rpc:event", event: "x", payload: {} }), true);
	assert.strictEqual(isEvent({ type: "wrong" }), false);
	assert.strictEqual(isEvent(null), false);
});

// ── Method Catalog Tests ──────────────────────────────────────────────────

const { RPC_METHODS, getMethodDef, isValidMethod, listMethods } = require("../core/rpc/methods");

test("methods: getMethodDef returns definition for valid method", () => {
	const def = getMethodDef("db.getPluginConfig");
	assert.ok(def);
	assert.strictEqual(def.capability, "storage:own-collection");
	assert.strictEqual(def.handler, "getPluginConfig");
	assert.ok(typeof def.description === "string");
});

test("methods: getMethodDef returns null for unknown method", () => {
	assert.strictEqual(getMethodDef("db.nonexistent"), null);
	assert.strictEqual(getMethodDef(""), null);
});

test("methods: isValidMethod works", () => {
	assert.strictEqual(isValidMethod("db.getPluginConfig"), true);
	assert.strictEqual(isValidMethod("discord.sendMessage"), true);
	assert.strictEqual(isValidMethod("hooks.emit"), true);
	assert.strictEqual(isValidMethod("db.nonexistent"), false);
});

test("methods: listMethods returns all methods", () => {
	const methods = listMethods();
	assert.ok(methods.length > 10);
	assert.ok(methods.some((m) => m.method === "db.getPluginConfig"));
	assert.ok(methods.some((m) => m.method === "discord.sendMessage"));
	assert.ok(methods.some((m) => m.method === "hooks.emit"));
});

test("methods: every method has required fields", () => {
	const methods = listMethods();
	for (const m of methods) {
		assert.ok(typeof m.method === "string", `method field missing for ${m.method}`);
		assert.ok(typeof m.capability === "string", `capability missing for ${m.method}`);
		assert.ok(typeof m.description === "string", `description missing for ${m.method}`);
		assert.ok(m.capability.includes(":"), `capability must be category:value for ${m.method}`);
	}
});

// ── CapabilityBroker Tests ────────────────────────────────────────────────

const { CapabilityBroker } = require("../core/rpc/broker");

function makeMockDb() {
	return {
		getPluginConfig: async (guildId, pluginId) => ({ guildId, pluginId, data: { enabled: true } }),
		updatePluginConfig: async (guildId, pluginId, data) => ({ guildId, pluginId, data }),
		getUserProfile: async (userId, guildId) => ({ userId, guildId, totalXp: 100 }),
		updateUserProfile: async (userId, guildId, data) => ({ userId, guildId, ...data }),
		addXP: async (userId, guildId, amount) => ({ profile: { totalXp: 100 + amount }, levelUp: false }),
		getTopUsers: async (guildId, limit) => [],
	};
}

function makeMockHooks() {
	return { emitHook: async () => ({ ok: true }) };
}

test("broker: registers and checks capabilities", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { discord: ["SendMessages"], storage: ["own-collection"] });

	assert.strictEqual(broker.hasCapability("plugin-a", "discord:SendMessages"), true);
	assert.strictEqual(broker.hasCapability("plugin-a", "discord:BanMembers"), false);
	assert.strictEqual(broker.hasCapability("plugin-a", "storage:own-collection"), true);
	assert.strictEqual(broker.hasCapability("plugin-a", "storage:read-profiles"), false);
});

test("broker: unregistered plugin has no capabilities", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	assert.strictEqual(broker.hasCapability("unknown", "storage:own-collection"), false);
});

test("broker: wildcard capability grants all in category", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { discord: ["*"] });

	assert.strictEqual(broker.hasCapability("plugin-a", "discord:SendMessages"), true);
	assert.strictEqual(broker.hasCapability("plugin-a", "discord:BanMembers"), true);
});

test("broker: handleRequest allows valid call", async () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { storage: ["own-collection"] });

	const result = await broker.handleRequest("plugin-a", {
		id: "req-1",
		method: "db.getPluginConfig",
		params: { guildId: "123" },
	});

	assert.strictEqual(result.ok, true);
	assert.strictEqual(result.id, "req-1");
	assert.deepStrictEqual(result.result, { guildId: "123", pluginId: "plugin-a", data: { enabled: true } });
});

test("broker: handleRequest denies missing capability", async () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	// No capabilities registered

	const result = await broker.handleRequest("plugin-a", {
		id: "req-2",
		method: "db.getPluginConfig",
		params: { guildId: "123" },
	});

	assert.strictEqual(result.ok, false);
	assert.strictEqual(result.id, "req-2");
	assert.ok(result.error.includes("Missing capability"));
	assert.ok(result.error.includes("storage:own-collection"));
});

test("broker: handleRequest rejects unknown method", async () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { storage: ["own-collection"] });

	const result = await broker.handleRequest("plugin-a", {
		id: "req-3",
		method: "db.nonexistent",
		params: {},
	});

	assert.strictEqual(result.ok, false);
	assert.ok(result.error.includes("Unknown RPC method"));
});

test("broker: handleRequest handles db errors gracefully", async () => {
	const failingDb = {
		getPluginConfig: async () => { throw new Error("DB connection lost"); },
	};
	const broker = new CapabilityBroker({ db: failingDb, client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { storage: ["own-collection"] });

	const result = await broker.handleRequest("plugin-a", {
		id: "req-4",
		method: "db.getPluginConfig",
		params: { guildId: "123" },
	});

	assert.strictEqual(result.ok, false);
	assert.strictEqual(result.error, "DB connection lost");
});

test("broker: handleRequest converts Mongoose documents to plain objects", async () => {
	const mockDoc = {
		guildId: "123",
		data: { enabled: true },
		toObject: function () { return { guildId: this.guildId, data: this.data }; },
	};
	const db = { getPluginConfig: async () => mockDoc };
	const broker = new CapabilityBroker({ db, client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { storage: ["own-collection"] });

	const result = await broker.handleRequest("plugin-a", {
		id: "req-5",
		method: "db.getPluginConfig",
		params: { guildId: "123" },
	});

	assert.strictEqual(result.ok, true);
	assert.deepStrictEqual(result.result, { guildId: "123", data: { enabled: true } });
	// Verify it's a plain object, not the Mongoose doc
	assert.strictEqual(typeof result.result.toObject, "undefined");
});

test("broker: unregisterCapabilities removes plugin", () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { storage: ["own-collection"] });
	assert.strictEqual(broker.hasCapability("plugin-a", "storage:own-collection"), true);

	broker.unregisterCapabilities("plugin-a");
	assert.strictEqual(broker.hasCapability("plugin-a", "storage:own-collection"), false);
});

test("broker: getStats tracks requests and denials", async () => {
	const broker = new CapabilityBroker({ db: makeMockDb(), client: null, hooks: makeMockHooks() });
	broker.registerCapabilities("plugin-a", { storage: ["own-collection"] });

	await broker.handleRequest("plugin-a", { id: "1", method: "db.getPluginConfig", params: { guildId: "123" } });
	await broker.handleRequest("plugin-b", { id: "2", method: "db.getPluginConfig", params: { guildId: "123" } }); // denied

	const stats = broker.getStats();
	assert.strictEqual(stats.requests, 2);
	assert.strictEqual(stats.denied, 1);
});

// ── RpcClient Tests ───────────────────────────────────────────────────────

const { RpcClient } = require("../core/rpc/worker-client");

function createMockPort() {
	const emitter = new EventEmitter();
	return {
		on: emitter.on.bind(emitter),
		postMessage: (msg) => emitter.emit("message", msg),
		// Expose for testing: simulate Core sending a response
		_simulateResponse: (response) => emitter.emit("message", response),
		_simulateEvent: (event) => emitter.emit("message", event),
		_emitter: emitter,
	};
}

test("rpcClient: call sends request and resolves on response", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	// Simulate Core responding after a short delay
	setTimeout(() => {
		const lastMsg = port._emitter.listenerCount("message") ? null : null;
		// Find the pending request by listening to outgoing messages
	}, 0);

	// Intercept outgoing messages to simulate response
	const originalPostMessage = port.postMessage;
	let outgoingId = null;
	port.postMessage = (msg) => {
		outgoingId = msg.id;
		originalPostMessage(msg);
		// Simulate immediate response
		setTimeout(() => {
			port._simulateResponse({ type: MSG.RESPONSE, id: outgoingId, ok: true, result: { name: "test" } });
		}, 5);
	};

	const result = await client.call("db.getPluginConfig", { guildId: "123" });
	assert.deepStrictEqual(result, { name: "test" });
	client.close();
});

test("rpcClient: call rejects on error response", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	const originalPostMessage = port.postMessage;
	let outgoingId = null;
	port.postMessage = (msg) => {
		outgoingId = msg.id;
		originalPostMessage(msg);
		setTimeout(() => {
			port._simulateResponse({ type: MSG.RESPONSE, id: outgoingId, ok: false, error: "not found" });
		}, 5);
	};

	await assert.rejects(
		() => client.call("db.getPluginConfig", { guildId: "123" }),
		{ message: "not found" },
	);
	client.close();
});

test("rpcClient: call rejects on timeout", async () => {
	const port = createMockPort();
	const client = new RpcClient(port, { defaultTimeoutMs: 50 });

	// Never respond
	await assert.rejects(
		() => client.call("db.getPluginConfig", { guildId: "123" }),
		{ message: /timeout/ },
	);
	client.close();
});

test("rpcClient: call rejects when closed", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);
	client.close();

	await assert.rejects(
		() => client.call("db.getPluginConfig", { guildId: "123" }),
		{ message: "RpcClient is closed" },
	);
});

test("rpcClient: on() receives events from Core", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	let received = null;
	client.on("guildMemberAdd", (payload) => { received = payload; });

	port._simulateEvent({ type: MSG.EVENT, event: "guildMemberAdd", payload: { id: "456" } });

	// Give event loop a tick
	await new Promise((r) => setTimeout(r, 10));
	assert.deepStrictEqual(received, { id: "456" });
	client.close();
});

test("rpcClient: on() returns unsubscribe function", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	let count = 0;
	const unsub = client.on("test-event", () => { count++; });

	port._simulateEvent({ type: MSG.EVENT, event: "test-event", payload: {} });
	await new Promise((r) => setTimeout(r, 10));
	assert.strictEqual(count, 1);

	unsub();
	port._simulateEvent({ type: MSG.EVENT, event: "test-event", payload: {} });
	await new Promise((r) => setTimeout(r, 10));
	assert.strictEqual(count, 1); // Should not increment
	client.close();
});

test("rpcClient: ready() sends ready message", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	let sent = null;
	const originalPostMessage = port.postMessage;
	port.postMessage = (msg) => { sent = msg; originalPostMessage(msg); };

	client.ready();
	assert.deepStrictEqual(sent, { type: MSG.WorkerReady });
	client.close();
});

test("rpcClient: error() sends error message", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	let sent = null;
	const originalPostMessage = port.postMessage;
	port.postMessage = (msg) => { sent = msg; originalPostMessage(msg); };

	client.error("something broke");
	assert.deepStrictEqual(sent, { type: MSG.WorkerError, error: "something broke" });
	client.close();
});

test("rpcClient: close() rejects pending requests", async () => {
	const port = createMockPort();
	const client = new RpcClient(port);

	// Start a call but don't respond
	const promise = client.call("db.getPluginConfig", { guildId: "123" });

	// Close immediately
	client.close();

	await assert.rejects(promise, { message: "RpcClient closed" });
});
