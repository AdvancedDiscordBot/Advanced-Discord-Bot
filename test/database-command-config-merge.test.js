const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { PluginConfig } = require("../models/schemas");

test("updatePluginCommandConfig writes only the submitted subfields", async (t) => {
	const calls = [];
	t.mock.method(PluginConfig, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		return { data: { _commands: { runtime: { enabled: false } } } };
	});
	const db = new Database();
	db.ensureConnection = async () => {};

	await db.updatePluginCommandConfig("guild-1", "plugin-a", "runtime", {
		enabled: false,
		allowedRoles: ["role-1"],
	});

	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].update.$set, {
		"data._commands.runtime.enabled": false,
		"data._commands.runtime.allowedRoles": ["role-1"],
	});
	assert.equal("data" in calls[0].update.$set, false);
	assert.deepEqual(calls[0].update.$setOnInsert, {
		guildId: "guild-1",
		pluginName: "plugin-a",
	});
	assert.equal(calls[0].options.upsert, true);
	assert.equal(calls[0].options.setDefaultsOnInsert, false);
});

test("updatePluginCommandConfig leaves omitted fields untouched", async (t) => {
	const calls = [];
	t.mock.method(PluginConfig, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		return { data: {} };
	});
	const db = new Database();
	db.ensureConnection = async () => {};

	await db.updatePluginCommandConfig("guild-1", "plugin-a", "runtime", {
		allowedRoles: ["role-2"],
	});

	assert.deepEqual(calls[0].update.$set, {
		"data._commands.runtime.allowedRoles": ["role-2"],
	});
	assert.equal("data._commands.runtime.enabled" in calls[0].update.$set, false);
});

test("updatePluginCommandConfig rejects unsafe command names", async (t) => {
	t.mock.method(PluginConfig, "findOneAndUpdate", async () => {
		throw new Error("must not reach the database");
	});
	const db = new Database();
	db.ensureConnection = async () => {};

	await assert.rejects(
		db.updatePluginCommandConfig("guild-1", "plugin-a", "bad.name", { enabled: true }),
		/Invalid command name/,
	);
});
