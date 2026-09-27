const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Collection, PermissionsBitField, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const mongoose = require("mongoose");
const Database = require("../utils/database");
const router = require("../events/interactionCreate");
const moderation = require("../utils/moderation");

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const CHANNEL = "200000000000000001";
const ROLE = "300000000000000001";
const USER = "400000000000000001";
const CREATOR = "400000000000000002";
const OWNER = "400000000000000003";
const TICKET = "500000000000000000000001";
const clone = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(setImmediate);

function fixture(t, { kind = "chat", commandPermissions = false, bits = 0n, roles = [], userId = USER } = {}) {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1760000000000 });
	t.mock.method(mongoose, "connect", () => assert.fail("Live MongoDB is forbidden"));
	t.mock.method(global, "fetch", () => assert.fail("Live HTTP is forbidden"));
	t.mock.method(console, "error", () => {});
	t.mock.method(console, "log", () => {});
	const calls = [];
	const tickets = new Map([[TICKET, { _id: TICKET, guildId: GUILD, channelId: CHANNEL, userId: CREATOR, title: "Persisted ticket", status: "open", priority: "medium" }]]);
	let config = { data: {} };
	const db = {
		async getPluginConfig(guildId, name) { calls.push({ method: "getPluginConfig", guildId, name }); return clone(config); },
		async getTicketById(id) { calls.push({ method: "getTicketById", id }); return tickets.has(id) ? clone(tickets.get(id)) : null; },
		async updateTicket(id, data) {
			calls.push({ method: "updateTicket", id, data });
			if (!tickets.has(id)) return null;
			tickets.set(id, { ...tickets.get(id), ...clone(data) });
			return clone(tickets.get(id));
		},
	};
	t.mock.method(Database, "getInstance", async () => db);
	const owners = new WeakMap();
	const state = { enabled: true, commandNames: new Set(["run"]), manifest: { settings: { commandPermissions } } };
	const client = {
		commands: new Collection(), cooldowns: new Collection(),
		colors: { primary: "#5865F2", success: "#00FF00", warning: "#FFA500", error: "#FF0000" },
		hooks: { async emitHook(name, payload) { calls.push({ method: name }); return { cancelled: false, payload }; } },
		pluginManager: {
			plugins: new Map([["actual-owner", state]]),
			getCommandOwner(command) { return owners.get(command); },
			isGuildGateable() { return true; },
			isEnabledForGuild() { return true; },
			broker: { isSuspended() { return false; } },
		},
	};
	const command = {
		data: { name: "run", type: kind === "user" ? 2 : kind === "message" ? 3 : 1 },
		cooldown: 0,
		async execute(interaction) { calls.push({ method: "execute" }); await interaction.reply({ content: "executed" }); },
		async autocomplete(interaction) { calls.push({ method: "autocomplete" }); await interaction.respond([{ name: "Option", value: "option" }]); },
	};
	owners.set(command, "actual-owner");
	client.commands.set("run", command);
	const makeInteraction = (options = {}) => {
		const type = options.kind || kind;
		const id = options.userId || userId;
		const guild = {
			id: GUILD, ownerId: OWNER, name: "Runtime Guild",
			roles: { cache: new Collection([[ROLE, { id: ROLE, name: "Allowed role" }]]) },
		};
		const permissions = new PermissionsBitField(options.bits ?? bits);
		const user = { id, tag: `user-${id}`, toString: () => `<@${id}>` };
		return {
			client, user, guild, guildId: GUILD, channelId: CHANNEL,
			member: { id, user, guild, permissions, roles: { cache: new Collection(roles.map((r) => [r, { id: r, name: "Allowed role" }])) } },
			memberPermissions: permissions, createdTimestamp: Date.now(),
			commandName: "run", commandType: type === "user" ? 2 : type === "message" ? 3 : 1,
			type: type === "autocomplete" ? 4 : ["chat", "user", "message"].includes(type) ? 2 : type === "modal" ? 5 : 3,
			customId: options.customId || `ticket_claim_${TICKET}`,
			values: options.values || ["high"],
			fields: { getTextInputValue() { return "Issue resolved"; } },
			message: {
				embeds: [new EmbedBuilder().setTitle("Persisted ticket")],
				async edit(payload) { calls.push({ method: "message.edit", payload }); },
			},
			channel: { id: CHANNEL, guildId: GUILD, deletable: true, async delete() { calls.push({ method: "channel.delete" }); } },
			isChatInputCommand: () => type === "chat",
			isContextMenuCommand: () => type === "user" || type === "message",
			isUserContextMenuCommand: () => type === "user",
			isMessageContextMenuCommand: () => type === "message",
			isAutocomplete: () => type === "autocomplete",
			isButton: () => type === "button",
			isStringSelectMenu: () => type === "select",
			isModalSubmit: () => type === "modal",
			replied: false, deferred: false, responded: false,
			async reply(payload) {
				assert.ok(!this.replied && !this.deferred, "cannot reply twice");
				this.replied = true;
				calls.push({ method: "reply", payload });
			},
			async deferReply(payload) {
				assert.ok(!this.replied && !this.deferred, "cannot defer after responding");
				this.deferred = true;
				calls.push({ method: "deferReply", payload });
			},
			async editReply(payload) {
				assert.ok(this.deferred || this.replied, "editReply requires acknowledgement");
				this.replied = true;
				calls.push({ method: "editReply", payload });
			},
			async followUp(payload) {
				assert.ok(this.deferred || this.replied, "followUp requires acknowledgement");
				calls.push({ method: "followUp", payload });
			},
			async update(payload) {
				assert.ok(!this.replied && !this.deferred, "update requires a fresh interaction");
				this.replied = true;
				calls.push({ method: "update", payload });
			},
			async showModal(modal) {
				assert.ok(!this.replied && !this.deferred, "modals cannot follow an automatic defer");
				this.replied = true;
				calls.push({ method: "showModal", payload: modal });
			},
			async respond(choices) {
				assert.ok(type === "autocomplete" && !this.responded, "autocomplete must respond once");
				this.responded = true;
				calls.push({ method: "respond", choices });
			},
		};
	};
	const interaction = makeInteraction();
	return { client, command, state, db, interaction, tickets, calls, owners, makeInteraction, setConfig(value) { config = value; }, run: (input = interaction) => router.execute(input, client) };
}

