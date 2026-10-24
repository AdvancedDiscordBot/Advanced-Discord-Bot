const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { PluginConfig } = require("../models/schemas");

test("mergePluginConfig writes each field as its own dotted path", async (t) => {
	const calls = [];
	t.mock.method(PluginConfig, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		return { guildId: filter.guildId, pluginName: filter.pluginName, data: { label: "new", count: 2 } };
	});
	const db = new Database();
	db.ensureConnection = async () => {};

	const result = await db.mergePluginConfig("guild-1", "plugin-a", {
		label: "new",
		count: 2,
	});

	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].filter, { guildId: "guild-1", pluginName: "plugin-a" });
	assert.deepEqual(calls[0].update.$set, {
		"data.label": "new",
		"data.count": 2,
	});
	assert.equal("data" in calls[0].update.$set, false);
	assert.deepEqual(calls[0].update.$setOnInsert, {
		guildId: "guild-1",
		pluginName: "plugin-a",
	});
	assert.equal(calls[0].options.upsert, true);
	assert.equal(calls[0].options.new, true);
	assert.equal(calls[0].options.setDefaultsOnInsert, false);
	assert.equal(result.data.count, 2);
});

test("mergePluginConfig rejects unsafe field names", async (t) => {
	t.mock.method(PluginConfig, "findOneAndUpdate", async () => {
		throw new Error("must not reach the database");
	});
	const db = new Database();
	db.ensureConnection = async () => {};

	await assert.rejects(
		db.mergePluginConfig("guild-1", "plugin-a", { "nested.value": 1 }),
		/Invalid plugin config field/,
	);
});
