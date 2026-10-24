const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { UserProfile } = require("../models/schemas");

function makeDb() {
	const db = new Database();
	db.ensureConnection = async () => {};
	return db;
}

test("givePoints rejects non-positive and non-finite amounts before writing", async (t) => {
	const calls = [];
	t.mock.method(UserProfile, "findOneAndUpdate", async () => {
		calls.push("update");
		return null;
	});
	const db = makeDb();

	for (const amount of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
		await assert.rejects(
			db.givePoints("giver", "receiver", "guild", amount),
			/positive finite/,
		);
	}
	assert.equal(calls.length, 0);
});

test("givePoints rejects self transfers", async (t) => {
	t.mock.method(UserProfile, "findOneAndUpdate", async () => {
		throw new Error("must not touch the database");
	});
	const db = makeDb();

	await assert.rejects(
		db.givePoints("same", "same", "guild", 10),
		/yourself/,
	);
});

test("givePoints debits with a balance guard and no upsert", async (t) => {
	const calls = [];
	t.mock.method(UserProfile, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		if (calls.length === 1) return { userId: "giver", points: 5, pointsGiven: 10 };
		return { userId: "receiver", points: 15, pointsReceived: 10 };
	});
	const db = makeDb();

	const result = await db.givePoints("giver", "receiver", "guild", 10);

	assert.equal(calls.length, 2);
	assert.deepEqual(calls[0].filter, {
		userId: "giver",
		guildId: "guild",
		points: { $gte: 10 },
	});
	assert.deepEqual(calls[0].update.$inc, { points: -10, pointsGiven: 10 });
	assert.notEqual(calls[0].options?.upsert, true);
	assert.deepEqual(calls[1].update.$inc, { points: 10, pointsReceived: 10 });
	assert.equal(calls[1].options.upsert, true);
	assert.equal(result.giver.points, 5);
	assert.equal(result.receiver.points, 15);
});

test("givePoints fails without a credit when the giver cannot cover it", async (t) => {
	const calls = [];
	t.mock.method(UserProfile, "findOneAndUpdate", async (filter, update, options) => {
		calls.push({ filter, update, options });
		return null;
	});
	const db = makeDb();

	await assert.rejects(
		db.givePoints("giver", "receiver", "guild", 50),
		/Insufficient points/,
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].options.upsert, undefined);
});

test("givePoints refunds the giver when the receiver write fails", async (t) => {
	const updates = [];
	t.mock.method(UserProfile, "findOneAndUpdate", async (filter, update, options) => {
		if (filter.userId === "giver") return { userId: "giver", points: 0, pointsGiven: 10 };
		throw new Error("receiver write failed");
	});
	t.mock.method(UserProfile, "updateOne", async (filter, update) => {
		updates.push({ filter, update });
		return { acknowledged: true };
	});
	const db = makeDb();

	await assert.rejects(
		db.givePoints("giver", "receiver", "guild", 10),
		/receiver write failed/,
	);
	assert.equal(updates.length, 1);
	assert.deepEqual(updates[0].filter, { userId: "giver", guildId: "guild" });
	assert.deepEqual(updates[0].update.$inc, { points: 10, pointsGiven: -10 });
});
