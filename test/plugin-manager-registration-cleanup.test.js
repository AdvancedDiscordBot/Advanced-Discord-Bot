const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { PluginManager } = require("../core/PluginManager");

function makeManager(config = {}) {
	const client = new EventEmitter();
	client.commands = new Map();
	return new PluginManager({ client, db: {}, scheduler: {}, hooks: { emitHook: async () => {} }, config });
}

test("discovery follows local, npm-link and scoped symlinks and skips malformed manifests", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adb-plugin-discovery-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const pluginsDir = path.join(root, "plugins");
	const nodeModulesDir = path.join(root, "node_modules");
	fs.mkdirSync(pluginsDir);
	fs.mkdirSync(nodeModulesDir);
	fs.mkdirSync(path.join(nodeModulesDir, "@scope"));
	for (const [name, location] of [["local", pluginsDir], ["npm", nodeModulesDir], ["scoped", path.join(nodeModulesDir, "@scope")]]) {
		const target = path.join(root, name);
		fs.mkdirSync(target);
		fs.writeFileSync(path.join(target, "plugin.json"), JSON.stringify({ name }));
		fs.symlinkSync(target, path.join(location, `adb-plugin-${name}`));
	}
	fs.mkdirSync(path.join(pluginsDir, "broken"));
	fs.writeFileSync(path.join(pluginsDir, "broken", "plugin.json"), "{broken");
	fs.symlinkSync(path.join(root, "missing"), path.join(nodeModulesDir, "adb-plugin-missing"));
	const manager = makeManager({ pluginsDir, nodeModulesDir });
	const plugins = manager.discoverPlugins();
	assert.deepEqual(plugins.map((p) => p.name).sort(), ["local", "npm", "scoped"]);
	assert.equal(plugins.find((p) => p.name === "npm").source, "package");
	assert.equal(plugins.find((p) => p.name === "scoped").packageName, "@scope/adb-plugin-scoped");
});

test("another plugin cannot take command ownership or remove the owner's command on unload", async () => {
	const manager = makeManager();
	for (const name of ["owner", "other"]) manager.plugins.set(name, manager.initPluginState(name, {}));
	const command = { data: { name: "owned" }, execute() {} };
	manager.registerCommand("owner", command);
	assert.throws(() => manager.registerCommand("other", { ...command, execute() {} }), /already|owned/i);
	await manager.unloadPlugin("other");
	assert.equal(manager.client.commands.get("owned"), command);
	assert.deepEqual([...manager.plugins.get("owner").commandNames], ["owned"]);
});

test("failed plugin load removes partial commands and event handlers", async () => {
	const manager = makeManager();
	manager._loadPluginDirect = async (_plugin, _state, _logger) => {
		manager.registerCommand("broken", { data: { name: "partial" }, execute() {} });
		manager.registerEvent("broken", "threadUpdate", () => {});
		throw new Error("load failed after registration");
	};
	await manager.loadPlugin({ name: "broken", manifest: {}, source: "local" });
	assert.equal(manager.plugins.get("broken").enabled, false);
	assert.equal(manager.plugins.get("broken").lastError, "load failed after registration");
	assert.equal(manager.client.commands.has("partial"), false);
	assert.equal(manager.client.listenerCount("threadUpdate"), 0);
	assert.equal(manager.plugins.get("broken").commandNames.size, 0);
});