function count(f, method) { return f.calls.filter((call) => call.method === method).length; }
function replies(f) { return f.calls.filter((call) => ["reply", "editReply", "followUp"].includes(call.method)); }

test("routing: camelCase plugin permission declarations are enforced like Discord API declarations", async (t) => {
	const f = fixture(t);
	f.command.data.defaultMemberPermissions = "ManageMessages";
	await f.run();
	assert.equal(count(f, "execute"), 0);
	await f.run(f.makeInteraction({ bits: PermissionFlagsBits.ManageMessages }));
	assert.equal(count(f, "execute"), 1);
});

for (const kind of ["chat", "user", "message"]) {
	test(`routing: ${kind} commands execute exactly once through the hook pipeline`, async (t) => {
		const f = fixture(t, { kind });
		await f.run();
		assert.equal(count(f, "execute"), 1);
		assert.equal(count(f, "beforeCommand"), 1);
		assert.equal(count(f, "afterCommand"), 1);
	});
}

test("routing: autocomplete uses command.autocomplete, never execute or command cooldowns", async (t) => {
	const f = fixture(t, { kind: "autocomplete", commandPermissions: true });
	f.command.cooldown = 30;
	await f.run();
	await f.run(f.makeInteraction());
	assert.equal(count(f, "autocomplete"), 2);
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "respond"), 2);
	assert.equal(f.client.cooldowns.size, 0);
});

for (const kind of ["chat", "user", "message", "autocomplete"]) {
	test(`routing: missing ${kind} commands receive a terminal response`, async (t) => {
		const f = fixture(t, { kind });
		f.client.commands.clear();
		await f.run();
		assert.equal(count(f, "execute"), 0);
		if (kind === "autocomplete") assert.deepEqual(f.calls.find((c) => c.method === "respond")?.choices, []);
		else assert.equal(count(f, "reply"), 1);
	});
}

