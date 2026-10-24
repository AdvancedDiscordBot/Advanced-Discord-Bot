const { test } = require("node:test");
const assert = require("node:assert");
const { PluginManager } = require("../core/PluginManager");

function makePM() {
  return new PluginManager({
    client: { commands: new Map(), on() {}, once() {}, off() {} },
    db: {}, scheduler: {}, hooks: { emitHook: async () => {} },
  });
}

test("getDependents finds plugins depending on target", () => {
  const pm = makePM();
  const a = pm.initPluginState("adb-plugin-a", { dependsOn: [] });
  const b = pm.initPluginState("adb-plugin-b", { dependsOn: ["adb-plugin-a"] });
  pm.plugins.set("adb-plugin-a", a);
  pm.plugins.set("adb-plugin-b", b);
  assert.deepStrictEqual(pm.getDependents("adb-plugin-a"), ["adb-plugin-b"]);
});

test("getDependents empty when none depend", () => {
  const pm = makePM();
  pm.plugins.set("adb-plugin-a", pm.initPluginState("adb-plugin-a", {}));
  assert.deepStrictEqual(pm.getDependents("adb-plugin-a"), []);
});

test("getPluginList exposes core/version/discordPermissions", () => {
  const pm = makePM();
  const state = pm.initPluginState("administration", {
    version: "1.0.0",
    discordPermissions: ["BanMembers"],
  });
  state.source = "local";
  pm.plugins.set("administration", state);
  const entry = pm.getPluginList()[0];
  assert.strictEqual(entry.core, true);
  assert.strictEqual(entry.version, "1.0.0");
  assert.deepStrictEqual(entry.discordPermissions, ["BanMembers"]);
});

test("worker crash exhaustion disables the plugin and records the reason", () => {
	const pm = makePM();
	const state = pm.initPluginState("crashed", {});
	state.enabled = true;
	state.loaded = true;
	pm.plugins.set("crashed", state);

	pm._onWorkerGaveUp({
		pluginId: "crashed",
		crashCount: 3,
		error: new Error("runtime exploded"),
	});

	assert.strictEqual(state.enabled, false);
	assert.strictEqual(state.loaded, false);
	assert.match(state.lastError, /crashed 3 times/);
	assert.match(state.lastError, /runtime exploded/);
});
