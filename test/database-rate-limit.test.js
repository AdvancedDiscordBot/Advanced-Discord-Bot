const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { AIRateLimit } = require("../models/schemas");

function makeDb() {
	const db = new Database();
	db.ensureConnection = async () => {};
	return db;
}

test("checkRateLimit creates the first row with a zero count before charging", async (t) => {
	const calls = [];
	t.mock.method(AIRateLimit, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		if (calls.length === 1) return { requestCount: 0 };
		if (calls.length === 3) return { requestCount: 1 };
		return null;
	});
	const db = makeDb();

	const result = await db.checkRateLimit("user", "guild", 10, 60000);

	assert.equal(result.allowed, true);
	assert.equal(result.remaining, 9);
	const create = calls[0];
	assert.equal(create.options.upsert, true);
	assert.equal(create.update.$setOnInsert.requestCount, 0);
	assert.equal(create.update.$setOnInsert.userId, "user");
	assert.equal(create.update.$setOnInsert.guildId, "guild");
});

test("checkRateLimit increments the count in a capped atomic update", async (t) => {
	const calls = [];
	t.mock.method(AIRateLimit, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		if (calls.length === 1) return { requestCount: 0 };
		if (calls.length === 2) return null;
		return { requestCount: 2 };
	});
	const db = makeDb();

	const result = await db.checkRateLimit("user", "guild", 10, 60000);

	assert.deepEqual(result, { allowed: true, remaining: 8 });
	const increment = calls[2];
	assert.deepEqual(increment.filter.requestCount, { $lt: 10 });
	assert.deepEqual(increment.update.$inc, { requestCount: 1 });
});

test("checkRateLimit resets an expired window once", async (t) => {
	const calls = [];
	t.mock.method(AIRateLimit, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		if (calls.length === 1) return { requestCount: 10 };
		if (calls.length === 2) return { requestCount: 1 };
		return null;
	});
	const db = makeDb();

	const result = await db.checkRateLimit("user", "guild", 10, 60000);

	assert.deepEqual(result, { allowed: true, remaining: 9 });
	const reset = calls[1];
	assert.ok(Array.isArray(reset.filter.$or));
	assert.equal(reset.update.$set.requestCount, 1);
	assert.ok(reset.update.$set.resetAt instanceof Date);
});

test("checkRateLimit denies when the cap has been reached", async (t) => {
	const resetAt = new Date(Date.now() + 60000);
	t.mock.method(AIRateLimit, "findOneAndUpdate", async () => null);
	t.mock.method(AIRateLimit, "findOne", async () => ({ resetAt }));
	const db = makeDb();

	const result = await db.checkRateLimit("user", "guild", 2, 60000);

	assert.equal(result.allowed, false);
	assert.equal(result.remaining, 0);
	assert.equal(result.resetTime, resetAt);
});
