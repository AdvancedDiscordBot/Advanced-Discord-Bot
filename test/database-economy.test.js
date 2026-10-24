const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");

test("getGuildEconomy connects and creates defaults with one atomic upsert", async () => {
	const calls = [];
	const db = new Database();
	let connections = 0;
	db.ensureConnection = async () => { connections++; };
	db.GuildEconomy = {
		findOneAndUpdate: async (filter, update, options) => {
			calls.push({ filter, update, options });
			return { guildId: filter.guildId, minWorkAmount: 50 };
		},
	};

	const result = await db.getGuildEconomy("guild-1");

	assert.equal(connections, 1);
	assert.deepEqual(result, { guildId: "guild-1", minWorkAmount: 50 });
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].filter, { guildId: "guild-1" });
	assert.deepEqual(calls[0].update, { $setOnInsert: { guildId: "guild-1" } });
	assert.equal(calls[0].options.upsert, true);
	assert.equal(calls[0].options.new, true);
});

test("getGuildEconomy propagates database failures", async () => {
	const db = new Database();
	db.ensureConnection = async () => {};
	db.GuildEconomy = {
		findOneAndUpdate: async () => {
			throw new Error("database unavailable");
		},
	};

	await assert.rejects(db.getGuildEconomy("guild-1"), /database unavailable/);
});