test("routing: application command types cannot invoke a different registered type", async (t) => {
	const f = fixture(t);
	f.command.data.type = 2;
	await f.run();
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "reply"), 1);
});

test("routing: exact registration owner wins over stale commandNames in another plugin", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	f.client.pluginManager.plugins = new Map([
		["stale-owner", { ...f.state, enabled: false }], ["actual-owner", f.state],
	]);
	t.mock.method(f.db, "getPluginConfig", async (_guild, name) => ({ data: { _commands: { run: { enabled: name === "actual-owner" } } } }));
	await f.run();
	assert.equal(count(f, "execute"), 1);
});

for (const condition of ["disabled", "suspended", "guild gate", "wrong guild", "empty guilds", "malformed guilds", "missing owner"]) {
	test(`routing: ${condition} blocks commands and autocomplete`, async (t) => {
		const f = fixture(t);
		if (condition === "disabled") f.state.enabled = false;
		if (condition === "suspended") f.client.pluginManager.broker.isSuspended = () => true;
		if (condition === "guild gate") f.client.pluginManager.isEnabledForGuild = () => false;
		if (condition === "wrong guild") f.command.guildIds = [OTHER_GUILD];
		if (condition === "empty guilds") f.command.guildIds = [];
		if (condition === "malformed guilds") f.command.guildIds = GUILD;
		if (condition === "missing owner") f.owners.delete(f.command);
		await f.run();
		await f.run(f.makeInteraction({ kind: "autocomplete" }));
		assert.equal(count(f, "execute"), 0);
		assert.equal(count(f, "autocomplete"), 0);
		assert.equal(count(f, "reply"), 1);
		assert.deepEqual(f.calls.find((c) => c.method === "respond")?.choices, []);
		assert.equal(f.client.cooldowns.size, 0);
	});
}

test("routing: per-guild custom metadata and command permissions are checked for context menus", async (t) => {
	const f = fixture(t, { kind: "user" });
	f.command.guildIds = [GUILD, OTHER_GUILD];
	f.command.guildData = { [GUILD]: { ...f.command.data, default_member_permissions: PermissionFlagsBits.ManageGuild.toString() }, [OTHER_GUILD]: f.command.data };
	await f.run();
	assert.equal(count(f, "execute"), 0);
	const authorized = f.makeInteraction({ bits: PermissionFlagsBits.Administrator });
	await f.run(authorized);
	assert.equal(count(f, "execute"), 1);
});

test("routing: explicit command permissions are enforced using real Discord bitfields", async (t) => {
	const f = fixture(t);
	f.command.permissions = [PermissionFlagsBits.ManageMessages];
	await f.run();
	assert.equal(count(f, "execute"), 0);
	await f.run(f.makeInteraction({ bits: PermissionFlagsBits.ManageMessages }));
	assert.equal(count(f, "execute"), 1);
});

test("routing: REST member role arrays pass matching dashboard role restrictions", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	f.setConfig({ data: { _commands: { run: { allowedRoles: [ROLE] } } } });
	f.interaction.member.roles = [ROLE];
	await f.run();
	assert.equal(count(f, "execute"), 1);
});

test("routing: denied invocations never charge cooldown before a later authorized invocation", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	f.command.cooldown = 30;
	f.setConfig({ data: { _commands: { run: { enabled: false } } } });
	await f.run();
	assert.equal(f.client.cooldowns.size, 0);
	f.setConfig({ data: { _commands: { run: { enabled: true } } } });
	await f.run(f.makeInteraction());
	await f.run(f.makeInteraction());
	assert.equal(count(f, "execute"), 1);
});

test("routing: permission storage errors fail closed and produce an error response", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	t.mock.method(f.db, "getPluginConfig", async () => { throw new Error("fake DB down"); });
	await f.run();
	await f.run(f.makeInteraction({ kind: "autocomplete" }));
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "autocomplete"), 0);
	assert.equal(count(f, "reply"), 1);
	assert.deepEqual(f.calls.find((call) => call.method === "respond")?.choices, []);
});

