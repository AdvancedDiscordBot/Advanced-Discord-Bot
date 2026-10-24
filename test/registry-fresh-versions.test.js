const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PluginRegistry } = require("../core/pluginRegistry");

function writePlugin(dir, manifest) {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(manifest));
}

test("getFreshPluginVersions discovers scoped and unscoped node_modules packages", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adb-fresh-versions-"));
	const previousCwd = process.cwd();
	t.after(() => {
		process.chdir(previousCwd);
		fs.rmSync(root, { recursive: true, force: true });
	});

	writePlugin(path.join(root, "plugins", "local"), {
		name: "adb-plugin-local",
		version: "1.2.3",
	});
	writePlugin(path.join(root, "node_modules", "adb-plugin-plain"), {
		name: "adb-plugin-plain",
		version: "2.0.0",
	});
	writePlugin(
		path.join(root, "node_modules", "@scope", "adb-plugin-scoped"),
		{ name: "adb-plugin-scoped", version: "3.0.0" },
	);

	process.chdir(root);
	const versions = await new PluginRegistry().getFreshPluginVersions();

	assert.ok(versions, "fresh version map should be returned");
	assert.equal(versions.get("adb-plugin-local").version, "1.2.3");
	assert.equal(versions.get("adb-plugin-plain").version, "2.0.0");
	assert.equal(versions.get("adb-plugin-scoped").version, "3.0.0");
	assert.equal(versions.get("adb-plugin-scoped").fromLocal, true);
});
