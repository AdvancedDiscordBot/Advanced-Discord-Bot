const { test } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
// Loaded before the env var is set, the way index.js loads it before dotenv.
const { PluginRegistry } = require("../core/pluginRegistry");

test("fetchRegistry uses PLUGIN_REGISTRY_URL set after the module was loaded", async (t) => {
	const original = process.env.PLUGIN_REGISTRY_URL;
	t.after(() => {
		if (original === undefined) delete process.env.PLUGIN_REGISTRY_URL;
		else process.env.PLUGIN_REGISTRY_URL = original;
	});
	process.env.PLUGIN_REGISTRY_URL = "https://github.com/example/private-registry/blob/main/plugins.json";
	const get = t.mock.method(axios, "get", async () => { throw new Error("offline"); });
	const reg = new PluginRegistry();
	await reg.fetchRegistry(true).catch(() => {});
	assert.equal(get.mock.calls[0].arguments[0], "https://raw.githubusercontent.com/example/private-registry/main/plugins.json");
});
