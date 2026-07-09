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