test("routing: slow permission lookup expires before Discord's acknowledgement deadline", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	let resolveLookup;
	t.mock.method(f.db, "getPluginConfig", () => new Promise((resolve) => { resolveLookup = resolve; }));
	const pending = f.run();
	await flush();
	t.mock.timers.tick(2500);
	await flush();
	resolveLookup({ data: {} });
	await pending;
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "reply"), 1);
});

test("routing: a permission-granted command may open a modal without automatic deferral", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	f.command.execute = async (interaction) => interaction.showModal({ custom_id: "runtime-modal" });
	await f.run();
	assert.equal(count(f, "deferReply"), 0);
	assert.equal(count(f, "showModal"), 1);
});

test("routing: beforeCommand exceptions are handled and pending defers are completed with editReply", async (t) => {
	const f = fixture(t);
	f.client.hooks.emitHook = async (_name, { interaction }) => {
		await interaction.deferReply({ flags: 64 });
		throw new Error("fake hook failure");
	};
	await assert.doesNotReject(() => f.run());
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "editReply"), 1);
	assert.equal(count(f, "followUp"), 0);
});

test("routing: command errors complete the deferred original reply", async (t) => {
	const f = fixture(t);
	f.command.execute = async (interaction) => { await interaction.deferReply({ flags: 64 }); throw new Error("fake command failure"); };
	await f.run();
	assert.equal(count(f, "editReply"), 1);
	assert.equal(count(f, "followUp"), 0);
});

test("routing: hook cancellation is acknowledged without dispatch or cooldown", async (t) => {
	const f = fixture(t);
	f.command.cooldown = 30;
	f.client.hooks.emitHook = async (_name, payload) => ({ cancelled: true, payload });
	await f.run();
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "reply"), 1);
	assert.equal(f.client.cooldowns.size, 0);
});

test("routing: replacement or revocation while awaiting hooks cannot dispatch stale commands", async (t) => {
	const f = fixture(t);
	f.client.hooks.emitHook = async (_name, payload) => {
		f.command.guildIds = [];
		return { cancelled: false, payload };
	};
	await f.run();
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "reply"), 1);
});

test("routing: autocomplete failures and missing callbacks respond with empty choices", async (t) => {
	const f = fixture(t, { kind: "autocomplete" });
	f.command.autocomplete = async () => { throw new Error("fake autocomplete failure"); };
	await f.run();
	delete f.command.autocomplete;
	await f.run(f.makeInteraction());
	assert.deepEqual(f.calls.filter((call) => call.method === "respond").map((call) => call.choices), [[], []]);
});

test("tickets: forged close modals cannot mutate or delete a ticket for unrelated members", async (t) => {
	const f = fixture(t, { kind: "modal" });
	f.interaction.customId = `close_ticket_modal_${TICKET}`;
	await f.run();
	t.mock.timers.tick(30000);
	await flush();
	assert.equal(count(f, "updateTicket"), 0);
	assert.equal(count(f, "channel.delete"), 0);
	assert.equal(f.tickets.get(TICKET).status, "open");
});

for (const mismatch of ["guild", "channel", "physical channel"]) {
	test(`tickets: ${mismatch} mismatch is rejected at modal opening and submission`, async (t) => {
		const f = fixture(t, { kind: "button", bits: PermissionFlagsBits.Administrator });
		if (mismatch === "guild") f.tickets.get(TICKET).guildId = OTHER_GUILD;
		if (mismatch === "channel") f.tickets.get(TICKET).channelId = "200000000000000002";
		for (const kind of ["button", "modal"]) {
			const input = f.makeInteraction({ kind, customId: `${kind === "button" ? "ticket_close_" : "close_ticket_modal_"}${TICKET}` });
			if (mismatch === "physical channel") input.channel.id = "200000000000000002";
			await f.run(input);
		}
		t.mock.timers.tick(30000);
		await flush();
		assert.equal(count(f, "showModal"), 0);
		assert.equal(count(f, "updateTicket"), 0);
		assert.equal(count(f, "channel.delete"), 0);
	});
}

