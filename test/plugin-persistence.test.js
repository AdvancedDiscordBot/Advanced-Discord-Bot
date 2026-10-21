/**
 * test/plugin-persistence.test.js — the rebuild-survival manifest: plan the
 * npm actions needed to bring node_modules in line with the recorded
 * dashboard installs/uninstalls.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { planReconcile } = require("../core/plugin-persistence");

describe("plugin-persistence planReconcile", () => {
	it("no actions when everything already matches", () => {
		const actions = planReconcile(
			[
				{ package: "adb-plugin-todo", version: "1.3.0" },
				{ package: "adb-plugin-welcome", version: "2.1.0" },
			],
			(p) => ({ "adb-plugin-todo": "1.3.0", "adb-plugin-welcome": "2.1.0" }[p] || null),
		);
		assert.equal(actions.length, 0);
	});

	it("installs missing packages at the recorded version", () => {
		const actions = planReconcile(
			[{ package: "adb-plugin-todo", version: "1.3.0" }],
			() => null,
		);
		assert.deepEqual(actions, [
			{ action: "install", package: "adb-plugin-todo", spec: "adb-plugin-todo@1.3.0" },
		]);
	});

	it("reinstalls when the image pinned an older version", () => {
		// Rebuild downgrades: image has 1.2.0, dashboard had updated to 1.3.0.
		const actions = planReconcile(
			[{ package: "adb-plugin-automod", version: "1.3.0" }],
			() => "1.2.0",
		);
		assert.deepEqual(actions, [
			{ action: "install", package: "adb-plugin-automod", spec: "adb-plugin-automod@1.3.0" },
		]);
	});

	it("uninstalls image-pinned packages the admin removed", () => {
		const actions = planReconcile(
			[{ package: "adb-plugin-moderation", removed: true }],
			() => "1.3.0",
		);
		assert.deepEqual(actions, [
			{ action: "uninstall", package: "adb-plugin-moderation" },
		]);
	});

	it("removed entry with nothing installed is a no-op", () => {
		const actions = planReconcile(
			[{ package: "adb-plugin-x", removed: true }],
			() => null,
		);
		assert.equal(actions.length, 0);
	});

	it("entry without a version installs latest", () => {
		const actions = planReconcile(
			[{ package: "adb-plugin-x", version: null }],
			() => null,
		);
		assert.deepEqual(actions, [
			{ action: "install", package: "adb-plugin-x", spec: "adb-plugin-x" },
		]);
	});
});

describe("plugin-persistence reconcileInstalledPlugins", () => {
	it("treats an npm that cannot be spawned as a failed install instead of crashing", { timeout: 10000 }, async (t) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adb-persistence-"));
		fs.mkdirSync(path.join(dir, "data"));
		fs.writeFileSync(
			path.join(dir, "data", "installed-plugins.json"),
			JSON.stringify({ plugins: [{ package: "adb-plugin-todo", version: "1.3.0" }] }),
		);
		const cwd = process.cwd();
		const pathEnv = process.env.PATH;
		const modulePath = require.resolve("../core/plugin-persistence");
		t.after(() => {
			process.chdir(cwd);
			process.env.PATH = pathEnv;
			delete require.cache[modulePath];
			fs.rmSync(dir, { recursive: true, force: true });
		});

		// The manifest path is resolved from cwd at load time, and an empty PATH
		// makes spawn("npm") fail with ENOENT, which arrives as an "error" event.
		process.chdir(dir);
		process.env.PATH = "";
		delete require.cache[modulePath];
		const { reconcileInstalledPlugins } = require(modulePath);

		assert.deepEqual(await reconcileInstalledPlugins(), { changed: 1 });
	});
});
