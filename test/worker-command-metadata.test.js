const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { isMainThread } = require("node:worker_threads");
const { SlashCommandBuilder, PermissionsBitField, PermissionFlagsBits } = require("discord.js");
const { PluginManager } = require("../core/PluginManager");
const { HookBus } = require("../core/HookBus");
const { guildCommandBody } = require("../core/command-sync");
const dispatcher = require("../events/interactionCreate");

// Loaded by the actual worker bootstrap, so builders and permissions cross IPC.
module.exports.load = (ctx) => ctx.registerCommand({
	data: { name: "restricted", description: "Base definition" },
	cooldown: 0,
	guildIds: ["allowed", "second"],
	guildData: {
		allowed: new SlashCommandBuilder().setName("restricted").setDescription("Allowed definition"),
		second: { name: "restricted", description: "Second definition", toJSON() { return this; } },
	},
	permissions: new PermissionsBitField(PermissionFlagsBits.ManageMessages),
	execute: (interaction) => interaction.reply({ content: "executed", flags: 64 }),
});

async function setup(t) {
	const client = new EventEmitter();
	client.commands = new Map();
	client.hooks = new HookBus();
	const manager = new PluginManager({ client, hooks: client.hooks, db: {}, scheduler: {} });
	client.pluginManager = manager;
	manager.enableIsolation();
	t.after(() => manager.shutdown());
	await manager.loadPlugin({
		name: "metadata-worker", entryPath: __filename, source: "package",
		manifest: { capabilities: { discord: ["SendMessages"] } },
	});
	assert.equal(manager.plugins.get("metadata-worker").loaded, true, manager.plugins.get("metadata-worker").lastError);
	manager._enableIndexAt = Date.now();
	// Enable even the outside guild, so only command metadata can reject it.
	for (const guild of ["allowed", "second", "outside"]) manager.setEnabledForGuild(guild, "metadata-worker", true);
	return { client, manager };
}

function interaction(guildId, permissions) {
	return {
		id: `${guildId}:${permissions}`, type: 2, commandType: 1, commandName: "restricted",
		guildId, channelId: "channel", guild: { id: guildId, ownerId: "someone-else" },
		createdTimestamp: Date.now(), user: { id: "caller" },
		memberPermissions: new PermissionsBitField(permissions), options: { data: [] },
		isChatInputCommand: () => true, isAutocomplete: () => false,
		replies: [],
		async reply(payload) { this.replied = true; this.replies.push(payload); },
	};
}

if (isMainThread) {
	test("worker registration preserves clone-safe guild definitions and permission metadata", async (t) => {
		const { client, manager } = await setup(t);
		const command = client.commands.get("restricted");
		assert.deepEqual(command.guildIds, ["allowed", "second"]);
		assert.equal(command.guildData.allowed.description, "Allowed definition");
		assert.equal(command.guildData.second.description, "Second definition");
		assert.equal(command.guildData.second.toJSON, undefined);
		assert.equal(PermissionsBitField.resolve(command.permissions), PermissionFlagsBits.ManageMessages);
		assert.doesNotThrow(() => structuredClone(command.guildData));
		assert.equal(guildCommandBody(manager, client, "allowed")[0].description, "Allowed definition");
		assert.equal(guildCommandBody(manager, client, "second")[0].description, "Second definition");
		assert.deepEqual(guildCommandBody(manager, client, "outside"), []);
		const allowed = interaction("allowed", PermissionFlagsBits.ManageMessages);
		await dispatcher.execute(allowed, client);
		assert.deepEqual(allowed.replies, [{ content: "executed", flags: 64 }]);
	});

	test("real worker command is denied outside its guildIds by the main dispatcher", async (t) => {
		const { client } = await setup(t);
		const outside = interaction("outside", PermissionFlagsBits.Administrator);
		await dispatcher.execute(outside, client);
		assert.equal(outside.replies.length, 1);
		assert.match(outside.replies[0].content, /unavailable|permission/);
	});

	test("real worker command keeps its permissions gate in the main dispatcher", async (t) => {
		const { client } = await setup(t);
		const denied = interaction("allowed", 0n);
		await dispatcher.execute(denied, client);
		assert.equal(denied.replies.length, 1);
		assert.match(denied.replies[0].content, /unavailable|permission/);
	});
}
