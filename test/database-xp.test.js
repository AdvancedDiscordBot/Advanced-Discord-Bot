const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { UserProfile, XPTransaction } = require("../models/schemas");

function fixture(t, profile) {
	const updates = [];
	t.mock.method(UserProfile, "findOneAndUpdate", async (_filter, update) => {
		updates.push(update.$set);
		return { ...profile, ...update.$set };
	});
	t.mock.method(XPTransaction, "create", async () => ({}));
	const db = Object.create(Database.prototype);
	db.ensureConnection = async () => {};
	db.getUserProfile = async () => ({ ...profile });
	return { db, updates };
}

const baseProfile = {
	totalXp: 0, level: 0, dailyXp: 0, weeklyXp: 0, monthlyXp: 0,
	messageCount: 0, voiceMinutes: 10, activityScore: 0,
};

test("addXP: a voice award adds the whole session to voiceMinutes", async (t) => {
	const { db, updates } = fixture(t, baseProfile);
	await db.addXP("user", "guild", 180, "voice", "90 minutes in voice chat", { voiceMinutes: 90 });
	assert.equal(updates[0].voiceMinutes, 100);
});

test("addXP: voice awards without a session length still count one minute", async (t) => {
	const { db, updates } = fixture(t, baseProfile);
	await db.addXP("user", "guild", 2, "voice");
	assert.equal(updates[0].voiceMinutes, 11);
});

test("addXP: message awards leave voiceMinutes alone", async (t) => {
	const { db, updates } = fixture(t, baseProfile);
	await db.addXP("user", "guild", 3, "message");
	assert.equal(updates[0].voiceMinutes, undefined);
	assert.equal(updates[0].messageCount, 1);
});
