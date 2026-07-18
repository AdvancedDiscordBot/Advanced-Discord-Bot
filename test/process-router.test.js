const { test } = require("node:test");
const assert = require("node:assert");
const {
	STRATEGY,
	getStrategy,
	requiresHeavyReview,
	buildExecArgv,
	getProcessLimits,
} = require("../core/rpc/process-router");

// ── getStrategy ─────────────────────────────────────────────────────────────

test("pooled model → warm-pool-lru", () => {
	assert.strictEqual(
		getStrategy({ manifestVersion: 2, process: { model: "pooled" }, permissions: {} }),
		STRATEGY.WARM_POOL,
	);
});

test("persistent model → dedicated-process", () => {
	assert.strictEqual(
		getStrategy({
			manifestVersion: 2,
			process: { model: "persistent", persistentReason: "voice" },
			permissions: {},
		}),
		STRATEGY.DEDICATED,
	);
});

test("oneshot model → cold-fork-per-call", () => {
	assert.strictEqual(
		getStrategy({ manifestVersion: 2, process: { model: "oneshot" }, permissions: {} }),
		STRATEGY.COLD_FORK,
	);
});

test("v1 manifest (no process block) defaults to warm-pool-lru", () => {
	assert.strictEqual(
		getStrategy({ capabilities: { discord: ["SendMessages"] } }),
		STRATEGY.WARM_POOL,
	);
});

test("childProcess short-circuits to heavy-review regardless of model", () => {
	const s = getStrategy({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { childProcess: true },
	});
	assert.strictEqual(s, STRATEGY.HEAVY_REVIEW);
	assert.ok(requiresHeavyReview(s));
});

test("nativeAddons short-circuits to heavy-review", () => {
	assert.strictEqual(
		getStrategy({ manifestVersion: 2, process: { model: "persistent", persistentReason: "x" }, permissions: { nativeAddons: true } }),
		STRATEGY.HEAVY_REVIEW,
	);
});

// ── buildExecArgv ─────────────────────────────────────────────────────────��

test("buildExecArgv always emits --permission and the heap cap from memoryMb", () => {
	const args = buildExecArgv({ manifestVersion: 2, process: { model: "pooled", memoryMb: 256 }, permissions: {} });
	assert.ok(args.includes("--permission"));
	assert.ok(args.includes("--max-old-space-size=256"));
});

test("buildExecArgv scopes fs flags to declared paths only", () => {
	const args = buildExecArgv({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { filesystem: { read: ["./assets", "./data"], write: ["./out"] } },
	});
	assert.ok(args.includes("--allow-fs-read=./assets,./data"));
	assert.ok(args.includes("--allow-fs-write=./out"));
});

test("buildExecArgv omits fs flags when no paths declared", () => {
	const args = buildExecArgv({ manifestVersion: 2, process: { model: "pooled" }, permissions: {} });
	assert.ok(!args.some((a) => a.startsWith("--allow-fs-read")));
	assert.ok(!args.some((a) => a.startsWith("--allow-fs-write")));
});

test("buildExecArgv emits --allow-net only when outbound hosts declared, never child-process/worker", () => {
	const withNet = buildExecArgv({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { network: { outbound: ["api.example.com"] } },
	});
	assert.ok(withNet.includes("--allow-net"));
	assert.ok(!withNet.some((a) => a.includes("child-process")));
	assert.ok(!withNet.some((a) => a.includes("allow-worker")));

	const noNet = buildExecArgv({ manifestVersion: 2, process: { model: "pooled" }, permissions: {} });
	assert.ok(!noNet.includes("--allow-net"));
});

// ── getProcessLimits ────────────────────────────────────────────────────────

test("getProcessLimits reads the manifest process block with defaults", () => {
	assert.deepStrictEqual(
		getProcessLimits({ manifestVersion: 2, process: { model: "oneshot" }, permissions: {} }),
		{ maxExecutionMs: 5000, memoryMb: 128, model: "oneshot" },
	);
});
