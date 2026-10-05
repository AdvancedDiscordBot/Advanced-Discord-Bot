"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Collection, Events, PermissionsBitField, PermissionFlagsBits: P, ApplicationCommandManager } = require("discord.js");

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const ADMIN = "200000000000000001";
const MEMBER = "200000000000000002";
const BOT = "300000000000000001";
const ROLE = "400000000000000001";

function discordBoundary() {
	const client = new EventEmitter();
	const sent = [];
	let nextId = 500000000000000000n;
	let ready = false;
	const id = () => String(++nextId);
	const permissions = new PermissionsBitField(P.Administrator);
	client.guilds = { cache: new Collection(), fetch: async (key) => key ? (client.guilds.cache.get(key) || null) : client.guilds.cache };
	client.channels = { cache: new Collection(), fetch: async (key) => client.channels.cache.get(key) || null };
	client.users = { cache: new Collection(), fetch: async (key) => client.users.cache.get(key) || user(key) };
	client.ws = { ping: 0 };
	client.isReady = () => ready;
	client.destroy = async () => { ready = false; };
	client.login = async () => {
		ready = true;
		client.emit(Events.ClientReady, client);
		client.emit("ready", client);
		return "offline-test-token";
	};

	function payload(value) {
		const data = typeof value === "string" ? { content: value } : value || {};
		const out = { ...data, embeds: (data.embeds || []).map((embed) => embed.toJSON ? embed.toJSON() : embed) };
		assert.ok((out.content || "").length <= 2000, "Discord content limit");
		let embedLength = 0;
		for (const embed of out.embeds) {
			assert.ok((embed.description || "").length <= 4096, "Discord embed description limit");
			assert.ok((embed.fields || []).length <= 25, "Discord embed field count");
			embedLength += (embed.title || "").length + (embed.description || "").length + (embed.footer?.text || "").length;
			for (const field of embed.fields || []) {
				assert.ok(field.name.length <= 256 && field.value.length <= 1024, "Discord embed field limit");
				embedLength += field.name.length + field.value.length;
			}
		}
		assert.ok(embedLength <= 6000, "Discord total embed limit");
		return out;
	}

	function message(data, channel, author = client.user) {
		const msg = {
			id: id(), guild: channel?.guild, guildId: channel?.guildId, channel, channelId: channel?.id,
			author, member: channel?.guild?.members.cache.get(author.id), content: "", embeds: [],
			attachments: new Collection(), reactions: { cache: new Collection() }, createdTimestamp: Date.now(),
			url: "https://discord.com/channels/test/message", deleted: false,
			// mentions: standard discord.js Message.mentions surface needed by automod/plugin logic
			mentions: {
				users: new Collection(), members: new Collection(), roles: new Collection(), channels: new Collection(),
				everyone: false, has(entity) { const key = typeof entity === "string" ? entity : entity?.id; return this.users.has(key) || this.members.has(key) || this.roles.has(key); },
			},
			async edit(value) { Object.assign(msg, payload(value)); return msg; },
			async delete() { msg.deleted = true; channel?.messages.cache.delete(msg.id); },
			async reply(value) { return channel.send(value); },
			async react(emoji) { msg.lastReaction = emoji; },
			async pin() { channel?.pins?.cache?.set(msg.id, msg); },
			async unpin() { channel?.pins?.cache?.delete(msg.id); },
		};
		Object.assign(msg, payload(data));
		channel?.messages.cache.set(msg.id, msg);
		return msg;
	}

	function user(key, bot = false) {
		const value = {
			id: key, bot, username: `user-${key.slice(-2)}`, tag: `user-${key.slice(-2)}`,
			createdAt: new Date("2020-01-01"), createdTimestamp: Date.parse("2020-01-01"),
			displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
			toString: () => `<@${key}>`, setActivity() {}, setPresence() {},
			async send(data) { const msg = message(data, null, client.user); sent.push({ kind: "dm", userId: key, ...payload(data) }); return msg; },
		};
		client.users.cache.set(key, value);
		return value;
	}
	client.user = user(BOT, true);

	function channel(guild, name, type = 0, options = {}) {
		const value = {
			id: id(), name, type, guild, guildId: guild.id, deletable: true, deleted: false,
			parentId: options.parent || null, parent: guild.channels.cache.get(options.parent),
			bitrate: options.bitrate || 64000, userLimit: options.userLimit || 0, rateLimitPerUser: 0,
			members: new Collection(),
			isTextBased: () => type === 0, isVoiceBased: () => type === 2, permissionsFor: () => permissions,
			toString() { return `<#${value.id}>`; },
			// pins: text channels expose a pins manager
			pins: { cache: new Collection(), async fetch() { return value.pins.cache; } },
			messages: {
				cache: new Collection(),
				// fetch(id) returns a single message; fetch({ limit }) returns a Collection oldest→newest up to limit
				async fetch(keyOrOptions) {
					if (keyOrOptions === null || keyOrOptions === undefined) return new Collection();
					if (typeof keyOrOptions === "string") return value.messages.cache.get(keyOrOptions) || null;
					const limit = typeof keyOrOptions === "object" ? (keyOrOptions.limit ?? 50) : 50;
					const result = new Collection();
					const entries = [...value.messages.cache.entries()].sort(([, a], [, b]) => a.createdTimestamp - b.createdTimestamp);
					for (const [k, v] of entries.slice(0, limit)) result.set(k, v);
					return result;
				},
			},
			// bulkDelete: deletes up to count messages or specific collection/array; filterOld filters messages older than 14 days
			async bulkDelete(messagesOrCount, filterOld = false) {
				const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
				let targets;
				if (typeof messagesOrCount === "number") {
					const entries = [...value.messages.cache.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp).slice(0, messagesOrCount);
					targets = filterOld ? entries.filter((m) => m.createdTimestamp > twoWeeksAgo) : entries;
				} else {
					const arr = messagesOrCount instanceof Collection ? [...messagesOrCount.values()] : [...messagesOrCount];
					targets = filterOld ? arr.filter((m) => (m.createdTimestamp ?? Date.now()) > twoWeeksAgo) : arr;
				}
				const deleted = new Collection();
				for (const msg of targets) { value.messages.cache.delete(msg.id); deleted.set(msg.id, msg); }
				return deleted;
			},
			async setRateLimitPerUser(seconds) { value.rateLimitPerUser = seconds; return value; },
			permissionOverwrites: {
				cache: new Collection(),
				async edit(target, changes) {
					const key = typeof target === "string" ? target : target.id;
					const overwrite = this.cache.get(key) || { id: key, type: guild.roles.cache.has(key) ? 0 : 1, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
					for (const [name, enabled] of Object.entries(changes)) {
						overwrite.allow.remove(P[name]); overwrite.deny.remove(P[name]);
						if (enabled === true) overwrite.allow.add(P[name]);
						if (enabled === false) overwrite.deny.add(P[name]);
					}
					this.cache.set(key, overwrite);
					return value;
				},
				async set(overwrites) {
					this.cache.clear();
					for (const overwrite of overwrites) this.cache.set(overwrite.id, { ...overwrite, allow: new PermissionsBitField(overwrite.allow || 0n), deny: new PermissionsBitField(overwrite.deny || 0n) });
					return value;
				},
				async delete(target) { this.cache.delete(typeof target === "string" ? target : target.id); },
			},
			async send(data) { const msg = message(data, value); sent.push({ kind: "channel", channelId: value.id, ...payload(data) }); return msg; },
			async delete() { value.deleted = true; guild.channels.cache.delete(value.id); client.channels.cache.delete(value.id); },
			async setName(name) { value.name = name; return value; },
			async fetchWebhooks() { return new Collection(); },
			async createWebhook() { return { owner: client.user, send: (data) => value.send(data) }; },
		};
		guild.channels.cache.set(value.id, value);
		client.channels.cache.set(value.id, value);
		return value;
	}

	function guild(key) {
		const value = { id: key, name: "Offline test guild", ownerId: ADMIN, memberCount: 3, available: true, maximumBitrate: 96000, verificationLevel: 0, iconURL: () => null };
		value.channels = {
			// fetch(id) → single channel or null; fetch() / fetch(undefined) → full Collection
			cache: new Collection(), fetch: async (key) => key === undefined || key === null ? new Collection(value.channels.cache) : value.channels.cache.get(key) || null,
			async create(options) {
				assert.equal(typeof options, "object", "Discord.js v14 takes one channel options object");
				assert.equal(typeof options.name, "string");
				const result = channel(value, options.name, options.type, options);
				await result.permissionOverwrites.set(options.permissionOverwrites || []);
				return result;
			},
		};
		const makeRole = (id, position) => ({ id, name: `role-${position}`, position, rawPosition: position, managed: false, editable: true, guild: value, permissions: new PermissionsBitField(), toString: () => `<@&${id}>`, comparePositionTo(other) { return position - other.position; } });
		value.roles = { cache: new Collection([[key, makeRole(key, 0)], [ROLE, makeRole(ROLE, 1)]]), fetch: async (key) => value.roles.cache.get(key) || null };
		value.roles.everyone = value.roles.cache.get(key);
		value.voiceStates = { cache: new Collection() };
		value.members = { cache: new Collection(), fetch: async (key) => {
			const member = value.members.cache.get(typeof key === "object" ? key.user : key);
			if (!member) throw Object.assign(new Error("Unknown member"), { code: 10007 });
			return member;
		}, fetchMe: async () => value.members.me };
		// bans: track banned users so unban() and guild.bans can be used by moderation plugins
		value.bans = { cache: new Collection(), fetch: async (key) => value.bans.cache.get(key) || null };
		value.unban = async (userOrId) => { const key = typeof userOrId === "string" ? userOrId : userOrId.id; value.bans.cache.delete(key); };
		for (const key of [ADMIN, MEMBER, BOT]) {
			const person = client.users.cache.get(key) || user(key);
			const member = { id: key, user: person, guild: value, displayName: person.username, permissions: key === MEMBER ? new PermissionsBitField() : permissions, joinedTimestamp: Date.now(), manageable: true, moderatable: true, kickable: true, bannable: true, toString: person.toString, send: person.send };
			member.roles = {
				cache: new Collection([[value.id, value.roles.everyone]]), highest: makeRole(`highest-${key}`, key === BOT ? 100 : key === ADMIN ? 90 : 0),
				async add(roles) { for (const role of Array.isArray(roles) ? roles : [roles]) { const key = typeof role === "string" ? role : role.id; this.cache.set(key, value.roles.cache.get(key)); } },
				async remove(roles) { for (const role of Array.isArray(roles) ? roles : [roles]) this.cache.delete(typeof role === "string" ? role : role.id); },
			};
			member.voice = { channelId: null, async setChannel(destination) {
				value.channels.cache.get(this.channelId)?.members.delete(key);
				const target = typeof destination === "string" ? value.channels.cache.get(destination) : destination;
				this.channelId = target?.id || null;
				target?.members.set(key, member);
				value.voiceStates.cache.set(key, { id: key, guild: value, member, channelId: this.channelId, channel: target });
			} };
			member.timeout = async () => { member.timedOut = true; };
			member.kick = async () => { member.kicked = true; };
			member.ban = async (options) => { member.banned = true; value.bans.cache.set(key, { user: person, reason: options?.reason || null }); };
			value.members.cache.set(key, member);
		}
		value.members.me = value.members.cache.get(BOT);
		value.invite = { code: "offline-invite", uses: 0, inviter: client.users.cache.get(ADMIN), maxUses: 0 };
		value.invites = { fetch: async () => new Collection([[value.invite.code, value.invite]]) };
		value.fetchAuditLogs = async () => ({ entries: new Collection() });
		value.setVerificationLevel = async (level) => { value.verificationLevel = level; };
		value.shard = { send() { assert.fail("The integration check must not request a live voice connection"); } };
		value.commands = {
			cache: new Collection(),
			async create(data) { const command = { ...ApplicationCommandManager.transformCommand(data), id: id() }; this.cache.set(command.id, command); return command; },
			async fetch() { return this.cache; },
			async delete(key) { this.cache.delete(key); },
			async set(commands) { this.cache.clear(); for (const command of commands) await this.create(command); value.synced = true; },
		};
		client.guilds.cache.set(key, value);
		value.text = channel(value, "integration-chat");
		value.lobby = channel(value, "Create voice", 2);
		value.category = channel(value, "Voice rooms", 4);
		return value;
	}
	const primary = guild(GUILD);
	const secondary = guild(OTHER_GUILD);

	function interaction(name, sub, values = {}, { guild = primary, userId = ADMIN, type = 2, commandType = 1, customId, sourceMessage, subGroup = null, selectValues = [] } = {}) {
		const responses = [];
		const data = Object.entries(values).map(([name, value]) => ({ name, type: typeof value === "boolean" ? 5 : typeof value === "number" ? 4 : typeof value === "object" ? value.type === undefined ? 8 : 7 : 3, value: value?.id || value }));
		let reply;
		const i = {
			id: id(), client, type, commandType, commandName: name, guildId: guild.id, guild,
			channel: guild.text, channelId: guild.text.id, user: client.users.cache.get(userId), member: guild.members.cache.get(userId),
			memberPermissions: guild.members.cache.get(userId).permissions, appPermissions: permissions,
			customId, message: sourceMessage, responses, replied: false, deferred: false,
			// values: selected values for string-select-menu interactions
			values: selectValues,
			isChatInputCommand: () => type === 2 && commandType === 1,
			isContextMenuCommand: () => type === 2 && commandType !== 1,
			isUserContextMenuCommand: () => type === 2 && commandType === 2,
			isMessageContextMenuCommand: () => type === 2 && commandType === 3,
			isAutocomplete: () => type === 4,
			isButton: () => type === 3 && (!i.componentType || i.componentType === 2),
			// isStringSelectMenu: type 3 component, componentType 3 (StringSelect)
			isStringSelectMenu: () => type === 3 && i.componentType === 3,
			isModalSubmit: () => type === 5,
			inGuild: () => true,
			options: {
				data: sub ? [{ name: sub, type: 1, options: data }] : data,
				getSubcommand: () => sub,
				// getSubcommandGroup: returns the configured group or null
				getSubcommandGroup: () => subGroup,
			},
			async deferReply(options = {}) { assert.ok(!i.replied && !i.deferred, "Interaction acknowledged once"); i.deferred = true; i.ephemeral = !!(options.ephemeral || Number(options.flags || 0) & 64); },
			async reply(data) { assert.ok(!i.replied && !i.deferred, "Interaction acknowledged once"); i.replied = true; i.ephemeral = !!(data?.ephemeral || Number(data?.flags || 0) & 64); responses.push(payload(data)); reply = message(data, guild.text); return reply; },
			async editReply(data) { assert.ok(i.replied || i.deferred, "Reply must be acknowledged before editing"); responses.push(payload(data)); reply ||= message({}, guild.text); await reply.edit(data); i.replied = true; return reply; },
			async followUp(data) { assert.ok(i.replied || i.deferred); responses.push(payload(data)); return message(data, guild.text); },
			async fetchReply() { assert.ok(i.replied || i.deferred); reply ||= message({}, guild.text); return reply; },
			// deleteReply: removes the previously sent reply from the mocked channel
			async deleteReply() { assert.ok(i.replied || i.deferred, "Cannot delete a reply that was never sent"); if (reply) await reply.delete(); reply = undefined; },
			// deferUpdate: acknowledges a component interaction without changing the message
			async deferUpdate() { assert.ok(!i.replied && !i.deferred, "Interaction acknowledged once"); i.deferred = true; },
			// update: edits the original message of a component interaction
			async update(data) { assert.ok(!i.replied && !i.deferred, "Interaction acknowledged once"); i.replied = true; responses.push(payload(data)); if (i.message) Object.assign(i.message, payload(data)); reply = i.message || message(data, guild.text); return reply; },
			// showModal: presents a modal — marks the interaction as replied (only one acknowledgement allowed)
			async showModal(modal) { assert.ok(!i.replied && !i.deferred, "Interaction acknowledged once"); i.replied = true; i.shownModal = modal?.toJSON ? modal.toJSON() : modal; },
		};
		for (const type of ["String", "Integer", "Boolean", "Number", "Channel", "Role", "User", "Member", "Attachment"]) i.options[`get${type}`] = (name) => values[name] ?? null;
		return i;
	}
	return { client, primary, secondary, sent, interaction, message };
}

module.exports = {
	discordBoundary,
	GUILD,
	OTHER_GUILD,
	ADMIN,
	MEMBER,
	BOT,
	ROLE,
};
