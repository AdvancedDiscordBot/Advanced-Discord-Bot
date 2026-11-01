/**
 * test/plugin-persistence.test.js — the rebuild-survival manifest: plan the
 * npm actions needed to bring node_modules in line with the recorded
 * dashboard installs/uninstalls.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	planReconcile,
	readManifest,
	writeManifest,
} = require("../core/plugin-persistence");

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


describe("plugin-persistence atomic writeManifest", () => {
	it("writes manifest atomically and survives round trip", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adb-manifest-test-"));
		const manifestPath = path.join(tempDir, "installed-plugins.json");

		try {
			const samplePlugins = [
				{ package: "adb-plugin-test", version: "1.0.0" },
				{ package: "adb-plugin-extra", removed: true },
			];

			writeManifest(samplePlugins, manifestPath);
			const loaded = readManifest(manifestPath);
			assert.deepEqual(loaded, samplePlugins);

			// Ensure no leftover temp files exist
			const files = fs.readdirSync(tempDir);
			assert.deepEqual(files, ["installed-plugins.json"]);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("leaves original manifest intact and cleans up temp file if rename fails", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adb-manifest-fail-"));
		const manifestPath = path.join(tempDir, "installed-plugins.json");

		try {
			const originalPlugins = [{ package: "original-pkg", version: "1.0.0" }];
			writeManifest(originalPlugins, manifestPath);

			const origRename = fs.renameSync;
			fs.renameSync = () => {
				throw new Error("Simulated disk rename failure");
			};

			try {
				assert.throws(
					() => writeManifest([{ package: "new-corrupt-pkg", version: "2.0.0" }], manifestPath),
					/Simulated disk rename failure/,
				);
			} finally {
				fs.renameSync = origRename;
			}

			// Original manifest should still be intact
			const current = readManifest(manifestPath);
			assert.deepEqual(current, originalPlugins);

			// Temp files should have been removed
			const remainingFiles = fs.readdirSync(tempDir);
			assert.deepEqual(remainingFiles, ["installed-plugins.json"]);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
