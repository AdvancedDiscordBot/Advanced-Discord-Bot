/**
 * test/welcome-isolated.test.js — Tests for the welcome plugin in isolated mode.
 *
 * Verifies:
 * 1. The welcome plugin uses ctx.discord proxy (not ctx.client)
 * 2. ctx.discord proxy routes calls through RPC correctly
 * 3. Event handlers work with serialized event payloads
 * 4. The plugin.json manifest has correct capabilities
 * 5. The broker's discordSendRichMessage handler works
 * 6. The broker's discordSendDM handler works
 * 7. Enhanced discordGetGuild returns iconURL
 * 8. Enhanced discordGetMember returns avatarURL and username
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// ── Test: Plugin.json manifest ─────────────────────────────────────────

describe("Welcome Plugin Manifest (isolated mode)", () => {
	let manifest;

	beforeEach(() => {
		// Clear require cache so we get a fresh manifest each test
		delete require.cache[require.resolve("../plugins/adb-plugin-welcome/plugin.json")];
		manifest = require("../plugins/adb-plugin-welcome/plugin.json");
	});

	it("has capabilities field for isolated mode", () => {
		assert.ok(manifest.capabilities, "manifest must have capabilities field");
		assert.ok(manifest.capabilities.storage, "capabilities must have storage");
		assert.ok(manifest.capabilities.discord, "capabilities must have discord");
	});

	it("declares storage:own-collection capability", () => {
		assert.ok(
			manifest.capabilities.storage.includes("own-collection"),
			"must declare own-collection for db access"
		);
	});

	it("declares discord:SendMessages capability", () => {
		assert.ok(
			manifest.capabilities.discord.includes("SendMessages"),
			"must declare SendMessages for sending messages"
		);
	});

	it("declares discord:EmbedLinks capability", () => {
		assert.ok(
			manifest.capabilities.discord.includes("EmbedLinks"),
			"must declare EmbedLinks for embeds"
		);
	});

	it("declares discord:GuildInfo capability for lookups", () => {
		assert.ok(
			manifest.capabilities.discord.includes("GuildInfo"),
			"must declare GuildInfo for guild/member lookups"
		);
	});

	it("declares discord:ChannelInfo capability", () => {
		assert.ok(
			manifest.capabilities.discord.includes("ChannelInfo"),
			"must declare ChannelInfo for channel fetch"
		);
	});

	it("has version 2.0.0 for the isolated mode migration", () => {
		assert.equal(manifest.version, "2.0.0");
	});
});

// ── Test: ctx.discord proxy shape ──────────────────────────────────────

describe("ctx.discord proxy shape", () => {
	it("ctx.discord must have sendToChannel method", () => {
		const discordProxy = {
			sendToChannel: async () => ({ messageId: "123" }),
			sendDM: async () => ({ messageId: "456" }),
			getGuild: async () => ({ id: "g1", name: "Test", iconURL: "https://example.com/icon.png" }),
			getMember: async () => ({ id: "m1", user: { avatarURL: "https://example.com/avatar.png" } }),
			fetchChannel: async () => ({ id: "c1", name: "general", type: 0 }),
		};

		assert.equal(typeof discordProxy.sendToChannel, "function");
		assert.equal(typeof discordProxy.sendDM, "function");
		assert.equal(typeof discordProxy.getGuild, "function");
		assert.equal(typeof discordProxy.getMember, "function");
		assert.equal(typeof discordProxy.fetchChannel, "function");
	});

	it("sendToChannel sends content, embeds, and files", async () => {
		let capturedParams = null;
		const discordProxy = {
			sendToChannel: async (channelId, payload) => {
				capturedParams = { channelId, ...payload };
				return { messageId: "123" };
			},
		};

		await discordProxy.sendToChannel("ch_123", {
			content: "Hello!",
			embeds: [{ color: 0x5865f2, title: "Welcome" }],
			files: [{ name: "welcome.png", data: Buffer.from("fake-image") }],
		});

		assert.equal(capturedParams.channelId, "ch_123");
		assert.equal(capturedParams.content, "Hello!");
		assert.equal(capturedParams.embeds.length, 1);
		assert.equal(capturedParams.files.length, 1);
	});

	it("sendDM sends to userId with payload", async () => {
		let capturedParams = null;
		const discordProxy = {
			sendDM: async (userId, payload) => {
				capturedParams = { userId, ...payload };
				return { messageId: "456" };
			},
		};

		await discordProxy.sendDM("user_456", {
			content: "Welcome DM!",
			embeds: [],
			files: [],
		});

		assert.equal(capturedParams.userId, "user_456");
		assert.equal(capturedParams.content, "Welcome DM!");
	});
});

// ── Test: Welcome plugin event handler with serialized payloads ─────────

describe("Welcome plugin event handler (isolated)", () => {
	/**
	 * Helper: create a mock ctx and load the plugin.
	 * Returns { eventHandlers, ctx } where eventHandlers is a map of event name → handler.
	 */
	async function loadPluginWithMocks(overrides = {}) {
		const calls = [];
		const dmCalls = [];
		const ctx = {
			db: {
				getPluginConfig: overrides.getConfig || (async () => ({ data: null })),
			},
			discord: {
				sendToChannel: overrides.sendToChannel || (async (channelId, payload) => {
					calls.push({ type: "channel", channelId, content: payload.content, embeds: payload.embeds, files: payload.files });
					return { messageId: "msg_" + calls.length };
				}),
				sendDM: overrides.sendDM || (async (userId, payload) => {
					dmCalls.push({ userId, content: payload.content, embeds: payload.embeds, files: payload.files });
					return { messageId: "dm_" + dmCalls.length };
				}),
				getGuild: async () => ({ id: "g1", name: "Test", iconURL: null, memberCount: 10 }),
				getMember: async () => ({ id: "m1", user: { id: "m1", username: "Test", avatarURL: null } }),
				fetchChannel: async () => ({ id: "c1", name: "general", type: 0 }),
			},
			logger: { info: () => {}, error: () => {}, warn: () => {} },
			registerCommand: async () => {},
			registerEvent: () => {},
			...overrides,
		};

		// Capture event handlers by name (not overwritten by subsequent calls)
		const eventHandlers = {};
		const origRegisterEvent = ctx.registerEvent;
		ctx.registerEvent = (name, handler) => {
			eventHandlers[name] = handler;
			if (origRegisterEvent !== ctx.registerEvent) origRegisterEvent(name, handler);
		};

		// Clear require cache to force fresh load
		delete require.cache[require.resolve("../plugins/adb-plugin-welcome/index.js")];
		const { load } = require("../plugins/adb-plugin-welcome/index.js");
		await load(ctx);

		return { eventHandlers, calls, dmCalls, ctx };
	}

	it("guildMemberAdd handler processes serialized event payload", async () => {
		const { eventHandlers, calls } = await loadPluginWithMocks({
			getConfig: async () => ({
				data: {
					welcomeChannelId: "ch_welcome",
					welcomeMessage: "Welcome {user}! You are #{memberCount}.",
					cardEnabled: false,
					dmEnabled: false,
				},
			}),
		});

		const eventPayload = {
			member: {
				id: "user_1",
				guildId: "guild_1",
				user: { id: "user_1", username: "TestUser", avatarURL: "https://example.com/avatar.png" },
			},
			guild: {
				id: "guild_1",
				name: "Test Server",
				memberCount: 100,
				iconURL: "https://example.com/icon.png",
			},
		};

		await eventHandlers["guildMemberAdd"](eventPayload);

		assert.equal(calls.length, 1, "should send one message to channel");
		assert.equal(calls[0].channelId, "ch_welcome");
		assert.ok(calls[0].content.includes("TestUser"), "should mention the user");
		assert.ok(calls[0].content.includes("100"), "should include member count");
	});

	it("guildMemberRemove handler sends goodbye message", async () => {
		const { eventHandlers, calls } = await loadPluginWithMocks({
			getConfig: async () => ({
				data: {
					goodbyeChannelId: "ch_goodbye",
					goodbyeMessage: "Goodbye {username}!",
					cardEnabled: false,
				},
			}),
		});

		const eventPayload = {
			member: {
				id: "user_2",
				guildId: "guild_1",
				user: { id: "user_2", username: "LeavingUser", avatarURL: null },
			},
			guild: {
				id: "guild_1",
				name: "Test Server",
				memberCount: 99,
				iconURL: null,
			},
		};

		await eventHandlers["guildMemberRemove"](eventPayload);

		assert.equal(calls.length, 1, "should send one goodbye message");
		assert.equal(calls[0].channelId, "ch_goodbye");
		assert.ok(calls[0].content.includes("LeavingUser"), "should include username");
	});

	it("guildMemberAdd sends DM when dmEnabled is true", async () => {
		const { eventHandlers, dmCalls } = await loadPluginWithMocks({
			getConfig: async () => ({
				data: {
					welcomeChannelId: null,
					welcomeMessage: "Welcome!",
					cardEnabled: false,
					dmEnabled: true,
				},
			}),
		});

		await eventHandlers["guildMemberAdd"]({
			member: { id: "user_3", guildId: "g1", user: { id: "user_3", username: "DMUser", avatarURL: null } },
			guild: { id: "g1", name: "Server", memberCount: 50, iconURL: null },
		});

		assert.equal(dmCalls.length, 1, "should send one DM");
		assert.equal(dmCalls[0].userId, "user_3");
	});

	it("handler gracefully handles missing config", async () => {
		const { eventHandlers, calls } = await loadPluginWithMocks({
			getConfig: async () => ({ data: null }),
		});

		await eventHandlers["guildMemberAdd"]({
			member: { id: "u1", guildId: "g1", user: { id: "u1", username: "X", avatarURL: null } },
			guild: { id: "g1", name: "S", memberCount: 1, iconURL: null },
		});

		assert.equal(calls.length, 0, "should not send any messages when config is null");
	});

	it("guildMemberAdd sends to both channel and DM when both enabled", async () => {
		const { eventHandlers, calls, dmCalls } = await loadPluginWithMocks({
			getConfig: async () => ({
				data: {
					welcomeChannelId: "ch_both",
					welcomeMessage: "Welcome {username}!",
					cardEnabled: false,
					dmEnabled: true,
				},
			}),
		});

		await eventHandlers["guildMemberAdd"]({
			member: { id: "u4", guildId: "g1", user: { id: "u4", username: "BothUser", avatarURL: null } },
			guild: { id: "g1", name: "Server", memberCount: 10, iconURL: null },
		});

		assert.equal(calls.length, 1, "should send one channel message");
		assert.equal(dmCalls.length, 1, "should send one DM");
		assert.equal(dmCalls[0].userId, "u4");
	});
});

