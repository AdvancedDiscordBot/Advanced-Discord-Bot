const { isMainThread } = require("node:worker_threads");
const assert = require("node:assert/strict");

module.exports.load = (ctx) => {
	assert.equal(process.env.ADB_WORKER_ENV_CANARY, undefined, "Worker inherited an ungranted host environment variable");
	assert.equal(process.env.ADB_WORKER_ENV_GRANTED, "approved");
	assert.equal(ctx.config.env.ADB_WORKER_ENV_GRANTED, "approved");
};

if (isMainThread && require.main === module) {
	const { test } = require("node:test");
	const { HookBus } = require("../core/HookBus");
	const { CapabilityBroker } = require("../core/rpc/broker");
	const { WorkerManager } = require("../core/rpc/worker-manager");

	test("workers receive only explicitly granted environment variables, including after restart", { timeout: 10000 }, async (t) => {
		const previous = process.env.ADB_WORKER_ENV_CANARY;
		process.env.ADB_WORKER_ENV_CANARY = "synthetic-host-only-value";
		const hooks = new HookBus(console);
		const broker = new CapabilityBroker({ client: {}, db: {}, hooks });
		const manager = new WorkerManager({ broker, hooks });
		t.after(async () => {
			await manager.shutdown();
			if (previous === undefined) delete process.env.ADB_WORKER_ENV_CANARY;
			else process.env.ADB_WORKER_ENV_CANARY = previous;
		});
		await manager.spawnWorker("env-check", __filename, {}, "env-check", {
			grantedEnv: { ADB_WORKER_ENV_GRANTED: "approved" },
		});
		assert.equal(manager.activeCount, 1);
		await manager.restartWorker("env-check");
		assert.equal(manager.activeCount, 1);
	});
}
