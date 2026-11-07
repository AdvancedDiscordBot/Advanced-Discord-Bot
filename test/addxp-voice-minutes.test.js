const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("../utils/database");
const { UserProfile } = require("../models/schemas");
const { XPTransaction } = require("../models/schemas");

function setup(t, profile) {
	const db = Object.create(Database.prototype);
	db.ensureConnection = async () => {};
	db.getUserProfile = async () => profile;
	let update;
	t.mock.method(UserProfile, "findOneAndUpdate", async (_filter, change) => {
		update = change.$set;
		return { ...profile, ...update };
	});
	t.mock.method(XPTransaction, "create", async () => {});
	return { db, getUpdate: () => update };
}

const baseProfile = () => ({
	totalXp: 0, level: 1, dailyXp: 0, weeklyXp: 0, monthlyXp: 0, activityScore: 0, voiceMinutes: 5,
});

test("addXP adds the whole voice session length to voiceMinutes", async (t) => {
	const { db, getUpdate } = setup(t, baseProfile());
	await db.addXP("u", "g", 20, "voice", "10 minutes in voice chat", { voiceMinutes: 10 });
	assert.equal(getUpdate().voiceMinutes, 15);
});

test("addXP still counts one voice minute when no session length is given", async (t) => {
	const { db, getUpdate } = setup(t, baseProfile());
	await db.addXP("u", "g", 2, "voice");
	assert.equal(getUpdate().voiceMinutes, 6);
});

test("addXP ignores invalid voiceMinutes values", async (t) => {
	for (const bad of [-4, 0, NaN, "7"]) {
		const { db, getUpdate } = setup(t, baseProfile());
		await db.addXP("u", "g", 2, "voice", null, { voiceMinutes: bad });
		assert.equal(getUpdate().voiceMinutes, 6);
	}
});
