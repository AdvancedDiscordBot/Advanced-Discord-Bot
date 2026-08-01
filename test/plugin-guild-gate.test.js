const { test } = require("node:test");
const assert = require("node:assert");
const PluginManager = require("../core/PluginManager").PluginManager;

// PluginManager pulls in a lot, but the guild-enable gate only touches
// this.plugins and the in-memory enable index, so a bare instance is enough.
function makeManager(plugins = []) {
  const pm = new PluginManager({ client: {}, db: {}, scheduler: {}, hooks: {} });
  pm.plugins = new Map(plugins.map((p) => [p.name, p]));
  return pm;
}

function pkg(name, { raw = false, source = "package" } = {}) {
  return {
    name,
    source,
    manifest: { capabilities: { system: raw ? ["raw-client"] : [] } },
  };
}

test("only package plugins without raw-client are gateable", () => {
  const pm = makeManager([
    pkg("gateme"),
    pkg("rawthing", { raw: true }),
    pkg("builtin", { source: "core" }),
    pkg("localdev", { source: "local" }),
  ]);
  assert.strictEqual(pm.isGuildGateable("gateme"), true);
  assert.strictEqual(pm.isGuildGateable("rawthing"), false, "raw-client is non-disableable");
  assert.strictEqual(pm.isGuildGateable("builtin"), false, "core is always-on");
  assert.strictEqual(pm.isGuildGateable("localdev"), false, "local is always-on");
  assert.strictEqual(pm.isGuildGateable("unknown"), false);
});

test("gateable plugin is off until enabled for a guild", () => {
  const pm = makeManager([pkg("gateme")]);
  pm._enableIndexAt = Date.now(); // pretend the index is fresh so no refresh fires
  assert.strictEqual(pm.isEnabledForGuild("g1", "gateme"), false);
  pm.setEnabledForGuild("g1", "gateme", true);
  assert.strictEqual(pm.isEnabledForGuild("g1", "gateme"), true);
  assert.strictEqual(pm.isEnabledForGuild("g2", "gateme"), false, "enable is per-guild");
});

test("non-gateable plugins are always enabled regardless of index", () => {
  const pm = makeManager([pkg("rawthing", { raw: true }), pkg("builtin", { source: "core" })]);
  assert.strictEqual(pm.isEnabledForGuild("g1", "rawthing"), true);
  assert.strictEqual(pm.isEnabledForGuild("g1", "builtin"), true);
});

test("setEnabledForGuild(false) removes the gate key", () => {
  const pm = makeManager([pkg("gateme")]);
  pm._enableIndexAt = Date.now();
  pm.setEnabledForGuild("g1", "gateme", true);
  pm.setEnabledForGuild("g1", "gateme", false);
  assert.strictEqual(pm.isEnabledForGuild("g1", "gateme"), false);
});

test("refreshEnableIndex rebuilds the set from db rows", async () => {
  const pm = makeManager([pkg("gateme")]);
  pm.db.getAllEnabledPluginRows = async () => [{ guildId: "g1", pluginName: "gateme" }];
  await pm.refreshEnableIndex();
  assert.strictEqual(pm.isEnabledForGuild("g1", "gateme"), true);
  assert.strictEqual(pm.isEnabledForGuild("g9", "gateme"), false);
});

test("refreshEnableIndex keeps the old snapshot on db error", async () => {
  const pm = makeManager([pkg("gateme")]);
  pm._enableIndexAt = Date.now();
  pm.setEnabledForGuild("g1", "gateme", true);
  pm.db.getAllEnabledPluginRows = async () => { throw new Error("db down"); };
  await pm.refreshEnableIndex();
  assert.strictEqual(pm.isEnabledForGuild("g1", "gateme"), true, "must not drop grants on error");
});

test("_eventGuildId extracts guildId from common arg shapes", () => {
  const pm = makeManager();
  assert.strictEqual(pm._eventGuildId([{ guildId: "g1" }]), "g1");
  assert.strictEqual(pm._eventGuildId([{ guild: { id: "g2" } }]), "g2");
  assert.strictEqual(pm._eventGuildId([{ foo: "bar" }]), null);
});
