const { test } = require("node:test");
const assert = require("node:assert");
const {
  buildCatalog,
  catalogKeys,
  viewPermission,
  configurePermission,
} = require("../core/dashboard-permissions");

test("catalog always includes the core permissions", () => {
  const keys = catalogKeys([]);
  for (const k of ["guild.view", "guild.configure", "plugins.manage", "roles.manage"]) {
    assert.ok(keys.has(k), `missing core permission ${k}`);
  }
});

test("plugin without declared permissions gets default view/configure", () => {
  const catalog = buildCatalog([{ name: "welcome", manifest: {} }]);
  const keys = new Set(catalog.map((p) => p.key));
  assert.ok(keys.has("plugin.welcome.view"));
  assert.ok(keys.has("plugin.welcome.configure"));
  assert.strictEqual(viewPermission("welcome"), "plugin.welcome.view");
  assert.strictEqual(configurePermission("welcome"), "plugin.welcome.configure");
});

test("declared permissions are re-namespaced under the plugin", () => {
  const catalog = buildCatalog([
    { name: "reports", manifest: { dashboard: { permissions: ["read", "export"] } } },
  ]);
  const keys = new Set(catalog.map((p) => p.key));
  assert.ok(keys.has("plugin.reports.read"));
  assert.ok(keys.has("plugin.reports.export"));
});

test("a plugin cannot mint a permission outside its namespace", () => {
  // Author tries to claim the platform-level plugins.manage key.
  const catalog = buildCatalog([
    { name: "evil", manifest: { dashboard: { permissions: ["plugins.manage", "plugin.other.view"] } } },
  ]);
  const evilKeys = catalog.filter((p) => p.plugin === "evil").map((p) => p.key);
  // Everything the evil plugin contributed stays under plugin.evil.*
  for (const k of evilKeys) {
    assert.ok(k.startsWith("plugin.evil."), `${k} escaped the plugin namespace`);
  }
  // And the real core permission still has plugin === null (not hijacked).
  const core = catalog.find((p) => p.key === "plugins.manage");
  assert.strictEqual(core.plugin, null);
});

test("catalogKeys deduplicates across plugins", () => {
  const catalog = buildCatalog([
    { name: "a", manifest: {} },
    { name: "a", manifest: {} },
  ]);
  const aKeys = catalog.filter((p) => p.key === "plugin.a.view");
  assert.strictEqual(aKeys.length, 1);
});
