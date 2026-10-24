const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { UserProfile } = require("../models/schemas");

test("getUserProfile creates the first row with one atomic upsert", async (t) => {
	const calls = [];
	t.mock.method(UserProfile, "findOne", () => {
		throw new Error("getUserProfile must not read before upserting");
	});
	t.mock.method(UserProfile, "create", () => {
		throw new Error("getUserProfile must not insert separately");
	});
	t.mock.method(UserProfile, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		return { userId: filter.userId, guildId: filter.guildId };
	});

	const db = new Database();
	db.ensureConnection = async () => {};

	const profile = await db.getUserProfile("user-1", "guild-1");

	assert.deepEqual(profile, { userId: "user-1", guildId: "guild-1" });
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].filter, { userId: "user-1", guildId: "guild-1" });
	assert.deepEqual(calls[0].update, {
		$setOnInsert: { userId: "user-1", guildId: "guild-1" },
	});
	assert.equal(calls[0].options.upsert, true);
	assert.equal(calls[0].options.new, true);
});
