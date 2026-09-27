const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate: nextTurn } = require("node:timers/promises");
const mongoose = require("mongoose");
const Database = require("../utils/database");

function fixture(t) {
	const env = process.env;
	const instance = Database.instance;
	const readyState = mongoose.connection.readyState;
	process.env = { MONGODB_URI: "mongodb://database.invalid/lifecycle-test" };
	Database.instance = null;
	mongoose.connection.readyState = 0;
	t.mock.method(process, "exit", () => { throw new Error("Database must not exit the process"); });
	t.mock.method(console, "log", () => {});
	t.mock.method(console, "error", () => {});
	const connect = t.mock.method(mongoose, "connect", async () => { mongoose.connection.readyState = 1; });
	const disconnect = t.mock.method(mongoose, "disconnect", async () => { mongoose.connection.readyState = 0; });
	t.after(() => {
		process.env = env;
		Database.instance = instance;
		mongoose.connection.readyState = readyState;
	});
	return { connect, disconnect };
}

test("database: concurrent first callers both wait for the same connection", async (t) => {
	const { connect } = fixture(t);
	let release;
	connect.mock.mockImplementation(() => new Promise((resolve) => {
		release = () => { mongoose.connection.readyState = 1; resolve(); };
	}));
	const settled = [];
	const first = Database.getInstance().then((db) => { settled.push(db); return db; });
	const second = Database.getInstance().then((db) => { settled.push(db); return db; });
	await nextTurn();
	assert.equal(settled.length, 0);
	assert.equal(connect.mock.callCount(), 1);
	release();
	const [a, b] = await Promise.all([first, second]);
	assert.equal(a, b);
	assert.equal(a.isConnected, true);
});

test("database: connection failure rejects all callers, awaits cleanup, and permits retry", async (t) => {
	const { connect, disconnect } = fixture(t);
	const failure = new Error("database unavailable");
	connect.mock.mockImplementation(async () => { throw failure; });
	let finishCleanup;
	disconnect.mock.mockImplementation(() => new Promise((resolve) => { finishCleanup = resolve; }));
	let settled = false;
	const first = Database.getInstance().catch((error) => { settled = true; return error; });
	const second = Database.getInstance().catch((error) => error);
	await nextTurn();
	assert.equal(settled, false, "connection failure must wait for driver cleanup");
	assert.equal(connect.mock.callCount(), 1);
	finishCleanup();
	assert.deepEqual(await Promise.all([first, second]), [failure, failure]);
	assert.equal(Database.instance.isConnected, false);
	connect.mock.mockImplementation(async () => { mongoose.connection.readyState = 1; });
	assert.equal((await Database.getInstance()).isConnected, true);
	assert.equal(connect.mock.callCount(), 2);
});

test("database: missing URI rejects without exiting or contacting MongoDB", async (t) => {
	const { connect } = fixture(t);
	process.env = {};
	await assert.rejects(Database.getInstance(), /MONGODB_URI/);
	assert.equal(connect.mock.callCount(), 0);
});

test("database: close is awaited and idempotent and prevents reconnection", async (t) => {
	const { disconnect } = fixture(t);
	const db = await Database.getInstance();
	let release;
	disconnect.mock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
	let closed = false;
	const first = Promise.resolve(db.close()).then(() => { closed = true; });
	const second = db.close();
	await nextTurn();
	assert.equal(closed, false);
	assert.equal(db.isConnected, false);
	assert.equal(disconnect.mock.callCount(), 1);
	release();
	await Promise.all([first, second]);
	await assert.rejects(db.ensureConnection(), /closed/i);
});

test("database: shutdown during initial connection waits and cannot leave it connected", async (t) => {
	const { connect, disconnect } = fixture(t);
	let release;
	connect.mock.mockImplementation(() => new Promise((resolve) => {
		release = () => { mongoose.connection.readyState = 1; resolve(); };
	}));
	const db = new Database();
	const opening = db.connect().catch((error) => error);
	const closing = db.close();
	assert.equal(disconnect.mock.callCount(), 0);
	release();
	await closing;
	assert.match((await opening)?.message || "", /closed/i);
	assert.equal(disconnect.mock.callCount(), 1);
	assert.equal(db.isConnected, false);
	assert.equal(mongoose.connection.readyState, 0);
});

test("database: disconnected driver state is not masked by a stale isConnected flag", async (t) => {
	const { connect } = fixture(t);
	const db = await Database.getInstance();
	mongoose.connection.readyState = 0;
	await db.ensureConnection();
	assert.equal(connect.mock.callCount(), 2);
});

test("database: disabled and empty role rewards have the same safe result shape", async (t) => {
	fixture(t);
	const db = new Database();
	t.mock.method(db, "ensureConnection", async () => {});
	t.mock.method(db, "getUserProfile", async () => ({ currentRoles: [{ roleId: "existing" }] }));
	t.mock.method(db, "getTopUsers", async () => []);
	for (const config of [{ roleAutomation: false, roleRewards: [{ roleId: "existing" }] }, { roleAutomation: true }, { roleAutomation: true, roleRewards: [] }]) {
		t.mock.method(db, "getServerConfig", async () => config);
		assert.deepEqual(await db.checkRoleRewards("user", "guild"), { eligibleRoles: [], currentRoles: [] });
	}
});