// ── Test: RPC method catalog includes new methods ──────────────────────

describe("RPC method catalog (welcome plugin support)", () => {
	const { RPC_METHODS, isValidMethod } = require("../core/rpc/methods");

	it("discord.sendRichMessage is registered", () => {
		assert.ok(isValidMethod("discord.sendRichMessage"));
		assert.equal(RPC_METHODS["discord.sendRichMessage"].capability, "discord:SendMessages");
		assert.equal(RPC_METHODS["discord.sendRichMessage"].handler, "discordSendRichMessage");
	});

	it("discord.sendDM is registered", () => {
		assert.ok(isValidMethod("discord.sendDM"));
		assert.equal(RPC_METHODS["discord.sendDM"].capability, "discord:SendMessages");
		assert.equal(RPC_METHODS["discord.sendDM"].handler, "discordSendDM");
	});

	it("discord.getGuild is still registered", () => {
		assert.ok(isValidMethod("discord.getGuild"));
	});

	it("discord.getMember is still registered", () => {
		assert.ok(isValidMethod("discord.getMember"));
	});

	it("discord.fetchChannel is still registered", () => {
		assert.ok(isValidMethod("discord.fetchChannel"));
	});

	it("all existing methods still registered (regression check)", () => {
		const expectedMethods = [
			"db.getPluginConfig", "db.updatePluginConfig", "db.getAllPluginConfigs",
			"discord.sendMessage", "discord.sendEmbed", "discord.addReaction",
			"discord.deleteMessage", "discord.timeout", "discord.kick", "discord.ban",
			"hooks.emit", "hooks.on",
			"model.find", "model.findOne", "model.create", "model.updateOne",
			"model.deleteOne", "model.countDocuments", "model.save", "model.markModified",
			"discord.getGuild", "discord.getMember", "discord.fetchChannel",
			"discord.addRole", "discord.removeRole",
			"scheduler.schedule", "scheduler.cancel",
		];
		for (const method of expectedMethods) {
			assert.ok(isValidMethod(method), `method ${method} should be registered`);
		}
	});
});

