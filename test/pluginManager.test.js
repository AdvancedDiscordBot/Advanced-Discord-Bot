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

test("an enable during a pending refresh is preserved", async () => {
	const pm = makePM();
	let resolveRows;
	pm.db.getAllEnabledPluginRows = () => new Promise((resolve) => { resolveRows = resolve; });
	const refreshing = pm.refreshEnableIndex();

	pm.setEnabledForGuild("guild-1", "plugin-a", true);
	resolveRows([{ guildId: "guild-1", pluginName: "other" }]);
	await refreshing;

	assert.equal(pm._enableIndex.has("guild-1:plugin-a"), true);
	assert.equal(pm._enableIndex.has("guild-1:other"), true);
});

test("a disable during a pending refresh is preserved", async () => {
	const pm = makePM();
	pm._enableIndex.add("guild-1:plugin-a");
	let resolveRows;
	pm.db.getAllEnabledPluginRows = () => new Promise((resolve) => { resolveRows = resolve; });
	const refreshing = pm.refreshEnableIndex();

	pm.setEnabledForGuild("guild-1", "plugin-a", false);
	resolveRows([{ guildId: "guild-1", pluginName: "plugin-a" }]);
	await refreshing;

	assert.equal(pm._enableIndex.has("guild-1:plugin-a"), false);
});
