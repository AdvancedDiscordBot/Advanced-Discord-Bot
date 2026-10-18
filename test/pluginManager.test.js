const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PluginManager } = require("../core/PluginManager");

function makePM(config = {}) {
  return new PluginManager({
    client: { commands: new Map(), on() {}, once() {}, off() {} },
    db: { getAllEnabledPluginRows: async () => [] },
    scheduler: {}, hooks: { emitHook: async () => {} },
    config,
  });
}

const discovered = (name, manifest = {}) => ({ name, manifest: { name, ...manifest } });
const names = (plugins) => plugins.map((plugin) => plugin.name);

// Real npm-style plugin packages, so loadAll runs actual discovery and loading.
function installPlugins(t, manifests) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adb-plugin-deps-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nodeModulesDir = path.join(root, "node_modules");
  for (const [name, manifest] of Object.entries(manifests)) {
    const dir = path.join(nodeModulesDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
    fs.writeFileSync(path.join(dir, "index.js"), "exports.load = async () => {};\n");
  }
  return { pluginsDir: path.join(root, "plugins"), nodeModulesDir };
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

test("sortByDependencies loads dependencies before their dependents", () => {
  const pm = makePM();
  const ordered = pm.sortByDependencies([
    discovered("adb-plugin-b", { dependsOn: ["adb-plugin-a"] }),
    discovered("adb-plugin-a"),
  ]);
  assert.deepStrictEqual(names(ordered), ["adb-plugin-a", "adb-plugin-b"]);
});

test("sortByDependencies skips plugins in a dependency cycle instead of throwing", () => {
  const pm = makePM();
  const plugins = [
    discovered("adb-plugin-a", { engines: { plugins: { "adb-plugin-b": "*" } } }),
    discovered("adb-plugin-b", { engines: { plugins: { "adb-plugin-a": "*" } } }),
    discovered("adb-plugin-self", { dependsOn: ["adb-plugin-self"] }),
    discovered("adb-plugin-needs-a", { dependsOn: ["adb-plugin-a"] }),
    discovered("adb-plugin-healthy"),
  ];
  assert.deepStrictEqual(names(pm.sortByDependencies(plugins)), ["adb-plugin-healthy"]);
  assert.deepStrictEqual(names(plugins.filter((plugin) => plugin.disabled)), [
    "adb-plugin-a", "adb-plugin-b", "adb-plugin-self", "adb-plugin-needs-a",
  ]);
});

test("sortByDependencies never loads a plugin whose dependency is missing, even when another plugin needs it", () => {
  for (const order of [["top", "mid"], ["mid", "top"]]) {
    const plugins = {
      top: discovered("adb-plugin-top", { dependsOn: ["adb-plugin-mid"] }),
      mid: discovered("adb-plugin-mid", { dependsOn: ["adb-plugin-not-installed"] }),
    };
    const ordered = makePM().sortByDependencies(order.map((key) => plugins[key]));
    assert.deepStrictEqual(names(ordered), [], `discovery order: ${order.join(", ")}`);
  }
});

test("loadAll still loads healthy plugins when an installed plugin has a dependency cycle", async (t) => {
  const pm = makePM(installPlugins(t, {
    "adb-plugin-a": { engines: { plugins: { "adb-plugin-b": "*" } } },
    "adb-plugin-b": { engines: { plugins: { "adb-plugin-a": "*" } } },
    "adb-plugin-healthy": {},
  }));
  pm.loadCore = async () => {};
  pm.setupHotReload = () => {};
  await pm.loadAll();
  assert.deepStrictEqual([...pm.plugins.keys()], ["adb-plugin-healthy"]);
  assert.strictEqual(pm.plugins.get("adb-plugin-healthy").loaded, true);
});

test("command collection still refuses to deploy when a plugin has a dependency cycle", async (t) => {
  const pm = makePM({
    ...installPlugins(t, {
      "adb-plugin-self": { dependsOn: ["adb-plugin-self"] },
      "adb-plugin-healthy": {},
    }),
    commandCollection: true,
  });
  pm.loadCore = async () => {};
  await assert.rejects(pm.loadAll(), /missing or circular plugin dependencies/);
});