test("tickets: missing persisted tickets are reported without dereferencing userId", async (t) => {
	const f = fixture(t, { kind: "button" });
	f.tickets.clear();
	f.interaction.customId = `ticket_close_${TICKET}`;
	await f.run();
	assert.equal(count(f, "showModal"), 0);
	assert.match(replies(f).at(-1)?.payload.content || "", /not found/i);
});

test("tickets: creators can open the existing close modal and submit it without moderator permissions", async (t) => {
	const f = fixture(t, { kind: "button", userId: CREATOR });
	f.interaction.customId = `ticket_close_${TICKET}`;
	await f.run();
	assert.equal(count(f, "deferReply"), 0, "close button must remain able to show a modal");
	assert.equal(count(f, "showModal"), 1);
	await f.run(f.makeInteraction({ kind: "modal", customId: `close_ticket_modal_${TICKET}` }));
	assert.equal(f.tickets.get(TICKET).status, "closed");
	t.mock.timers.tick(30000);
	await flush();
	assert.equal(count(f, "channel.delete"), 1);
});

test("tickets: permissions are rechecked when a previously authorized modal is submitted", async (t) => {
	const f = fixture(t, { kind: "button", bits: PermissionFlagsBits.ManageMessages });
	f.interaction.customId = `ticket_close_${TICKET}`;
	await f.run();
	assert.equal(count(f, "showModal"), 1);
	await f.run(f.makeInteraction({ kind: "modal", bits: 0n, customId: `close_ticket_modal_${TICKET}` }));
	assert.equal(count(f, "updateTicket"), 0);
});

test("tickets: reopening a ticket before the delete timer fires preserves its channel", async (t) => {
	const f = fixture(t, { kind: "modal", userId: CREATOR });
	f.interaction.customId = `close_ticket_modal_${TICKET}`;
	await f.run();
	f.tickets.get(TICKET).status = "open";
	t.mock.timers.tick(30000);
	await flush();
	assert.equal(count(f, "channel.delete"), 0);
});

test("tickets: claim and emitted unclaim controls update the same persisted ticket", async (t) => {
	const f = fixture(t, { kind: "button", bits: PermissionFlagsBits.ManageMessages });
	f.interaction.message.embeds = [];
	await f.run();
	assert.equal(f.tickets.get(TICKET).moderatorId, USER);
	assert.equal(f.tickets.get(TICKET).status, "in_progress");
	assert.ok(count(f, "deferReply") > 0, "non-modal action acknowledges before storage work");
	assert.ok(count(f, "message.edit") > 0, "ticket controls are refreshed");
	await f.run(f.makeInteraction({ kind: "button", customId: `ticket_unclaim_${TICKET}` }));
	assert.equal(f.tickets.get(TICKET).moderatorId, null);
	assert.equal(f.tickets.get(TICKET).status, "open");
});

test("tickets: priority selector is handled, validated and persisted with moderator authorization", async (t) => {
	const f = fixture(t, { kind: "button", bits: PermissionFlagsBits.ManageMessages });
	f.interaction.customId = `ticket_priority_${TICKET}`;
	await f.run();
	const row = replies(f).at(-1)?.payload.components?.[0]?.toJSON();
	assert.equal(row?.components[0].custom_id, `priority_select_${TICKET}`);
	await f.run(f.makeInteraction({ kind: "select", customId: `priority_select_${TICKET}`, values: ["high"] }));
	assert.equal(f.tickets.get(TICKET).priority, "high");
	assert.equal(count(f, "updateTicket"), 1);
	await f.run(f.makeInteraction({ kind: "select", customId: `priority_select_${TICKET}`, values: ["invalid"] }));
	assert.equal(count(f, "updateTicket"), 1);
	await f.run(f.makeInteraction({ kind: "select", customId: `priority_select_${TICKET}`, bits: 0n, values: ["low"] }));
	assert.equal(count(f, "updateTicket"), 1);
});

