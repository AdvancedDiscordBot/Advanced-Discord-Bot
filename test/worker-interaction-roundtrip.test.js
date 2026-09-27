const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { Worker, isMainThread, workerData, parentPort } = require("node:worker_threads");
const { PluginManager } = require("../core/PluginManager");
const { HookBus } = require("../core/HookBus");
const { CapabilityBroker } = require("../core/rpc/broker");
const { RpcClient } = require("../core/rpc/worker-client");

// The same file is a plugin fixture in the real bootstrap worker, not a mock RPC client.
module.exports.load = (ctx) => {
	ctx.registerCommand({
		data: { name: "roundtrip", description: "Interaction transport regression" },
		cooldown: 17,
		async execute(interaction) {
			const mode = interaction.options.getString("mode");
			if (mode === "hang") return new Promise(() => {});
			if (mode === "modal") {
				const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
				await interaction.showModal(new ModalBuilder().setCustomId("owned-modal").setTitle("Edit")
					.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
						.setCustomId("text").setLabel("Text").setStyle(TextInputStyle.Short))));
				assert.equal(interaction.replied, true);
				return;
			}
			if (mode === "options") {
				return interaction.reply({
					content: JSON.stringify({
						group: interaction.options.getSubcommandGroup(),
						sub: interaction.options.getSubcommand(),
						text: interaction.options.getString("text", true),
						number: interaction.options.getNumber("number"),
						integer: interaction.options.getInteger("integer"),
						boolean: interaction.options.getBoolean("boolean"),
						user: interaction.options.getUser("user").id,
						member: interaction.options.getMember("user").id,
						role: interaction.options.getRole("role").id,
						channel: interaction.options.getChannel("channel").id,
						attachment: interaction.options.getAttachment("attachment").id,
						missing: interaction.options.getString("missing"),
						token: interaction.token,
					}),
					ephemeral: true,
				});
			}
			const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
			if (mode === "reply") {
				await interaction.reply({ content: "private", ephemeral: true });
				assert.equal(interaction.replied, true);
				assert.equal(interaction.deferred, false);
			} else {
				await interaction.deferReply({ flags: 64 });
				assert.equal(interaction.deferred, true);
				assert.equal(interaction.replied, false);
				assert.equal(interaction.ephemeral, true);
				await interaction.editReply({
					content: "edited", attachments: [], allowedMentions: { parse: [] },
					embeds: [new EmbedBuilder().setTitle("Private")],
					components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
						.setCustomId("owned-button").setLabel("Continue").setStyle(ButtonStyle.Primary))],
					files: [new AttachmentBuilder(Buffer.from("private attachment"), { name: "private.txt" })],
				});
				assert.equal(interaction.replied, true);
				await interaction.editReply("");
			}
			const followup = await interaction.followUp({ content: "followup", flags: 64 });
			assert.equal(followup.id, "followup-message");
			assert.equal(followup.token, undefined);
		},
		async autocomplete(interaction) {
			await interaction.respond([{ name: interaction.options.getFocused(), value: "match" }]);
			assert.equal(interaction.responded, true);
		},
	});
	ctx.registerEvent("interactionCreate", async (interaction) => {
		if (interaction.isModalSubmit()) {
			await interaction.reply({ content: interaction.fields.getTextInputValue("text"), flags: 64 });
		}
		if (interaction.isButton()) await interaction.update({ content: "clicked", components: [] });
	});
	ctx.registerEvent("threadUpdate", async (before, after, client) => {
		assert.equal(client, null);
		await ctx.discord.sendDM("observer", { content: `${before.name}:${after.name}` });
	});
	ctx.registerEvent("threadDelete", async () => { throw new Error("expected async event failure"); });
	ctx.registerEvent("threadDelete", async () => ctx.discord.sendDM("observer", { content: "still alive" }), { once: true });
	ctx.hooks.on("worker:clone-test", async (payload) => {
		assert.equal(payload.interaction.token, undefined);
		assert.equal(payload.interaction.client, undefined);
		await ctx.discord.sendDM("observer", { content: payload.interaction.id });
	});
};

