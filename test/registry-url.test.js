const { test } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const { PluginRegistry } = require("../core/pluginRegistry");

test("fetchRegistry reads PLUGIN_REGISTRY_URL after the module is loaded", async (t) => {
	const previous = process.env.PLUGIN_REGISTRY_URL;
	process.env.PLUGIN_REGISTRY_URL =
		"https://github.com/example/private-registry/blob/main/plugins.json";
	t.after(() => {
		if (previous === undefined) delete process.env.PLUGIN_REGISTRY_URL;
		else process.env.PLUGIN_REGISTRY_URL = previous;
	});

	const fetched = [];
	t.mock.method(axios, "get", async (url) => {
		fetched.push(url);
		return { data: { plugins: [] } };
	});

	const registry = new PluginRegistry();
	registry.saveCache = () => {};
	await registry.fetchRegistry(true);

	assert.deepEqual(fetched, [
		"https://raw.githubusercontent.com/example/private-registry/main/plugins.json",
	]);
});
