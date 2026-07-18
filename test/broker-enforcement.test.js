const { test } = require("node:test");
const assert = require("node:assert");

const { CapabilityBroker } = require("../core/rpc/broker");
const { ViolationTracker, KIND } = require("../core/rpc/violations");

function makeBroker({ threshold = 3, windowMs = 10_000, client = null } = {}) {
	const violations = new ViolationTracker({ threshold, windowMs });
	const broker = new CapabilityBroker({
		db: {},
		client,
		hooks: { emitHook: async () => ({ ok: true }) },
		violations,
	});
	return broker;
}

test("enforcement: unknown method is denied and recorded as a violation", async () => {
	const broker = makeBroker();
	broker.registerCapabilities("p", {}, "P");

	const res = await broker.handleRequest("p", { id: "1", method: "does.not.exist", params: {} });
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /Unknown RPC method/);

	const v = broker.getViolations("p");
	assert.strictEqual(v.length, 1);
	assert.strictEqual(v[0].kind, KIND.UNKNOWN_METHOD);
});

test("enforcement: calling a method without its capability is denied and recorded", async () => {
	const broker = makeBroker();
	broker.registerCapabilities("p", { storage: ["own-collection"] }, "P");

	const res = await broker.handleRequest("p", {
		id: "1",
		method: "discord.ban",
		params: { guildId: "g", userId: "u" },
	});
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /Missing capability/);

	const v = broker.getViolations("p");
	assert.strictEqual(v.length, 1);
	assert.strictEqual(v[0].kind, KIND.CAPABILITY);
});

test("enforcement: network.fetch to a non-allowlisted host is denied and recorded", async () => {
	const broker = makeBroker();
	broker.registerCapabilities("p", { network: ["outbound-http"] }, "P", {
		networkAllowlist: ["api.allowed.com"],
	});

	const res = await broker.handleRequest("p", {
		id: "1",
		method: "network.fetch",
		params: { url: "https://evil.example.com/steal" },
	});
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /Network request denied/);

	const v = broker.getViolations("p");
	assert.strictEqual(v.length, 1);
	assert.strictEqual(v[0].kind, KIND.NETWORK);
});

test("enforcement: network.fetch to an allowlisted host is permitted", async () => {
	const broker = makeBroker();
	broker.registerCapabilities("p", { network: ["outbound-http"] }, "P", {
		networkAllowlist: ["api.allowed.com"],
	});

	// Stub global fetch so the test makes no real network call.
	const origFetch = global.fetch;
	global.fetch = async (url) => {
		assert.strictEqual(url, "https://api.allowed.com/data");
		return {
			status: 200,
			ok: true,
			headers: new Map([["content-type", "application/json"]]),
			arrayBuffer: async () => Buffer.from('{"ok":true}'),
		};
	};
	try {
		const res = await broker.handleRequest("p", {
			id: "1",
			method: "network.fetch",
			params: { url: "https://api.allowed.com/data" },
		});
		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.result.status, 200);
		assert.strictEqual(res.result.body, '{"ok":true}');
		assert.strictEqual(broker.getViolations("p").length, 0);
	} finally {
		global.fetch = origFetch;
	}
});

test("enforcement: subdomains of an allowlisted host are permitted", () => {
	const broker = makeBroker();
	broker.registerCapabilities("p", { network: ["outbound-http"] }, "P", {
		networkAllowlist: ["allowed.com"],
	});
	assert.strictEqual(broker._checkNetworkAllowed("p", "https://api.allowed.com/x").ok, true);
	assert.strictEqual(broker._checkNetworkAllowed("p", "https://allowed.com").ok, true);
	assert.strictEqual(broker._checkNetworkAllowed("p", "https://notallowed.com").ok, false);
});

test("enforcement: non-http protocols are refused", () => {
	const broker = makeBroker();
	broker.registerCapabilities("p", { network: ["outbound-http"] }, "P", {
		networkAllowlist: ["allowed.com"],
	});
	const r = broker._checkNetworkAllowed("p", "file:///etc/passwd");
	assert.strictEqual(r.ok, false);
	assert.match(r.reason, /protocol/i);
});

test("enforcement: repeated violations auto-suspend and then all calls are refused", async () => {
	const broker = makeBroker({ threshold: 3 });
	broker.registerCapabilities("p", { network: ["outbound-http"] }, "P", {
		networkAllowlist: ["api.allowed.com"],
	});

	let suspendEvents = 0;
	broker.on("plugin:suspended", () => suspendEvents++);

	for (let i = 0; i < 3; i++) {
		await broker.handleRequest("p", {
			id: `n${i}`,
			method: "network.fetch",
			params: { url: "https://evil.example.com" },
		});
	}

	assert.strictEqual(broker.isSuspended("p"), true);
	assert.strictEqual(suspendEvents, 1);

	// Even a would-be-legitimate call is refused while suspended.
	const res = await broker.handleRequest("p", {
		id: "z",
		method: "network.fetch",
		params: { url: "https://api.allowed.com/data" },
	});
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /suspended/i);
});

test("enforcement: reinstate lifts suspension and emits an event", async () => {
	const broker = makeBroker({ threshold: 2 });
	broker.registerCapabilities("p", {}, "P");

	await broker.handleRequest("p", { id: "1", method: "bad.method", params: {} });
	await broker.handleRequest("p", { id: "2", method: "bad.method", params: {} });
	assert.strictEqual(broker.isSuspended("p"), true);

	let reinstated = 0;
	broker.on("plugin:reinstated", () => reinstated++);
	assert.strictEqual(broker.reinstate("p"), true);
	assert.strictEqual(broker.isSuspended("p"), false);
	assert.strictEqual(reinstated, 1);
});

test("enforcement: a plugin with an empty allowlist can reach nothing", () => {
	const broker = makeBroker();
	broker.registerCapabilities("p", { network: ["outbound-http"] }, "P", { networkAllowlist: [] });
	assert.strictEqual(broker._checkNetworkAllowed("p", "https://anything.com").ok, false);
});