if (!isMainThread && workerData?.rpcProbe) {
	const rpc = new RpcClient(parentPort);
	parentPort.on("message", async (msg) => {
		if (msg.type !== "probe") return;
		try {
			const result = await rpc.call(msg.method, msg.params);
			parentPort.postMessage({ type: "probe:result", result });
		} catch (error) {
			parentPort.postMessage({ type: "probe:result", error: error.message });
		}
	});
}

function fakeInteraction(mode = "reply", overrides = {}) {
	const calls = [];
	const interaction = {
		id: `interaction-${mode}`, type: 2, commandName: "roundtrip",
		guildId: "guild", channelId: "channel", user: { id: "user" },
		token: "not-for-workers", client: { secret: () => {} },
		createdTimestamp: Date.now(), deferred: false, replied: false, ephemeral: null,
		options: { data: [{ name: "mode", type: 3, value: mode }] },
		calls,
		async reply(payload) {
			if (this.deferred || this.replied) throw new Error("already acknowledged");
			calls.push(["reply", payload]);
			this.replied = true;
			this.ephemeral = payload.ephemeral === true || payload.flags === 64;
		},
		async deferReply(payload) {
			if (this.deferred || this.replied) throw new Error("already acknowledged");
			calls.push(["deferReply", payload]);
			this.deferred = true;
			this.ephemeral = payload.ephemeral === true || payload.flags === 64;
		},
		async editReply(payload) {
			if (!this.deferred && !this.replied) throw new Error("not acknowledged");
			calls.push(["editReply", payload]);
			this.replied = true;
			return { id: "original-message", interactionMetadata: { id: this.id } };
		},
		async followUp(payload) {
			if (!this.deferred && !this.replied) throw new Error("not acknowledged");
			calls.push(["followUp", payload]);
			this.replied = true;
			return { id: "followup-message", token: "also-not-for-workers" };
		},
		async showModal(payload) { calls.push(["showModal", payload]); this.replied = true; },
		async respond(payload) { calls.push(["respond", payload]); this.responded = true; },
		async update(payload) { calls.push(["update", payload]); this.replied = true; },
		...overrides,
	};
	return interaction;
}

async function fixture(t, { delayRegistration = false } = {}) {
	const client = new EventEmitter();
	client.commands = new Map();
	const publicMessages = [];
	client.channels = { fetch: async () => ({ send: async (p) => { publicMessages.push(p); return { id: "public" }; } }) };
	const dms = [];
	client.users = { fetch: async () => ({ send: async (p) => { dms.push(p); client.emit("test:dm", p); return { id: "dm" }; } }) };
	const hooks = new HookBus();
	const manager = new PluginManager({ client, db: {}, scheduler: {}, hooks, config: { commandTimeoutMs: 3000 } });
	manager.enableIsolation();
	const state = manager.initPluginState("owner", {});
	manager.plugins.set("owner", state);
	let release;
	const registrationGate = new Promise((resolve) => { release = resolve; });
	const original = manager.broker.handleRequest.bind(manager.broker);
	manager.broker.handleRequest = async (id, request) => {
		if (delayRegistration && request.method === "plugin.registerCommand") await registrationGate;
		return original(id, request);
	};
	const startup = manager.workerManager.spawnWorker("owner", __filename, { discord: ["SendMessages"], hooks: ["subscribe"] });
	t.after(async () => {
		release();
		manager.clearPluginRegistrations?.("owner");
		await manager.workerManager.shutdown();
	});
	const worker = manager.workerManager.workers.get("owner").worker;
	return { manager, client, publicMessages, dms, worker, startup, release };
}

