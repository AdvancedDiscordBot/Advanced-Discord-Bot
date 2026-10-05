"use strict";

// Regression tests for the discordBoundary() mock in scripts/discord-boundary.js.
// These tests verify the Discord.js mock boundaries fixed in Issue #51.
// They directly invoke the real discordBoundary() implementation with no duplicated mock logic.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Collection } = require("discord.js");
const { discordBoundary, GUILD, MEMBER } = require("../scripts/discord-boundary");

test("mock gap fix: client.guilds.fetch() returns a guild by ID", async () => {
	const { client, primary } = discordBoundary();
	const result = await client.guilds.fetch(GUILD);
	assert.equal(result, primary);
	const missing = await client.guilds.fetch("000000000000000001");
	assert.equal(missing, null);
});

test("mock gap fix: message.mentions is present and has expected shape", () => {
	const b = discordBoundary();
	const m = b.message("hello", b.primary.text);
	assert.ok(m.mentions, "mentions should exist");
	assert.ok(m.mentions.users instanceof Collection, "mentions.users must be a Collection");
	assert.ok(m.mentions.members instanceof Collection);
	assert.ok(m.mentions.roles instanceof Collection);
	assert.ok(m.mentions.channels instanceof Collection);
	assert.equal(m.mentions.everyone, false);
	assert.equal(m.mentions.has("anything"), false);
});

test("mock gap fix: channel.messages.fetch({ limit }) returns oldest-first Collection", async () => {
	const { primary, message } = discordBoundary();
	const ch = primary.text;
	// Seed five messages with distinct timestamps
	for (let i = 0; i < 5; i++) {
		const msg = message(`msg-${i}`, ch);
		msg.createdTimestamp = Date.now() + i * 1000; // ascending
	}
	const result = await ch.messages.fetch({ limit: 3 });
	assert.ok(result instanceof Collection, "fetch({limit}) must return a Collection");
	assert.equal(result.size, 3, "respects limit");
	const timestamps = [...result.values()].map((m) => m.createdTimestamp);
	assert.ok(timestamps[0] <= timestamps[1] && timestamps[1] <= timestamps[2], "oldest-first ordering");
});

test("mock gap fix: channel.messages.fetch(id) returns a single message or null", async () => {
	const { primary, message } = discordBoundary();
	const ch = primary.text;
	const msg = message("single", ch);
	const found = await ch.messages.fetch(msg.id);
	assert.equal(found, msg);
	const notFound = await ch.messages.fetch("0000000");
	assert.equal(notFound, null);
});

test("mock gap fix: channel.bulkDelete(count) removes messages and returns a Collection", async () => {
	const { primary, message } = discordBoundary();
	const ch = primary.text;
	for (let i = 0; i < 4; i++) message(`bulk-${i}`, ch);
	const before = ch.messages.cache.size;
	const deleted = await ch.bulkDelete(2);
	assert.ok(deleted instanceof Collection, "bulkDelete must return a Collection");
	assert.equal(deleted.size, 2);
	assert.equal(ch.messages.cache.size, before - 2);
});

test("mock gap fix: channel.bulkDelete(Collection) deletes specified messages", async () => {
	const { primary, message } = discordBoundary();
	const ch = primary.text;
	const m1 = message("a", ch);
	const m2 = message("b", ch);
	const toDelete = new Collection([[m1.id, m1], [m2.id, m2]]);
	const deleted = await ch.bulkDelete(toDelete);
	assert.equal(deleted.size, 2);
	assert.equal(ch.messages.cache.has(m1.id), false);
	assert.equal(ch.messages.cache.has(m2.id), false);
});

test("mock gap fix: channel.bulkDelete filterOld=true skips messages older than 14 days", async () => {
	const { primary, message } = discordBoundary();
	const ch = primary.text;
	const fresh = message("fresh", ch);
	const old = message("old", ch);
	old.createdTimestamp = Date.now() - 15 * 24 * 60 * 60 * 1000; // 15 days ago
	const deleted = await ch.bulkDelete([fresh, old], true);
	assert.equal(deleted.size, 1);
	assert.ok(deleted.has(fresh.id));
});

test("mock gap fix: channel.setRateLimitPerUser() updates rateLimitPerUser state", async () => {
	const { primary } = discordBoundary();
	const ch = primary.text;
	assert.equal(ch.rateLimitPerUser, 0);
	const result = await ch.setRateLimitPerUser(30);
	assert.equal(result, ch);
	assert.equal(ch.rateLimitPerUser, 30);
});

test("mock gap fix: channel.pins.fetch() returns the pinned messages Collection", async () => {
	const { primary, message } = discordBoundary();
	const ch = primary.text;
	const msg = message("pinnable", ch);
	await msg.pin();
	const pins = await ch.pins.fetch();
	assert.ok(pins instanceof Collection);
	assert.ok(pins.has(msg.id));
	await msg.unpin();
	const pinsAfter = await ch.pins.fetch();
	assert.equal(pinsAfter.has(msg.id), false);
});

