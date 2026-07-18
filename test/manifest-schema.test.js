const { test } = require("node:test");
const assert = require("node:assert");
const {
	MANIFEST_VERSION,
	migrateV1,
	normalize,
	validateManifestV2,
	isValidHost,
} = require("../core/manifest-schema");

// ── migrateV1 ───────────────────────────────────────────────────────────────

test("migrateV1 lifts a v1 capabilities block into v2 permissions", () => {
	const v1 = {
		name: "old",
		capabilities: { discord: ["SendMessages"], storage: ["own-collection"] },
	};
	const v2 = migrateV1(v1);
	assert.strictEqual(v2.manifestVersion, MANIFEST_VERSION);
	assert.strictEqual(v2._migratedFromV1, true);
	assert.deepStrictEqual(v2.permissions.discord, ["SendMessages"]);
	assert.deepStrictEqual(v2.permissions.storage, ["own-collection"]);
	assert.strictEqual(v2.process.model, "pooled");
});

test("migrateV1 does not mutate its input", () => {
	const v1 = { name: "old", capabilities: { discord: ["SendMessages"] } };
	migrateV1(v1);
	assert.strictEqual(v1.manifestVersion, undefined);
	assert.strictEqual(v1.permissions, undefined);
});

test("migrateV1 drops v1 network (no host granularity) into a quarantine field", () => {
	const v2 = migrateV1({ capabilities: { network: ["outbound-http"] } });
	assert.deepStrictEqual(v2.permissions.network.outbound, []);
	assert.deepStrictEqual(v2.permissions._legacyNetwork, ["outbound-http"]);
});

// ── normalize ─────────────────────────────────────────────────────────────��

test("normalize fills defaults for an otherwise-minimal v2 manifest", () => {
	const m = normalize({ manifestVersion: 2, permissions: { discord: ["SendMessages"] } });
	assert.strictEqual(m.process.model, "pooled");
	assert.strictEqual(m.process.memoryMb, 128);
	assert.deepStrictEqual(m.permissions.network.outbound, []);
	assert.strictEqual(m.permissions.childProcess, false);
});

test("normalize preserves declared network hosts and fs paths", () => {
	const m = normalize({
		manifestVersion: 2,
		permissions: {
			network: { outbound: ["api.example.com"] },
			filesystem: { read: ["./assets"], write: [] },
		},
	});
	assert.deepStrictEqual(m.permissions.network.outbound, ["api.example.com"]);
	assert.deepStrictEqual(m.permissions.filesystem.read, ["./assets"]);
});

// ── validateManifestV2 ────────────────────────────────────────────────────��

test("validateManifestV2 accepts a well-formed manifest", () => {
	const errors = validateManifestV2({
		manifestVersion: 2,
		process: { model: "pooled", maxExecutionMs: 5000, memoryMb: 128, persistentReason: null },
		permissions: {
			discord: ["SendMessages"],
			network: { outbound: ["api.example.com"] },
			filesystem: { read: [], write: [] },
			childProcess: false,
			nativeAddons: false,
		},
		declaredDependencies: [{ package: "node-fetch", version: "^3.3.0" }],
	});
	assert.deepStrictEqual(errors, []);
});

test("validateManifestV2 rejects wrong manifestVersion", () => {
	const errors = validateManifestV2({ manifestVersion: 1, process: {}, permissions: {} });
	assert.ok(errors.some((e) => e.includes("manifestVersion")));
});

test("validateManifestV2 rejects an unknown process model", () => {
	const errors = validateManifestV2({
		manifestVersion: 2,
		process: { model: "turbo", maxExecutionMs: 5000, memoryMb: 128 },
		permissions: {},
	});
	assert.ok(errors.some((e) => e.includes("process.model")));
});

test("validateManifestV2 requires persistentReason when model is persistent", () => {
	const errors = validateManifestV2({
		manifestVersion: 2,
		process: { model: "persistent", maxExecutionMs: 5000, memoryMb: 128, persistentReason: "" },
		permissions: {},
	});
	assert.ok(errors.some((e) => e.includes("persistentReason")));
});

test("validateManifestV2 rejects out-of-bounds resource limits", () => {
	const errors = validateManifestV2({
		manifestVersion: 2,
		process: { model: "pooled", maxExecutionMs: 999999, memoryMb: 9999 },
		permissions: {},
	});
	assert.ok(errors.some((e) => e.includes("maxExecutionMs")));
	assert.ok(errors.some((e) => e.includes("memoryMb")));
});

test("validateManifestV2 rejects an unknown discord permission", () => {
	const errors = validateManifestV2({
		manifestVersion: 2,
		process: { model: "pooled", maxExecutionMs: 5000, memoryMb: 128 },
		permissions: { discord: ["ObliterateServer"] },
	});
	assert.ok(errors.some((e) => e.includes("ObliterateServer")));
});

test("validateManifestV2 rejects a URL/wildcard where a bare host is required", () => {
	const errors = validateManifestV2({
		manifestVersion: 2,
		process: { model: "pooled", maxExecutionMs: 5000, memoryMb: 128 },
		permissions: { network: { outbound: ["https://api.example.com/path"] } },
	});
	assert.ok(errors.some((e) => e.includes("invalid host")));
});

// ── isValidHost ─────────────────────────────────────────────────────────────

test("isValidHost accepts bare hostnames, rejects schemes/paths/wildcards", () => {
	assert.ok(isValidHost("api.openweathermap.org"));
	assert.ok(isValidHost("example.co.uk"));
	assert.ok(!isValidHost("https://example.com"));
	assert.ok(!isValidHost("example.com/path"));
	assert.ok(!isValidHost("*.example.com"));
	assert.ok(!isValidHost("example.com:443"));
	assert.ok(!isValidHost("localhost"));
});
