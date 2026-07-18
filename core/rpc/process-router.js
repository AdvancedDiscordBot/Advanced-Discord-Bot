/**
 * process-router.js — Spawn strategy dispatcher + execArgv builder.
 *
 * The manifest is the source of truth for HOW a plugin runs. This module reads
 * a normalized v2 manifest and answers two questions:
 *
 *   1. getStrategy(manifest)  → which spawn strategy the WorkerManager uses
 *   2. buildExecArgv(manifest) → the Node flags a forked child is launched with
 *
 * Nothing here is hardcoded per-plugin: every value is derived from the
 * manifest's `process` and `permissions` blocks. That is the whole point —
 * isolate each plugin exactly as much as it declared it needs, no more.
 */

const { normalize } = require("../manifest-schema");

// Strategy identifiers returned by getStrategy().
const STRATEGY = {
	WARM_POOL: "warm-pool-lru", // pooled: short-lived, LRU warm pool (common case)
	DEDICATED: "dedicated-process", // persistent: one long-running fork
	COLD_FORK: "cold-fork-per-call", // oneshot: fork per call, torn down after
	HEAVY_REVIEW: "heavy-review-required", // gate, not a strategy — never auto-approved
};

/**
 * Decide the spawn strategy for a plugin from its manifest.
 *
 * childProcess / nativeAddons short-circuit to HEAVY_REVIEW regardless of
 * process.model: those two flags most directly threaten the isolation boundary
 * itself, so they can never be auto-approved by a static scan.
 *
 * @param {object} manifest - Raw or normalized v2 manifest
 * @returns {string} one of STRATEGY.*
 */
function getStrategy(manifest) {
	const m = normalize(manifest);
	const perm = m.permissions;

	if (perm.childProcess || perm.nativeAddons) {
		return STRATEGY.HEAVY_REVIEW;
	}

	switch (m.process.model) {
		case "persistent":
			return STRATEGY.DEDICATED;
		case "oneshot":
			return STRATEGY.COLD_FORK;
		case "pooled":
		default:
			return STRATEGY.WARM_POOL;
	}
}

/**
 * @param {string} strategy - a STRATEGY.* value
 * @returns {boolean} true if this manifest must NOT be auto-approved
 */
function requiresHeavyReview(strategy) {
	return strategy === STRATEGY.HEAVY_REVIEW;
}

/**
 * Build the Node execArgv for a forked child process from the manifest.
 *
 * Honest caveat (kept inline because it matters): Node's `--allow-net` is a
 * coarse on/off switch, NOT a per-host allowlist. The host-level granularity the
 * manifest promises (api.example.com specifically, not "the internet") is
 * enforced separately inside the RPC broker, where plugin network calls go
 * through ctx.network.fetch(url) and the host is checked against
 * permissions.network.outbound before the real request is made. Do not rely on
 * the OS flag alone for that granularity.
 *
 * `--allow-child-process` and `--allow-worker` are deliberately never emitted:
 * a manifest that needs them routes to HEAVY_REVIEW and isn't spawned here.
 *
 * @param {object} manifest - Raw or normalized v2 manifest
 * @returns {string[]} execArgv array for child_process.fork
 */
function buildExecArgv(manifest) {
	const m = normalize(manifest);
	const perm = m.permissions;

	const args = ["--permission", `--max-old-space-size=${m.process.memoryMb}`];

	if (perm.filesystem.read.length) {
		args.push(`--allow-fs-read=${perm.filesystem.read.join(",")}`);
	}
	if (perm.filesystem.write.length) {
		args.push(`--allow-fs-write=${perm.filesystem.write.join(",")}`);
	}
	if (perm.network.outbound.length) {
		// Coarse gate only — real host allowlisting happens in the broker.
		args.push("--allow-net");
	}

	return args;
}

/**
 * Resource limits for a child derived from the manifest's process block.
 * Consumed by the spawn layer (execArgv covers heap; wall-clock timeout is
 * enforced by the broker per call).
 *
 * @param {object} manifest
 * @returns {{ maxExecutionMs: number, memoryMb: number, model: string }}
 */
function getProcessLimits(manifest) {
	const m = normalize(manifest);
	return {
		maxExecutionMs: m.process.maxExecutionMs,
		memoryMb: m.process.memoryMb,
		model: m.process.model,
	};
}

module.exports = {
	STRATEGY,
	getStrategy,
	requiresHeavyReview,
	buildExecArgv,
	getProcessLimits,
};