test("mock gap fix: guild.channels.fetch() with no argument returns full Collection", async () => {
	const { primary } = discordBoundary();
	const all = await primary.channels.fetch();
	assert.ok(all instanceof Collection, "no-arg fetch must return Collection");
	assert.ok(all.size >= 3, "should include integration-chat, lobby, category");
});

test("mock gap fix: guild.channels.fetch(undefined) also returns full Collection", async () => {
	const { primary } = discordBoundary();
	const all = await primary.channels.fetch(undefined);
	assert.ok(all instanceof Collection);
	assert.ok(all.size > 0);
});

test("mock gap fix: guild.channels.fetch(id) still returns a single channel or null", async () => {
	const { primary } = discordBoundary();
	const ch = await primary.channels.fetch(primary.text.id);
	assert.equal(ch, primary.text);
	const none = await primary.channels.fetch("0000000000");
	assert.equal(none, null);
});

test("mock gap fix: guild.bans / guild.unban() work correctly", async () => {
	const { primary } = discordBoundary();
	const member = primary.members.cache.get(MEMBER);
	await member.ban({ reason: "test ban" });
	assert.equal(member.banned, true);
	const ban = await primary.bans.fetch(MEMBER);
	assert.ok(ban, "bans.fetch should find the banned user");
	assert.equal(ban.reason, "test ban");
	await primary.unban(MEMBER);
	const afterUnban = await primary.bans.fetch(MEMBER);
	assert.equal(afterUnban, null, "should be gone after unban");
});

test("mock gap fix: interaction.deleteReply() removes the reply message from the channel cache", async () => {
	const b = discordBoundary();
	const i = b.interaction("test", null);
	await i.reply({ content: "hello" });
	assert.ok(i.replied);
	const replyMsg = await i.fetchReply();
	assert.ok(replyMsg, "reply message should exist before deleteReply");
	assert.ok(b.primary.text.messages.cache.has(replyMsg.id), "reply should be in channel cache before deleteReply");
	await i.deleteReply();
	assert.equal(replyMsg.deleted, true, "message.deleted must be true after deleteReply");
	assert.equal(b.primary.text.messages.cache.has(replyMsg.id), false, "message should be gone from cache after deleteReply");
	// Discord.js does not throw on a subsequent deleteReply
	await i.deleteReply();
});

test("mock gap fix: interaction.deferUpdate() acknowledges without a public reply", async () => {
	const b = discordBoundary();
	const i = b.interaction(null, null, {}, { type: 3 });
	assert.ok(!i.replied && !i.deferred);
	await i.deferUpdate();
	assert.equal(i.deferred, true);
	assert.equal(i.replied, false);
	await assert.rejects(() => i.deferUpdate(), /acknowledged/i);
});

test("mock gap fix: interaction.update() edits the source message and marks replied", async () => {
	const b = discordBoundary();
	const sourceMsg = b.message("original", b.primary.text);
	const i = b.interaction(null, null, {}, { type: 3, sourceMessage: sourceMsg });
	await i.update({ content: "updated" });
	assert.equal(i.replied, true);
	assert.equal(i.responses[0].content, "updated");
	await assert.rejects(() => i.update({ content: "again" }), /acknowledged/i);
});

test("mock gap fix: interaction.showModal() records the modal and marks replied", async () => {
	const b = discordBoundary();
	const i = b.interaction("test", null);
	const fakeModal = { custom_id: "my-modal", title: "Edit" };
	await i.showModal(fakeModal);
	assert.equal(i.replied, true);
	assert.deepEqual(i.shownModal, fakeModal);
	await assert.rejects(() => i.showModal(fakeModal), /acknowledged/i);
});

test("mock gap fix: interaction.values is available for select-menu interactions", () => {
	const b = discordBoundary();
	const i = b.interaction(null, null, {}, { type: 3, selectValues: ["opt-a", "opt-b"] });
	assert.deepEqual(i.values, ["opt-a", "opt-b"]);
});

test("mock gap fix: interaction.isStringSelectMenu() returns true when componentType === 3", () => {
	const b = discordBoundary();
	const i = b.interaction(null, null, {}, { type: 3 });
	assert.equal(i.isStringSelectMenu(), false);
	i.componentType = 3;
	assert.equal(i.isStringSelectMenu(), true);
	assert.equal(i.isButton(), false);
});

test("mock gap fix: interaction.isButton() returns true when componentType === 2 or absent", () => {
	const b = discordBoundary();
	const buttonNoType = b.interaction(null, null, {}, { type: 3 });
	assert.equal(buttonNoType.isButton(), true);
	buttonNoType.componentType = 2;
	assert.equal(buttonNoType.isButton(), true);
});

test("mock gap fix: interaction.options.getSubcommandGroup() returns configured group or null", () => {
	const b = discordBoundary();
	const withGroup = b.interaction("automod", "add", {}, { subGroup: "rule" });
	assert.equal(withGroup.options.getSubcommandGroup(), "rule");
	const noGroup = b.interaction("automod", "list", {});
	assert.equal(noGroup.options.getSubcommandGroup(), null);
});
