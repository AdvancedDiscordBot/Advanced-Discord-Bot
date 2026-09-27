const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { Collection } = require("discord.js");
const cron = require("node-cron");
const Database = require("../utils/database");
const TaskScheduler = require("../utils/scheduler");

function fixture(t, { trial = false } = {}) {
	const env = process.env;
	process.env = { TRIAL_MODE: String(trial) };
	t.after(() => { process.env = env; });
	t.mock.method(console, "log", () => {});
	const errors = t.mock.method(console, "error", () => {});
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const tasks = [];
	t.mock.method(cron, "schedule", (expression, run, options) => {
		const task = { expression, run, options, stops: 0, start() {}, stop() { this.stops++; } };
		tasks.push(task);
		return task;
	});
	const db = { getServerConfig: async () => ({ birthdayEnabled: false }) };
	t.mock.method(Database, "getInstance", async () => db);
	const client = { guilds: { cache: new Collection() }, db };
	const scheduler = new TaskScheduler(client);
	t.after(async () => { await scheduler.shutdown?.(); });
	return { scheduler, client, db, tasks, errors };
}

test("scheduler: all core and trial cron tasks are tracked, UTC, and stopped on shutdown", async (t) => {
	const { scheduler, tasks } = fixture(t, { trial: true });
	assert.equal(tasks.length, 6);
	assert.equal(scheduler.pluginTasks.size, 6);
	assert.ok(tasks.every((task) => task.options?.timezone === "UTC"));
	await scheduler.shutdown();
	await scheduler.shutdown();
	assert.ok(tasks.every((task) => task.stops === 1));
	assert.equal(scheduler.pluginTasks.size, 0);
});

test("scheduler: schedule(name, expression, fn) prevents overlap even across replacement", async (t) => {
	const { scheduler } = fixture(t);
	let release;
	let calls = 0;
	const task = scheduler.schedule("plugin-task", "* * * * *", () => {
		calls++;
		return new Promise((resolve) => { release = resolve; });
	});
	assert.equal(scheduler.pluginTasks.get("plugin-task"), task);
	const running = task.run();
	task.run();
	await nextTurn();
	assert.equal(calls, 1);
	let replacementCalls = 0;
	const replacement = scheduler.schedule("plugin-task", "*/2 * * * *", () => { replacementCalls++; });
	await replacement.run();
	assert.equal(replacementCalls, 0);
	release();
	await running;
	await replacement.run();
	assert.equal(replacementCalls, 1);
	await task.run();
	assert.equal(calls, 1, "stale callbacks cannot run after replacement");
	assert.equal(scheduler.unschedule("plugin-task"), true);
	assert.equal(scheduler.unschedule("plugin-task"), false);
	await replacement.run();
	assert.equal(replacementCalls, 1);
});

test("scheduler: cron callbacks observe synchronous and asynchronous failures", async (t) => {
	const { scheduler, tasks, errors } = fixture(t);
	scheduler.runDailyReset = async () => { throw new Error("reset failed"); };
	await assert.doesNotReject(tasks[0].run());
	const sync = scheduler.schedule("sync", "* * * * *", () => { throw new Error("sync failed"); });
	const asyncTask = scheduler.schedule("async", "* * * * *", async () => { throw new Error("async failed"); });
	await assert.doesNotReject(sync.run());
	await assert.doesNotReject(asyncTask.run());
	await assert.doesNotReject(asyncTask.run());
	assert.equal(errors.mock.callCount(), 4);
});

test("scheduler: shutdown waits for running work and refuses new or stale tasks", async (t) => {
	const { scheduler } = fixture(t);
	let release;
	let calls = 0;
	const task = scheduler.schedule("pending", "* * * * *", () => {
		calls++;
		return new Promise((resolve) => { release = resolve; });
	});
	const running = task.run();
	await nextTurn();
	let closed = false;
	const closing = scheduler.shutdown().then(() => { closed = true; });
	await nextTurn();
	assert.equal(closed, false);
	assert.throws(() => scheduler.schedule("late", "* * * * *", () => {}), /shut|stop|closed/i);
	await task.run();
	assert.equal(calls, 1);
	release();
	await Promise.all([running, closing]);
});

test("scheduler: queued callbacks are cancelled before execution on unschedule or shutdown", async (t) => {
	const { scheduler } = fixture(t);
	let calls = 0;
	const removed = scheduler.schedule("removed", "* * * * *", () => { calls++; });
	const first = removed.run();
	scheduler.unschedule("removed");
	await first;
	const stopped = scheduler.schedule("stopped", "* * * * *", () => { calls++; });
	const second = stopped.run();
	await scheduler.shutdown();
	await second;
	assert.equal(calls, 0);
});

test("scheduler: a failed birthday check is observed and does not poison the queue", async (t) => {
	const { scheduler, errors } = fixture(t);
	scheduler._checkBirthdays = async () => { throw new Error("birthday check failed"); };
	await assert.doesNotReject(scheduler.checkBirthdays());
	let calls = 0;
	scheduler._checkBirthdays = async () => { calls++; };
	await scheduler.checkBirthdays();
	assert.equal(calls, 1);
	assert.equal(errors.mock.callCount(), 1);
});

function birthdays(h, { role = false } = {}) {
	const today = new Date();
	const records = ["joining", "other"].map((userId) => ({ userId, birthdayDate: today, celebrationCount: 0 }));
	const sent = [];
	const removed = [];
	const guild = {
		id: "guild", name: "Guild",
		channels: { cache: new Collection([["birthdays", { send: async (payload) => { sent.push(payload); return { react: async () => {} }; } }]]) },
		roles: { cache: new Collection([["birthday-role", { id: "birthday-role", editable: true }]]) },
	};
	const members = new Collection(records.map(({ userId }) => [userId, {
		id: userId, displayName: userId, guild, manageable: true,
		user: { username: userId, displayAvatarURL: () => "https://example.test/avatar.png" },
		roles: { cache: new Collection(), add: async () => {}, remove: async () => { removed.push(userId); } },
	}]));
	guild.members = { fetch: async (id) => members.get(id) };
	h.client.guilds.cache.set(guild.id, guild);
	h.db.getServerConfig = async () => ({ birthdayEnabled: true, birthdayChannelId: "birthdays", birthdayRoleId: role ? "birthday-role" : null });
	h.db.Birthday = {
		find: async (query) => records.filter((record) => !query.userId || record.userId === query.userId),
		findOneAndUpdate: async (query, update) => { Object.assign(records.find((record) => record.userId === query.userId), update.$set || update); },
	};
	return { member: members.get("joining"), records, sent, removed };
}

test("scheduler: join birthday checks target only that member and honor lastCelebrated", async (t) => {
	const h = fixture(t);
	const { member, records, sent } = birthdays(h);
	await h.scheduler.checkBirthdays(member);
	assert.equal(sent.length, 1);
	assert.match(sent[0].content, /joining/);
	assert.ok(records[0].lastCelebrated);
	assert.equal(records[1].lastCelebrated, undefined);
	await h.scheduler.checkBirthdays(member);
	assert.equal(sent.length, 1);
	await h.scheduler.checkBirthdays();
	assert.equal(sent.length, 2);
});

test("scheduler: birthday role timers cannot run after shutdown", async (t) => {
	const h = fixture(t);
	const { member, removed } = birthdays(h, { role: true });
	member.roles.cache.set("birthday-role", {});
	await h.scheduler.checkBirthdays(member);
	await h.scheduler.shutdown();
	t.mock.timers.tick(24 * 60 * 60 * 1000);
	await nextTurn();
	assert.deepEqual(removed, []);
});
