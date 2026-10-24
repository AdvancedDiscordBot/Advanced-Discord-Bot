const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { ServerConfig } = require("../models/schemas");

test("getServerConfig creates the first row with one atomic upsert", async (t) => {
	const calls = [];
	t.mock.method(ServerConfig, "findOne", () => {
		throw new Error("getServerConfig must not read before upserting");
	});
	t.mock.method(ServerConfig, "create", () => {
		throw new Error("getServerConfig must not insert separately");
	});
	t.mock.method(ServerConfig, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		return { guildId: filter.guildId };
	});

	const db = new Database();
	db.ensureConnection = async () => {};

	const config = await db.getServerConfig("guild-1");

	assert.deepEqual(config, { guildId: "guild-1" });
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].filter, { guildId: "guild-1" });
	assert.deepEqual(calls[0].update, { $setOnInsert: { guildId: "guild-1" } });
	assert.equal(calls[0].options.upsert, true);
	assert.equal(calls[0].options.new, true);
});
