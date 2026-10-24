const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PluginRegistry } = require("../core/pluginRegistry");

function withRegistry(entries) {
	const registry = new PluginRegistry();
	registry.fetchRegistry = async () => entries;
	return registry;
}

test("searchPlugins ignores null and non-object registry entries", async () => {
	const registry = withRegistry([
		null,
		"not-an-entry",
		{ name: "Good Plugin", displayName: "Good", description: "Useful", category: "utility" },
	]);

	const results = await registry.searchPlugins("good");
	assert.deepEqual(results.map((entry) => entry.name), ["Good Plugin"]);
});

test("searchPlugins tolerates missing and non-string fields", async () => {
	const registry = withRegistry([
		{ name: "Missing Fields" },
		{ name: 42, displayName: null, description: {}, category: "utility" },
		{ name: "Other", displayName: "Other", description: "Find me" },
	]);

	assert.deepEqual(await registry.searchPlugins("find"), [
		{ name: "Other", displayName: "Other", description: "Find me" },
	]);
	assert.deepEqual(await registry.searchPlugins("42"), []);
});

test("getRegistryPluginDetails ignores entries with non-string identifiers", async () => {
	const registry = withRegistry([
		{ name: 42, npmPackage: 42 },
		{ name: "adb-plugin-real", npmPackage: "adb-plugin-real" },
	]);

	assert.equal(
		(await registry.getRegistryPluginDetails("real"))?.npmPackage,
		"adb-plugin-real",
	);
});