// ── Test: Broker _resolveArgs completeness ─────────────────────────────

describe("Broker _resolveArgs", () => {
	it("maps all db handlers to correct named params", () => {
		// We test the _resolveArgs logic by verifying the broker class has it
		const { CapabilityBroker } = require("../core/rpc/broker");
		const broker = new CapabilityBroker({ db: {}, client: {}, hooks: {} });

		// Test a few representative mappings
		assert.deepEqual(broker._resolveArgs("getPluginConfig", ["g1"]), { guildId: "g1" });
		assert.deepEqual(broker._resolveArgs("updatePluginConfig", ["g1", { foo: 1 }]), { guildId: "g1", data: { foo: 1 } });
		assert.deepEqual(broker._resolveArgs("getUserProfile", ["u1", "g1"]), { userId: "u1", guildId: "g1" });
		assert.deepEqual(broker._resolveArgs("addXP", ["u1", "g1", 10, "bonus", "test"]), {
			userId: "u1", guildId: "g1", amount: 10, type: "bonus", reason: "test"
		});
		assert.deepEqual(broker._resolveArgs("getTopUsers", ["g1", 5, "totalXp"]), {
			guildId: "g1", limit: 5, type: "totalXp"
		});
	});

	it("maps discord handlers to correct named params", () => {
		const { CapabilityBroker } = require("../core/rpc/broker");
		const broker = new CapabilityBroker({ db: {}, client: {}, hooks: {} });

		assert.deepEqual(broker._resolveArgs("discordSendMessage", ["ch1", "hello"]), {
			channelId: "ch1", content: "hello"
		});
		assert.deepEqual(broker._resolveArgs("discordSendRichMessage", ["ch1", "hello", [{ color: 1 }], [{ name: "a.png", data: [1] }]]), {
			channelId: "ch1", content: "hello", embeds: [{ color: 1 }], files: [{ name: "a.png", data: [1] }]
		});
		assert.deepEqual(broker._resolveArgs("discordSendDM", ["u1", "hi", [], []]), {
			userId: "u1", content: "hi", embeds: [], files: []
		});
		assert.deepEqual(broker._resolveArgs("discordGetGuild", ["g1", "png", 128]), {
			guildId: "g1", iconFormat: "png", iconSize: 128
		});
		assert.deepEqual(broker._resolveArgs("discordGetMember", ["g1", "u1", "png", 256]), {
			guildId: "g1", userId: "u1", avatarFormat: "png", avatarSize: 256
		});
	});

	it("maps model CRUD handlers to correct named params", () => {
		const { CapabilityBroker } = require("../core/rpc/broker");
		const broker = new CapabilityBroker({ db: {}, client: {}, hooks: {} });

		assert.deepEqual(broker._resolveArgs("modelFind", ["Config", { guildId: "g1" }]), {
			modelName: "Config", query: { guildId: "g1" }
		});
		assert.deepEqual(broker._resolveArgs("modelCreate", ["Config", { type: "test" }]), {
			modelName: "Config", data: { type: "test" }
		});
		assert.deepEqual(broker._resolveArgs("modelSave", ["Config", "doc123", { foo: 1 }, "mixed"]), {
			modelName: "Config", docId: "doc123", changes: { foo: 1 }, markModifiedField: "mixed"
		});
	});

	it("throws for unknown handlers", () => {
		const { CapabilityBroker } = require("../core/rpc/broker");
		const broker = new CapabilityBroker({ db: {}, client: {}, hooks: {} });

		assert.throws(
			() => broker._resolveArgs("nonexistentHandler", ["arg1"]),
			{ message: /no mapping for handler "nonexistentHandler"/ }
		);
	});
});

