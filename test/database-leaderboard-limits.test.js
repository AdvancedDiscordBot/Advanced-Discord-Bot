const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { UserProfile } = require("../models/schemas");

function makeDb() {
	const db = new Database();
	db.ensureConnection = async () => {};
	return db;
}

function findChain(capture) {
	return {
		sort() { return this; },
		select() { return this; },
		skip(value) { capture.skip = value; return this; },
		limit(value) { capture.limit = value; return this; },
		lean() { return this; },
		then(resolve) { resolve([]); },
	};
}

test("getTopUsers bounds caller-supplied limits", async (t) => {
	const capture = {};
	t.mock.method(UserProfile, "find", () => findChain(capture));
	const db = makeDb();

	for (const [requested, applied] of [
		[1_000_000_000, 100],
		[-5, 10],
		["not-a-number", 10],
		[7.9, 7],
		[undefined, 10],
	]) {
		await db.getTopUsers("guild", requested);
		assert.equal(capture.limit, applied, `limit ${requested} should become ${applied}`);
	}
});

test("getPointsLeaderboard bounds limit and skip", async (t) => {
	const capture = {};
	t.mock.method(UserProfile, "find", () => findChain(capture));
	t.mock.method(UserProfile, "countDocuments", async () => 0);
	const db = makeDb();

	await db.getPointsLeaderboard("guild", 1000000, -20);
	assert.equal(capture.limit, 100);
	assert.equal(capture.skip, 0);

	await db.getPointsLeaderboard("guild", 25, 5.9);
	assert.equal(capture.limit, 25);
	assert.equal(capture.skip, 5);
});