if (isMainThread) {
	test("worker readiness waits for ignored asynchronous command registration and keeps cooldown", { timeout: 10000 }, async (t) => {
		const f = await fixture(t, { delayRegistration: true });
		const registered = once(f.worker, "message");
		await registered;
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(f.manager.workerManager.workers.get("owner").ready, false);
		f.release();
		await f.startup;
		assert.equal(f.client.commands.get("roundtrip").cooldown, 17);
	});

	test("worker replies acknowledge the original interaction without a public channel message", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		const interaction = fakeInteraction();
		await f.client.commands.get("roundtrip").execute(interaction);
		assert.deepEqual(interaction.calls, [
			["reply", { content: "private", ephemeral: true }],
			["followUp", { content: "followup", flags: 64 }],
		]);
		assert.deepEqual(f.publicMessages, []);
	});

	test("worker defer/edit preserves builders, flags, components, attachments and acknowledgement state", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		const interaction = fakeInteraction("defer");
		await f.client.commands.get("roundtrip").execute(interaction);
		assert.deepEqual(interaction.calls.map(([method]) => method), ["deferReply", "editReply", "editReply", "followUp"]);
		assert.deepEqual(interaction.calls[2][1], { content: "" });
		assert.deepEqual(interaction.calls[0][1], { flags: 64 });
		const payload = interaction.calls[1][1];
		assert.equal(payload.embeds[0].title, "Private");
		assert.equal(payload.components[0].components[0].custom_id, "owned-button");
		assert.deepEqual(payload.attachments, []);
		assert.deepEqual(payload.allowedMentions, { parse: [] });
		assert.equal(Buffer.from(payload.files[0].attachment).toString(), "private attachment");
		assert.equal(payload.files[0].name, "private.txt");
		assert.deepEqual(f.publicMessages, []);
	});

	test("worker resolves nested subcommand values and Discord entity IDs from clone-unsafe options", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		const user = { id: "target", username: "Target", toJSON() { return this; }, client: { fn() {} } };
		user.self = user;
		const interaction = fakeInteraction("options", { options: { data: [{ name: "group", type: 2, options: [
			{ name: "sub", type: 1, options: [
				{ name: "mode", type: 3, value: "options" },
				{ name: "text", type: 3, value: "nested" },
				{ name: "number", type: 10, value: 1.5 },
				{ name: "integer", type: 4, value: 0 },
				{ name: "boolean", type: 5, value: false },
				{ name: "user", type: 6, value: "target", user, member: { user, roles: ["r"] } },
				{ name: "role", type: 8, value: "role", role: { id: "role", permissions: { bitfield: 8n } } },
				{ name: "channel", type: 7, value: "channel" },
				{ name: "attachment", type: 11, value: "file", attachment: { id: "file", url: "https://example.invalid/file" } },
			] },
		] }] } });
		await f.client.commands.get("roundtrip").execute(interaction);
		assert.deepEqual(JSON.parse(interaction.calls[0][1].content), {
			group: "group", sub: "sub", text: "nested", number: 1.5, integer: 0,
			boolean: false, user: "target", member: "target", role: "role", channel: "channel",
			attachment: "file", missing: null,
		});
	});

	test("worker timeout removes all per-command listeners and revokes the interaction", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		f.manager.config.commandTimeoutMs = 50;
		const counts = ["message", "exit", "error"].map((name) => f.worker.listenerCount(name));
		const interaction = fakeInteraction("hang");
		await assert.rejects(f.client.commands.get("roundtrip").execute(interaction), /timed out/);
		assert.deepEqual(["message", "exit", "error"].map((name) => f.worker.listenerCount(name)), counts);
		assert.equal(f.manager.broker.interactions.size, 0);
	});

	test("dynamic Discord forwarding preserves argument lists and catches async rejections", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		let delivery = once(f.client, "test:dm");
		f.client.emit("threadUpdate", { name: "old" }, { name: "new" });
		await delivery;
		assert.equal(f.dms[0].content, "old:new");
		delivery = once(f.client, "test:dm");
		f.client.emit("threadDelete", { id: "thread" });
		await delivery;
		f.client.emit("threadDelete", { id: "thread" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(f.dms.filter((p) => p.content === "still alive").length, 1);
		assert.equal(f.manager.workerManager.workers.get("owner").ready, true);
	});

	test("hook forwarding sanitizes interaction tokens and cleans subscriptions on teardown", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		const delivery = once(f.client, "test:dm");
		await f.manager.hooks.emitHook("worker:clone-test", { interaction: fakeInteraction() });
		assert.equal((await delivery)[0].content, "interaction-reply");
		await f.manager.workerManager.terminateWorker("owner");
		assert.equal(f.manager.hooks.handlers.get("worker:clone-test").length, 0);
	});

	test("autocomplete and modal responses use their fixed interaction RPC methods", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		const command = f.client.commands.get("roundtrip");
		const autocomplete = fakeInteraction("auto", { type: 4, options: { data: [{ type: 3, name: "q", value: "search", focused: true }] } });
		await command.autocomplete(autocomplete);
		assert.deepEqual(autocomplete.calls, [["respond", [{ name: "search", value: "match" }]]]);
		const modal = fakeInteraction("modal");
		await command.execute(modal);
		assert.equal(modal.calls[0][0], "showModal");
		assert.equal(modal.calls[0][1].custom_id, "owned-modal");
	});

	test("only the originating plugin can reply to modal and component continuations", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		await f.client.commands.get("roundtrip").execute(fakeInteraction("modal"));
		let resolveReply;
		const replied = new Promise((resolve) => { resolveReply = resolve; });
		const modal = fakeInteraction("submit", {
			type: 5, customId: "owned-modal", fields: { fields: new Map([["text", { customId: "text", type: 4, value: "submitted" }]]) },
			async reply(payload) { this.replied = true; resolveReply(payload); },
		});
		assert.equal(f.manager.broker.interactionOwner(modal), "owner");
		assert.equal(f.manager.broker.interactionOwner({ ...modal, user: { id: "someone-else" } }), null);
		f.client.emit("interactionCreate", modal);
		assert.deepEqual(await replied, { content: "submitted", flags: 64 });
		await f.client.commands.get("roundtrip").execute(fakeInteraction("defer"));
		let resolveUpdate;
		const updated = new Promise((resolve) => { resolveUpdate = resolve; });
		const button = fakeInteraction("button", {
			type: 3, componentType: 2, customId: "owned-button", message: { id: "original-message" },
			async update(payload) { this.replied = true; resolveUpdate(payload); },
		});
		f.client.emit("interactionCreate", button);
		assert.deepEqual(await updated, { content: "clicked", components: [] });
	});

	test("worker teardown and serialization failures remove pending execution listeners", { timeout: 10000 }, async (t) => {
		const f = await fixture(t);
		await f.startup;
		const command = f.client.commands.get("roundtrip");
		const count = f.worker.listenerCount("message");
		const serialize = f.manager._serializeInteraction;
		f.manager._serializeInteraction = () => ({ bad: () => {} });
		await assert.rejects(command.execute(fakeInteraction()), /clone/);
		assert.equal(f.worker.listenerCount("message"), count);
		assert.equal(f.manager.broker.interactions.size, 0);
		f.manager._serializeInteraction = serialize;
		const pending = assert.rejects(command.execute(fakeInteraction("hang")), /stopped/);
		await f.manager.workerManager.terminateWorker("owner");
		await pending;
		assert.equal(f.worker.listenerCount("message"), 0);
		assert.equal(f.manager.broker.interactions.size, 0);
		assert.equal(f.client.listenerCount("interactionCreate"), 0);
		assert.equal(f.client.commands.size, 0);
	});

	test("modal ID collisions cannot reassign another plugin's pending interaction", async (t) => {
		const broker = new CapabilityBroker({ client: {}, db: {}, hooks: {} });
		for (const name of ["first", "second"]) broker.registerCapabilities(name, { discord: ["SendMessages"] });
		t.after(() => { broker.unregisterCapabilities("first"); broker.unregisterCapabilities("second"); });
		const first = broker.bindInteraction("first", fakeInteraction("first"));
		const second = broker.bindInteraction("second", fakeInteraction("second"));
		const send = (id, handle) => broker.handleRequest(id, { id: "modal", method: "interaction.showModal", params: { handle, payload: { custom_id: "same-modal" } } });
		assert.equal((await send("first", first)).ok, true);
		const collision = await send("second", second);
		assert.equal(collision.ok, false);
		assert.match(collision.error, /owned|use/i);
		assert.equal(broker.interactionOwner({ type: 5, customId: "same-modal", guildId: "guild", user: { id: "user" } }), "first");
	});

	test("in-flight interaction completion cannot recreate ownership after teardown", async (t) => {
		const broker = new CapabilityBroker({ client: {}, db: {}, hooks: {} });
		broker.registerCapabilities("owner", { discord: ["SendMessages"] });
		t.after(() => broker.unregisterCapabilities("owner"));
		let started;
		const invoked = new Promise((resolve) => { started = resolve; });
		let release;
		const gate = new Promise((resolve) => { release = resolve; });
		const interaction = fakeInteraction("pending", { async reply() { started(); await gate; return { id: "late-message" }; } });
		const handle = broker.bindInteraction("owner", interaction);
		const pending = broker.handleRequest("owner", { id: "pending", method: "interaction.reply", params: { handle, payload: "reply" } });
		await invoked;
		broker.unregisterCapabilities("owner");
		release();
		await pending;
		assert.equal(broker.interactions.size, 0);
		assert.equal(broker.messageOwners.size, 0);
	});

	test("interaction authorization rejects a second plugin, unknown methods, expired and torn-down handles", { timeout: 10000 }, async (t) => {
		const client = new EventEmitter();
		const broker = new CapabilityBroker({ client, db: {}, hooks: {} });
		broker.registerCapabilities("owner", { discord: ["SendMessages"] });
		broker.registerCapabilities("intruder", { discord: ["SendMessages"] });
		t.after(() => { broker.unregisterCapabilities("owner"); broker.unregisterCapabilities("intruder"); });
		const interaction = fakeInteraction();
		const handle = broker.bindInteraction("owner", interaction);
		const worker = new Worker(__filename, { workerData: { rpcProbe: true } });
		t.after(() => worker.terminate());
		let caller = "intruder";
		worker.on("message", async (message) => {
			if (message.type !== "rpc:request") return;
			worker.postMessage({ type: "rpc:response", ...await broker.handleRequest(caller, message) });
		});
		const probe = (method, params) => new Promise((resolve) => {
			const listener = (msg) => {
				if (msg.type !== "probe:result") return;
				worker.off("message", listener);
				resolve(msg);
			};
			worker.on("message", listener);
			worker.postMessage({ type: "probe", method, params });
		});
		assert.match((await probe("interaction.reply", { handle, payload: "stolen" })).error, /interaction|authorized/i);
		caller = "owner";
		assert.match((await probe("interaction.constructor", { handle })).error, /Unknown RPC method/);
		assert.match((await probe("interaction.reply", { handle, payload: { files: ["/not-an-authorized-host-file"] } })).error, /attachment|bytes/i);
		assert.equal(interaction.calls.length, 0);
		const expired = broker.bindInteraction("owner", fakeInteraction("old", { createdTimestamp: Date.now() - 16 * 60 * 1000 }));
		assert.match((await probe("interaction.reply", { handle: expired, payload: "late" })).error, /expired|interaction/i);
		broker.unregisterCapabilities("owner");
		assert.match((await probe("interaction.reply", { handle, payload: "late" })).error, /capability|interaction|registered/i);
		assert.equal(interaction.calls.length, 0);
	});
}
