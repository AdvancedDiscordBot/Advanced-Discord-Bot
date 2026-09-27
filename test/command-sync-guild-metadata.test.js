const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PluginManager } = require("../core/PluginManager");
const { guildCommandBody, syncAllGuilds } = require("../core/command-sync");

function setup() {
	const client = new EventEmitter();
	client.commands = new Map();
	client.guilds = { cache: new Map() };
	const manager = new PluginManager({ client, db: {}, scheduler: {}, hooks: { emitHook: async () => {} } });
	for (const name of ["custom", "other"]) {
		const state = manager.initPluginState(name, {});
		state.loaded = true;
		manager.plugins.set(name, state);
	}
	return { client, manager };
}

test("command sync honors guildIds and guildData for slash, user and message commands", () => {
	const { client, manager } = setup();
	manager.registerCommand("custom", {
		data: { name: "greet", type: 1, description: "First guild" }, execute() {},
		guildIds: ["first", "second"],
		guildData: {
			first: { name: "greet", type: 1, description: "First guild" },
			second: { name: "greet", type: 1, description: "Second guild" },
		},
	});
	for (const [name, type] of [["Profile", 2], ["Quote", 3]]) {
		manager.registerCommand("custom", { data: { name, type }, guildIds: ["first"], execute() {} });
	}
	assert.deepEqual(guildCommandBody(manager, client, "first"), [
		{ name: "greet", type: 1, description: "First guild" }, { name: "Profile", type: 2 }, { name: "Quote", type: 3 },
	]);
	assert.deepEqual(guildCommandBody(manager, client, "second"), [{ name: "greet", type: 1, description: "Second guild" }]);
	assert.deepEqual(guildCommandBody(manager, client, "third"), []);
	client.commands.get("greet").guildIds.push("third");
	assert.deepEqual(guildCommandBody(manager, client, "third"), [], "never fall back to another guild's definition");
});

test("disabled or still-loading plugins cannot contribute commands", () => {
	const { client, manager } = setup();
	manager.registerCommand("custom", { data: { name: "hidden" }, execute() {} });
	manager.plugins.get("custom").enabled = false;
	assert.deepEqual(guildCommandBody(manager, client, "first"), []);
	manager.plugins.get("custom").enabled = true;
	manager.plugins.get("custom").loaded = false;
	assert.deepEqual(guildCommandBody(manager, client, "first"), []);
});

test("deleted runtime commands release stale ownership before another plugin registers", async () => {
	const { client, manager } = setup();
	manager.registerCommand("custom", { data: { name: "reusable" }, execute() {} });
	client.commands.delete("reusable");
	const replacement = { data: { name: "reusable", description: "replacement" }, execute() {} };
	manager.registerCommand("other", replacement);
	assert.equal(manager.plugins.get("custom").commandNames.has("reusable"), false);
	assert.equal(manager.plugins.get("custom").hasCommands, false);
	await manager.unloadPlugin("custom");
	assert.equal(client.commands.get("reusable"), replacement);
});

test("exact ownership wins over stale name sets before guild filtering", () => {
	const { client, manager } = setup();
	manager.registerCommand("other", { data: { name: "private" }, execute() {} });
	manager.plugins.get("custom").commandNames.add("private");
	manager.plugins.get("other").enabled = false;
	assert.deepEqual(guildCommandBody(manager, client, "first"), []);
	const command = client.commands.get("private");
	assert.equal(manager.getCommandOwner(command), "other");
	client.commands.set("private", { ...command });
	assert.equal(manager.getCommandOwner(command), null);
	assert.deepEqual(guildCommandBody(manager, client, "first"), [], "unregistered copies do not inherit ownership");
});

test("builder and circular Discord errors fail only their guild and do not send partial bodies", async () => {
	const { client, manager } = setup();
	manager.registerCommand("custom", {
		data: { name: "choice" }, execute() {},
		guildIds: ["broken-builder", "discord-error", "good"],
		guildData: {
			"broken-builder": { toJSON() { throw new Error("bad builder"); } },
			"discord-error": { name: "choice", description: "valid" },
			good: { toJSON() { return { name: "choice", description: "good", ignored() {} }; } },
		},
	});
	const sent = [];
	const error = new Error("Discord failed");
	error.rawError = { errors: { big: 1n } };
	error.rawError.errors.self = error.rawError.errors;
	for (const id of ["broken-builder", "discord-error", "good"]) {
		client.guilds.cache.set(id, { id, commands: { set: async (body) => {
			sent.push({ id, body });
			if (id === "discord-error") throw error;
		} } });
	}
	const results = await syncAllGuilds(manager, client);
	assert.deepEqual(results.map((result) => result.ok), [false, false, true]);
	assert.deepEqual(sent.map(({ id }) => id), ["discord-error", "good"]);
	assert.deepEqual(sent[1].body, [{ name: "choice", description: "good" }]);
});
