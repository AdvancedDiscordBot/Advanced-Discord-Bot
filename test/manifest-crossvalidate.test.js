const { test } = require("node:test");
const assert = require("node:assert");
const {
	extractSpecifiers,
	crossValidateSources,
} = require("../core/manifest-crossvalidate");

// ── extractSpecifiers (AST, not regex) ──────────────────────────────────────

test("extractSpecifiers finds require, import, dynamic import, export-from", () => {
	const code = `
		const fs = require("fs");
		import http from "https";
		export { x } from "./local";
		async function f() { await import("child_process"); }
	`;
	const { specifiers, parseError } = extractSpecifiers(code);
	assert.strictEqual(parseError, null);
	assert.ok(specifiers.includes("fs"));
	assert.ok(specifiers.includes("https"));
	assert.ok(specifiers.includes("./local"));
	assert.ok(specifiers.includes("child_process"));
});

test("extractSpecifiers ignores strings that only look like requires", () => {
	// A string literal that isn't an actual require/import call must not count.
	const code = `const note = "require('child_process') is dangerous";`;
	const { specifiers } = extractSpecifiers(code);
	assert.deepStrictEqual(specifiers, []);
});

test("extractSpecifiers reports parse errors instead of throwing", () => {
	const { parseError } = extractSpecifiers("const = = =", "bad.js");
	assert.ok(parseError);
	assert.ok(parseError.includes("bad.js"));
});

// ── Gated builtins ──────────────────────────────────────────────────────────

test("crossValidate rejects fs use with no filesystem permission", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const fs = require("fs"); fs.readFileSync("x");` },
	]);
	assert.strictEqual(res.ok, false);
	assert.ok(res.errors.some((e) => e.includes("fs")));
});

test("crossValidate allows fs use when filesystem.read is declared", () => {
	const manifest = {
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { filesystem: { read: ["./assets"] } },
	};
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const fs = require("fs");` },
	]);
	assert.strictEqual(res.ok, true, res.errors.join("; "));
});

test("crossValidate rejects http use with no network.outbound", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const https = require("https");` },
	]);
	assert.strictEqual(res.ok, false);
	assert.ok(res.errors.some((e) => e.includes("https")));
});

test("crossValidate rejects child_process unless childProcess:true", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `require("child_process").exec("ls");` },
	]);
	assert.strictEqual(res.ok, false);
	assert.ok(res.errors.some((e) => e.includes("child_process")));
});

test("crossValidate always rejects vm regardless of permissions", () => {
	const manifest = {
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { childProcess: true, filesystem: { read: ["/"] }, network: { outbound: ["x.com"] } },
	};
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const vm = require("vm");` },
	]);
	assert.strictEqual(res.ok, false);
	assert.ok(res.errors.some((e) => e.includes("vm")));
});

test("crossValidate ignores non-gated builtins like path/crypto", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const path = require("path"); const c = require("node:crypto");` },
	]);
	assert.strictEqual(res.ok, true, res.errors.join("; "));
});

// ── declaredDependencies ────────────────────────────────────────────────────

test("crossValidate rejects an undeclared package", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const fetch = require("node-fetch");` },
	]);
	assert.strictEqual(res.ok, false);
	assert.ok(res.errors.some((e) => e.includes("node-fetch")));
});

test("crossValidate accepts a declared package (subpath collapses to root)", () => {
	const manifest = {
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: {},
		declaredDependencies: [{ package: "lodash", version: "^4.0.0" }],
	};
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const merge = require("lodash/merge");` },
	]);
	assert.strictEqual(res.ok, true, res.errors.join("; "));
});

test("crossValidate treats host-provided modules as always allowed", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const { Client } = require("discord.js"); require("mongoose");` },
	]);
	assert.strictEqual(res.ok, true, res.errors.join("; "));
});

test("crossValidate ignores local relative imports", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "index.js", code: `const card = require("./lib/card"); const x = require("../util");` },
	]);
	assert.strictEqual(res.ok, true, res.errors.join("; "));
});

test("crossValidate rejects a plugin whose code fails to parse", () => {
	const manifest = { manifestVersion: 2, process: { model: "pooled" }, permissions: {} };
	const res = crossValidateSources(manifest, [
		{ filename: "broken.js", code: `function ( {` },
	]);
	assert.strictEqual(res.ok, false);
	assert.ok(res.errors.some((e) => e.includes("Parse error")));
});