for (const action of ["claim", "unclaim", "priority"]) {
	test(`tickets: ${action} rejects creator-only access and foreign-channel ticket IDs`, async (t) => {
		const f = fixture(t, { kind: "button", userId: CREATOR });
		f.interaction.customId = `ticket_${action}_${TICKET}`;
		await f.run();
		f.tickets.get(TICKET).channelId = "200000000000000002";
		await f.run(f.makeInteraction({ bits: PermissionFlagsBits.Administrator, customId: f.interaction.customId }));
		assert.equal(count(f, "updateTicket"), 0);
	});
}

test("tickets: closed tickets cannot be claimed or closed again", async (t) => {
	const f = fixture(t, { kind: "button", bits: PermissionFlagsBits.Administrator });
	f.tickets.get(TICKET).status = "closed";
	await f.run();
	await f.run(f.makeInteraction({ kind: "modal", customId: `close_ticket_modal_${TICKET}` }));
	assert.equal(count(f, "updateTicket"), 0);
});

test("tickets: connection and update errors are caught and deferred replies are completed", async (t) => {
	const f = fixture(t, { kind: "button", bits: PermissionFlagsBits.Administrator });
	t.mock.method(Database, "getInstance", async () => { throw new Error("fake connection failure"); });
	await assert.doesNotReject(() => f.run());
	assert.equal(count(f, "updateTicket"), 0);
	assert.equal(count(f, "editReply"), 1);
});

test("moderation: REST bitfields and role arrays are supported, not promises or malformed permission objects", (t) => {
	const f = fixture(t);
	const apiMember = { user: { id: USER }, permissions: PermissionFlagsBits.ManageMessages.toString(), roles: [] };
	assert.equal(moderation.isModeratorOrOwner(apiMember, f.interaction.guild), true);
	assert.equal(moderation.isModeratorOrOwner({ user: { id: OWNER }, roles: [] }, f.interaction.guild), true);
	assert.equal(moderation.isModeratorOrOwner({ permissions: { async has() { return false; } }, roles: [] }, f.interaction.guild), false);
	assert.equal(moderation.isModeratorOrOwner({ roles: [] }, f.interaction.guild), false);
});

test("routing: malformed persisted command restrictions fail closed", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	for (const restrictions of [{ enabled: "false" }, { allowedRoles: "everyone" }]) {
		f.setConfig({ data: { _commands: { run: restrictions } } });
		await f.run(f.makeInteraction());
	}
	assert.equal(count(f, "execute"), 0);
	assert.equal(replies(f).length, 2);
});

test("routing: concurrent authorized context commands share cooldowns only within their guild", async (t) => {
	const f = fixture(t, { kind: "message", commandPermissions: true });
	f.command.cooldown = 10;
	f.command.guildIds = [GUILD, OTHER_GUILD];
	await Promise.all([f.run(), f.run(f.makeInteraction())]);
	assert.equal(count(f, "execute"), 1);
	const other = f.makeInteraction();
	other.guildId = OTHER_GUILD;
	other.guild.id = OTHER_GUILD;
	await f.run(other);
	assert.equal(count(f, "execute"), 2);
	t.mock.timers.tick(10000);
	await f.run(f.makeInteraction());
	assert.equal(count(f, "execute"), 3);
});

test("routing: hooks cannot substitute another command after permission checks", async (t) => {
	const f = fixture(t);
	let unchecked = 0;
	f.client.hooks.emitHook = async (_name, payload) => ({ cancelled: false, payload: { ...payload, command: { ...f.command, execute() { unchecked++; } } } });
	await f.run();
	assert.equal(unchecked, 0);
	assert.equal(count(f, "execute"), 0);
	assert.equal(replies(f).length, 1);
});

test("tickets: a reopened and reclosed ticket is not deleted by the previous closure timer", async (t) => {
	const f = fixture(t, { kind: "modal", userId: CREATOR });
	f.interaction.customId = `close_ticket_modal_${TICKET}`;
	await f.run();
	t.mock.timers.tick(10000);
	f.tickets.get(TICKET).closedAt = new Date().toISOString();
	t.mock.timers.tick(20000);
	await flush();
	assert.equal(count(f, "channel.delete"), 0);
});