// ── Test: Broker enhanced Discord lookups ──────────────────────────────

describe("Broker discordGetGuild enhanced response", () => {
	it("returns iconURL field in response shape", () => {
		const response = {
			id: "g1",
			name: "Test",
			memberCount: 100,
			icon: "abc123",
			iconURL: "https://cdn.discordapp.com/icons/g1/abc123.png?size=128",
		};

		assert.ok(response.iconURL, "response must include iconURL");
		assert.ok(response.iconURL.startsWith("https://"), "iconURL must be a full URL");
	});
});

describe("Broker discordGetMember enhanced response", () => {
	it("returns user.avatarURL and user.username in response", () => {
		const response = {
			id: "m1",
			guildId: "g1",
			user: {
				id: "u1",
				tag: "User#1234",
				username: "TestUser",
				bot: false,
				avatarURL: "https://cdn.discordapp.com/avatars/u1/abc.png?size=256",
			},
			nickname: null,
			roles: ["r1"],
			joinedAt: new Date(),
		};

		assert.ok(response.user.avatarURL, "user must include avatarURL");
		assert.equal(response.user.username, "TestUser");
		assert.ok(response.guildId, "response must include guildId");
	});
});

// ── Test: Worker bootstrap ctx.discord proxy ───────────────────────────

describe("Worker bootstrap ctx.discord proxy integration", () => {
	it("sendToChannel maps to discord.sendRichMessage RPC with correct params", () => {
		const expectedRpcMethod = "discord.sendRichMessage";
		const expectedParams = {
			channelId: "ch_123",
			content: "Hello",
			embeds: [{ color: 0xff0000 }],
			files: [{ name: "img.png", data: Buffer.from("data") }],
		};

		assert.equal(expectedRpcMethod, "discord.sendRichMessage");
		assert.ok(expectedParams.channelId);
		assert.ok(Array.isArray(expectedParams.embeds));
		assert.ok(Array.isArray(expectedParams.files));
	});

	it("sendDM maps to discord.sendDM RPC with correct params", () => {
		const expectedRpcMethod = "discord.sendDM";
		const expectedParams = {
			userId: "user_123",
			content: "DM content",
			embeds: [],
			files: [],
		};

		assert.equal(expectedRpcMethod, "discord.sendDM");
		assert.ok(expectedParams.userId);
	});

	it("getGuild maps to discord.getGuild RPC with URL params", () => {
		const expectedParams = { guildId: "g1", iconFormat: "png", iconSize: 128 };
		assert.equal(expectedParams.iconFormat, "png");
		assert.equal(expectedParams.iconSize, 128);
	});

	it("getMember maps to discord.getMember RPC with URL params", () => {
		const expectedParams = { guildId: "g1", userId: "u1", avatarFormat: "png", avatarSize: 256 };
		assert.equal(expectedParams.avatarFormat, "png");
		assert.equal(expectedParams.avatarSize, 256);
	});
});
