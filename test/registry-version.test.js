const { test } = require("node:test");
const assert = require("node:assert");
const { PluginRegistry } = require("../core/pluginRegistry");

const r = new PluginRegistry();

test("isNewer true when candidate greater", () => {
  assert.strictEqual(r.isNewer("1.0.0", "1.1.0"), true);
});
test("isNewer false when equal", () => {
  assert.strictEqual(r.isNewer("1.0.0", "1.0.0"), false);
});
test("isNewer false when candidate older", () => {
  assert.strictEqual(r.isNewer("2.0.0", "1.9.9"), false);
});
test("isNewer false on garbage input", () => {
  assert.strictEqual(r.isNewer("x", "y"), false);
});

// Cache a registry entry and disable fresh-local lookup so getPluginDetails
// runs offline (fetchRegistry serves the in-memory cache within its TTL).
function offlineRegistry(freshVersions = null) {
  const reg = new PluginRegistry();
  reg.registry = [
    {
      name: "adb-plugin-automod",
      npmPackage: "adb-plugin-automod",
      displayName: "AutoMod",
      permissions: ["db.read"],
      version: "1.0.0",
    },
  ];
  reg.lastFetch = Date.now();
  reg.getFreshPluginVersions = async () => freshVersions;
  return reg;
}

test("getPluginDetails matches the slug with or without the adb-plugin- prefix", async () => {
  const reg = offlineRegistry();
  const bySlug = await reg.getPluginDetails("automod");
  assert.strictEqual(bySlug.name, "adb-plugin-automod");
  const byFullName = await reg.getPluginDetails("adb-plugin-automod");
  assert.strictEqual(byFullName.name, "adb-plugin-automod");
});

test("getPluginDetails keeps registry metadata when merging a fresh local version", async () => {
  const reg = offlineRegistry(
    new Map([
      ["adb-plugin-automod", { version: "9.9.9", npmPackage: "adb-plugin-automod", fromLocal: true }],
    ]),
  );
  const details = await reg.getPluginDetails("automod");
  assert.strictEqual(details.displayName, "AutoMod");
  assert.deepStrictEqual(details.permissions, ["db.read"]);
  assert.strictEqual(details.version, "9.9.9");
  assert.strictEqual(details.fromLocal, true);
});