test("tickets: failed persistence and failed message edits do not leave deferred replies loading", async (t) => {
	const f = fixture(t, { kind: "button", bits: PermissionFlagsBits.ManageMessages });
	const originalUpdate = f.db.updateTicket;
	f.db.updateTicket = async () => { throw new Error("fake update failure"); };
	await f.run();
	assert.equal(count(f, "editReply"), 1);
	f.db.updateTicket = originalUpdate;
	const second = f.makeInteraction();
	second.message.edit = async () => { throw new Error("fake message edit failure"); };
	await f.run(second);
	assert.equal(count(f, "editReply"), 2);
	assert.equal(count(f, "followUp"), 0);
});

test("tickets: priority actions recheck guild scope even for moderators", async (t) => {
	const f = fixture(t, { kind: "select", bits: PermissionFlagsBits.Administrator });
	f.tickets.get(TICKET).guildId = OTHER_GUILD;
	f.interaction.customId = `priority_select_${TICKET}`;
	await f.run();
	assert.equal(count(f, "updateTicket"), 0);
	assert.equal(count(f, "editReply"), 1);
});

test("moderation: missing identities are not owners, and existing named moderator roles still work", (t) => {
	const f = fixture(t);
	assert.equal(moderation.isModeratorOrOwner({ roles: [] }, {}), false);
	f.interaction.guild.roles.cache.get(ROLE).name = "Support Team";
	assert.equal(moderation.isModeratorOrOwner({ user: { id: USER }, permissions: "0", roles: [ROLE] }, f.interaction.guild), true);
});

test("routing: a missing per-guild definition cannot fall back to another guild's command", async (t) => {
	const f = fixture(t);
	f.command.guildIds = [GUILD, OTHER_GUILD];
	f.command.guildData = { [OTHER_GUILD]: f.command.data };
	await f.run();
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "reply"), 1);
});

test("routing: per-guild builders serialize before type and permission checks", async (t) => {
	const f = fixture(t, { kind: "user", bits: PermissionFlagsBits.ManageGuild });
	f.command.guildIds = [GUILD];
	f.command.guildData = { [GUILD]: { toJSON: () => ({ name: "run", type: 2, default_member_permissions: PermissionFlagsBits.ManageGuild.toString() }) } };
	await f.run();
	assert.equal(count(f, "execute"), 1);
});

test("routing: still-loading plugin state cannot dispatch partially registered commands", async (t) => {
	const f = fixture(t);
	f.state.loaded = false;
	await f.run();
	assert.equal(count(f, "execute"), 0);
	assert.equal(count(f, "reply"), 1);
});

test("routing: real PluginManager ownership integrates with all application command types and autocomplete", async (t) => {
	const f = fixture(t, { commandPermissions: true });
	const { PluginManager } = require("../core/PluginManager");
	const manager = new PluginManager({ client: f.client, db: f.db, scheduler: {}, hooks: f.client.hooks });
	f.client.pluginManager = manager;
	const state = manager.initPluginState("real-owner", f.state.manifest);
	state.loaded = true;
	manager.plugins.set("real-owner", state);
	manager.registerCommand("real-owner", f.command);
	manager.plugins.set("stale-owner", { ...manager.initPluginState("stale-owner", {}), commandNames: new Set(["run"]), enabled: false });
	for (const [kind, type] of [["chat", 1], ["user", 2], ["message", 3], ["autocomplete", 1]]) {
		f.command.data.type = type;
		await f.run(f.makeInteraction({ kind }));
	}
	assert.equal(count(f, "execute"), 3);
	assert.equal(count(f, "autocomplete"), 1);
	assert.ok(f.calls.filter((call) => call.method === "getPluginConfig").every((call) => call.name === "real-owner"));
	state.loaded = false;
	await f.run(f.makeInteraction());
	assert.equal(count(f, "execute"), 3);
});
