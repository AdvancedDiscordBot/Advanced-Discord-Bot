const { test } = require("node:test");
const assert = require("node:assert/strict");
const messageCreate = require("../events/messageCreate");

test("level-up embed footer carries the bot avatar", async () => {
	const botAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";
	const sent = [];
	const db = {
		getServerConfig: async () => ({ xpEnabled: true, xpPerMessage: 1 }),
		getUserProfile: async () => ({ lastMessageAt: null }),
		addXP: async () => ({ levelUp: true, newLevel: 2, profile: { totalXp: 100, messageCount: 5 } }),
		updateUserProfile: async () => ({}),
	};
	const client = { db, user: { displayAvatarURL: () => botAvatar } };
	const message = {
		author: {
			id: "user-1",
			bot: false,
			username: "member",
			discriminator: "0",
			displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/1.png",
			toString: () => "<@user-1>",
		},
		guild: { id: "guild-1" },
		channel: { id: "channel-1", send: async (payload) => sent.push(payload) },
	};

	await messageCreate.execute(message, client);

	assert.equal(sent.length, 1);
	assert.equal(sent[0].embeds[0].toJSON().footer.icon_url, botAvatar);
});
