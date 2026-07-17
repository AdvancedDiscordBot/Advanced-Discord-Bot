// Run with: npm test  (or) node test/local-harness.js
//
// Loads the plugin against a bot-faithful mock ctx (test/mock-ctx.js), then
// exercises each registered command with a fake interaction.

const assert = require("node:assert");
const { load } = require("../index.js");
const { createMockCtx } = require("./mock-ctx");

// Minimal fake interaction. Add the option getters / fields your command reads.
function fakeInteraction(options = {}) {
	const replies = [];
	const testUser = {
		id: "test-user-id",
		username: "testuser",
		send: async (payload) => {
			replies.push({ type: "dm", payload });
			return payload;
		},
	};

	return {
		guildId: options._guildId ?? "test-guild-id",
		user: testUser,
		member: {
			id: "test-member-id",
			user: {
				id: "test-member-id",
				username: "testusername",
				displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
			},
			guild: {
				name: "Test Guild",
				memberCount: 42,
				iconURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
			},
			permissions: {
				has: () => true, // Always has permissions for testing
			},
		},
		guild: {
			name: "Test Guild",
			memberCount: 42,
			iconURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
			channels: {
				fetch: async (id) => ({
					id,
					isTextBased: () => true,
					send: async (payload) => {
						replies.push({ type: "channel", channelId: id, payload });
						return payload;
					},
				}),
			},
		},
		options: {
			getString: (name) => options[name] ?? null,
			getInteger: (name) => options[name] ?? null,
			getUser: (name) => options[name] ?? null,
			getChannel: (name) => options[name] ?? null,
			getSubcommand: () => options._subcommand ?? null,
		},
		reply: async (payload) => {
			replies.push({ type: "reply", payload });
			return payload;
		},
		deferReply: async () => {
			replies.push({ type: "defer" });
		},
		editReply: async (payload) => {
			replies.push({ type: "editReply", payload });
			return payload;
		},
		replies,
	};
}

async function main() {
	const { ctx, registeredCommands, registeredEvents, emitEvent } = createMockCtx({
		pluginName: "adb-plugin-welcome",
	});

	// Load the plugin
	await load(ctx);

	// 1. Verify commands and events registered
	assert.ok(registeredCommands.has("welcome"), "expected /welcome to be registered");
	assert.ok(registeredEvents.has("guildMemberAdd"), "expected guildMemberAdd event to be registered");
	assert.ok(registeredEvents.has("guildMemberRemove"), "expected guildMemberRemove event to be registered");

	const welcomeCommand = registeredCommands.get("welcome");

	const getContent = (payload) => typeof payload === "string" ? payload : (payload?.content || "");

	// 2. Test /welcome channel [#channel]
	const mockChannel = { id: "123456789", isTextBased: () => true, toString: () => "<#123456789>" };
	const intChannel = fakeInteraction({ _subcommand: "channel", channel: mockChannel });
	await welcomeCommand.execute(intChannel);
	assert.ok(
		intChannel.replies.some((r) => r.payload && getContent(r.payload).includes("123456789")),
		"expected reply indicating welcome channel was set",
	);

	// 3. Test /welcome message <text>
	const intMessage = fakeInteraction({ _subcommand: "message", text: "Welcome {user} to {server}!" });
	await welcomeCommand.execute(intMessage);
	assert.ok(
		intMessage.replies.some((r) => r.payload && getContent(r.payload).includes("Welcome {user} to {server}!")),
		"expected reply confirming message update",
	);

	// 4. Test /welcome goodbye-channel [#channel]
	const intGoodbyeChannel = fakeInteraction({ _subcommand: "goodbye-channel", channel: mockChannel });
	await welcomeCommand.execute(intGoodbyeChannel);
	assert.ok(
		intGoodbyeChannel.replies.some((r) => r.payload && getContent(r.payload).includes("123456789")),
		"expected reply indicating goodbye channel was set",
	);

	// 5. Test /welcome goodbye-message <text>
	const intGoodbyeMessage = fakeInteraction({ _subcommand: "goodbye-message", text: "Goodbye {username}!" });
	await welcomeCommand.execute(intGoodbyeMessage);
	assert.ok(
		intGoodbyeMessage.replies.some((r) => r.payload && getContent(r.payload).includes("Goodbye {username}!")),
		"expected reply confirming goodbye message update",
	);

	// 6. Test /welcome dm on
	const intDm = fakeInteraction({ _subcommand: "dm", status: "on" });
	await welcomeCommand.execute(intDm);
	assert.ok(
		intDm.replies.some((r) => r.payload && getContent(r.payload).includes("ON")),
		"expected reply indicating DMs are ON",
	);

	// 7. Test /welcome card on
	const intCard = fakeInteraction({ _subcommand: "card", status: "on" });
	await welcomeCommand.execute(intCard);
	assert.ok(
		intCard.replies.some((r) => r.payload && getContent(r.payload).includes("ON")),
		"expected reply indicating card is ON",
	);

	// 8. Test /welcome preview
	const intPreview = fakeInteraction({ _subcommand: "preview" });
	await welcomeCommand.execute(intPreview);
	assert.ok(
		intPreview.replies.some((r) => r.type === "editReply" && r.payload && r.payload.embeds),
		"expected preview to return embeds",
	);

	// 9. Test /welcome test
	const intTest = fakeInteraction({ _subcommand: "test" });
	await welcomeCommand.execute(intTest);
	assert.ok(
		intTest.replies.some((r) => r.type === "editReply" && r.payload && r.payload.content.includes("Simulations")),
		"expected test simulation report in reply",
	);

	// 10. Test real event triggers (guildMemberAdd / guildMemberRemove)
	// We'll simulate a mock member object
	const mockMember = {
		id: "member-456",
		user: {
			id: "member-456",
			tag: "NewUser#0001",
			username: "NewUser",
			displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
		},
		guild: {
			id: "test-guild-id",
			name: "Test Guild",
			memberCount: 43,
			iconURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
			channels: {
				fetch: async (id) => ({
					id,
					isTextBased: () => true,
					send: async (payload) => {
						mockMember._sentPayloads.push({ type: "channel", channelId: id, payload });
						return payload;
					},
				}),
			},
		},
		send: async (payload) => {
			mockMember._sentPayloads.push({ type: "dm", payload });
			return payload;
		},
		_sentPayloads: [],
	};

	// Emit guildMemberAdd
	await emitEvent("guildMemberAdd", mockMember);

	assert.ok(
		mockMember._sentPayloads.some((p) => p.type === "channel" && p.channelId === "123456789"),
		"expected welcome message to be sent to channel",
	);
	assert.ok(
		mockMember._sentPayloads.some((p) => p.type === "dm"),
		"expected welcome message to be sent to member DM",
	);

	// Reset payloads
	mockMember._sentPayloads = [];

	// Emit guildMemberRemove
	await emitEvent("guildMemberRemove", mockMember);

	assert.ok(
		mockMember._sentPayloads.some((p) => p.type === "channel" && p.channelId === "123456789"),
		"expected goodbye message to be sent to channel",
	);

	console.log("OK: all local-harness checks passed");
}

main().catch((error) => {
	console.error("Local harness failed:", error);
	process.exit(1);
});
