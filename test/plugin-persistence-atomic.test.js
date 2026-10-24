const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readManifest, recordInstall, recordUninstall } = require("../core/plugin-persistence");

function makeWorkspace(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adb-plugin-manifest-"));
	const previous = process.cwd();
	const pkgDir = path.join(root, "node_modules", "adb-plugin-example");
	fs.mkdirSync(pkgDir, { recursive: true });
	fs.writeFileSync(
		path.join(pkgDir, "package.json"),
		JSON.stringify({ name: "adb-plugin-example", version: "1.2.3" }),
	);
	process.chdir(root);
	t.after(() => {
		process.chdir(previous);
		fs.rmSync(root, { recursive: true, force: true });
	});
	return root;
}

test("install and uninstall records round-trip through the manifest", (t) => {
	makeWorkspace(t);

	recordInstall("adb-plugin-example");
	assert.deepEqual(readManifest(), [
		{ package: "adb-plugin-example", version: "1.2.3" },
	]);

	recordUninstall("adb-plugin-example");
	assert.deepEqual(readManifest(), [
		{ package: "adb-plugin-example", removed: true },
	]);
});

test("a failed rename leaves the previous manifest intact", (t) => {
	const root = makeWorkspace(t);
	const manifestPath = path.join(root, "data", "installed-plugins.json");
	fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
	const previous = JSON.stringify({
		plugins: [{ package: "keep-me", version: "9.9.9" }],
	});
	fs.writeFileSync(manifestPath, previous);
	t.mock.method(fs, "renameSync", () => {
		throw new Error("rename failed");
	});

	assert.throws(() => recordInstall("adb-plugin-example"), /rename failed/);
	assert.equal(fs.readFileSync(manifestPath, "utf8"), previous);
	assert.deepEqual(fs.readdirSync(path.dirname(manifestPath)), [
		"installed-plugins.json",
	]);
});
