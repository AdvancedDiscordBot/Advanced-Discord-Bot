const { test } = require("node:test");
const assert = require("node:assert");

const { ViolationTracker, KIND } = require("../core/rpc/violations");

// A controllable clock so window/threshold behavior is deterministic.
function fakeClock(start = 1_000_000) {
	let t = start;
	return { now: () => t, advance: (ms) => { t += ms; } };
}

test("violations: records and returns per-plugin history", () => {
	const vt = new ViolationTracker({ threshold: 10 });
	vt.record("p", { kind: KIND.CAPABILITY, method: "discord.ban", message: "no cap" });
	vt.record("p", { kind: KIND.NETWORK, method: "network.fetch", message: "bad host" });

	const hist = vt.getViolations("p");
	assert.strictEqual(hist.length, 2);
	assert.strictEqual(hist[0].kind, KIND.CAPABILITY);
	assert.strictEqual(hist[1].method, "network.fetch");
});

test("violations: history is bounded by historySize", () => {
	const vt = new ViolationTracker({ threshold: 1000, historySize: 3 });
	for (let i = 0; i < 10; i++) vt.record("p", { message: `v${i}` });
	const hist = vt.getViolations("p");
	assert.strictEqual(hist.length, 3);
	// Oldest dropped; newest retained.
	assert.strictEqual(hist[2].message, "v9");
});

test("violations: suspends once threshold is crossed within the window", () => {
	const clock = fakeClock();
	const vt = new ViolationTracker({ threshold: 3, windowMs: 10_000, now: clock.now });

	let events = 0;
	vt.on("suspend", () => events++);

	assert.strictEqual(vt.record("p", { message: "1" }).suspended, false);
	assert.strictEqual(vt.record("p", { message: "2" }).suspended, false);
	assert.strictEqual(vt.record("p", { message: "3" }).suspended, true);

	assert.strictEqual(vt.isSuspended("p"), true);
	assert.strictEqual(events, 1);
	assert.match(vt.getSuspension("p").reason, /3 violations/);
});

test("violations: old attempts age out of the window and don't trip suspension", () => {
	const clock = fakeClock();
	const vt = new ViolationTracker({ threshold: 3, windowMs: 10_000, now: clock.now });

	vt.record("p", { message: "1" });
	vt.record("p", { message: "2" });
	clock.advance(11_000); // both fall outside the window
	vt.record("p", { message: "3" });

	assert.strictEqual(vt.isSuspended("p"), false);
});

test("violations: does not re-suspend an already-suspended plugin", () => {
	const clock = fakeClock();
	const vt = new ViolationTracker({ threshold: 2, windowMs: 10_000, now: clock.now });
	let events = 0;
	vt.on("suspend", () => events++);

	vt.record("p", { message: "1" });
	vt.record("p", { message: "2" }); // suspends
	vt.record("p", { message: "3" }); // already suspended
	assert.strictEqual(events, 1);
});

test("violations: reinstate lifts suspension and resets the window", () => {
	const clock = fakeClock();
	const vt = new ViolationTracker({ threshold: 2, windowMs: 10_000, now: clock.now });

	vt.record("p", { message: "1" });
	vt.record("p", { message: "2" });
	assert.strictEqual(vt.isSuspended("p"), true);

	let reinstated = 0;
	vt.on("reinstate", () => reinstated++);
	assert.strictEqual(vt.reinstate("p"), true);
	assert.strictEqual(vt.isSuspended("p"), false);
	assert.strictEqual(reinstated, 1);

	// Window was reset: a single new violation should not immediately re-suspend.
	assert.strictEqual(vt.record("p", { message: "3" }).suspended, false);
});

test("violations: reinstate returns false when nothing was suspended", () => {
	const vt = new ViolationTracker();
	assert.strictEqual(vt.reinstate("nope"), false);
});

test("violations: summary reports per-plugin totals and suspension state", () => {
	const clock = fakeClock();
	const vt = new ViolationTracker({ threshold: 2, windowMs: 10_000, now: clock.now });
	vt.record("a", { message: "x" });
	vt.record("b", { message: "y" });
	vt.record("b", { message: "z" }); // suspends b

	const summary = vt.summary().sort((x, y) => x.pluginId.localeCompare(y.pluginId));
	assert.strictEqual(summary.length, 2);
	assert.strictEqual(summary[0].pluginId, "a");
	assert.strictEqual(summary[0].suspended, false);
	assert.strictEqual(summary[1].pluginId, "b");
	assert.strictEqual(summary[1].suspended, true);
	assert.strictEqual(summary[1].total, 2);
});

test("violations: forget clears all state for a plugin", () => {
	const vt = new ViolationTracker({ threshold: 2, windowMs: 10_000 });
	vt.record("p", { message: "1" });
	vt.record("p", { message: "2" });
	vt.forget("p");
	assert.strictEqual(vt.isSuspended("p"), false);
	assert.strictEqual(vt.getViolations("p").length, 0);
});
