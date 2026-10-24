const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { UserProfile, XPTransaction } = require("../models/schemas");

function makeDb(t) {
	const updates = [];
	t.mock.method(UserProfile, "findOne", async () => ({
		totalXp: 0, level: 1, dailyXp: 0, weeklyXp: 0, monthlyXp: 0,
		activityScore: 0, messageCount: 0, voiceMinutes: 0,
	}));
	t.mock.method(UserProfile, "create", async () => ({
		totalXp: 0, level: 1, dailyXp: 0, weeklyXp: 0, monthlyXp: 0,
		activityScore: 0, messageCount: 0, voiceMinutes: 0,
	}));
	t.mock.method(UserProfile, "findOneAndUpdate", async (filter, update) => {
		if (Array.isArray(update)) {
			updates.push({ filter, update });
			return {
				totalXp: 10, level: 2, dailyXp: 10, weeklyXp: 10, monthlyXp: 10,
				activityScore: 10, messageCount: 1, voiceMinutes: 0,
			};
		}
		return { totalXp: 0, level: 1, dailyXp: 0, weeklyXp: 0, monthlyXp: 0, activityScore: 0 };
	});
	t.mock.method(XPTransaction, "create", async (doc) => doc);
	const db = new Database();
	db.ensureConnection = async () => {};
	return { db, updates };
}

test("addXP applies increments in one pipeline update", async (t) => {
	const { db, updates } = makeDb(t);

	const result = await db.addXP("user-1", "guild-1", 10, "message", "test");

	assert.equal(updates.length, 1);
	const pipeline = updates[0].update;
	assert.ok(Array.isArray(pipeline));
	assert.equal(pipeline.length, 2);

	const set = pipeline[0].$set;
	assert.ok(set.totalXp.$max, "total XP must be clamped against zero");
	assert.ok(set.dailyXp.$add, "daily XP must increment in the database");
	assert.ok(set.weeklyXp.$add, "weekly XP must increment in the database");
	assert.ok(set.monthlyXp.$add, "monthly XP must increment in the database");
	assert.ok(set.activityScore.$floor, "activity score must be recomputed in the database");
	assert.ok(set.messageCount.$add, "message count must increment in the database");
	assert.ok(set.lastMessageAt instanceof Date);

	assert.ok(pipeline[1].$set.level, "level must be recomputed from the stored total");
	assert.equal(result.profile.totalXp, 10);
	assert.equal(result.newLevel, 2);
	assert.equal(result.levelUp, true);
});

test("addXP rejects a non-finite amount before writing", async (t) => {
	const { db, updates } = makeDb(t);

	await assert.rejects(
		db.addXP("user-1", "guild-1", Number.NaN),
		/finite number/,
	);
	assert.equal(updates.length, 0);
});
