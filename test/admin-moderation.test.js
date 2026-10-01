/**
 * /mod infractions + escalation in the administration plugin (#10).
 * Models are in-memory fakes; Discord objects are minimal stubs.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const Database = require("../utils/database");
const { register, parseDuration, pickEscalation, buildCommand } = require("../plugins/administration/moderation");

test("parseDuration accepts ms-style strings and rejects junk", () => {
	assert.equal(parseDuration("10m"), 600_000);
	assert.equal(parseDuration(" 1h "), 3_600_000);
	for (const bad of ["", "abc", "0", "-5m", "x".repeat(200), null]) assert.equal(parseDuration(bad), null, String(bad));
});

test("pickEscalation fires once at the exact threshold, harshest first", () => {
	const config = { warn_threshold_mute: 3, warn_threshold_tempban: 5, warn_threshold_ban: 7, warn_threshold_kick: 0 };
	assert.equal(pickEscalation(2, config), null);
	assert.equal(pickEscalation(3, config), "mute");
	assert.equal(pickEscalation(4, config), null);
	assert.equal(pickEscalation(5, config), "tempban");
	assert.equal(pickEscalation(7, config), "ban");
	assert.equal(pickEscalation(3, { warn_threshold_mute: 3, warn_threshold_kick: 3 }), "kick");
	assert.equal(pickEscalation(0, {}), null, "0 thresholds are off");
});

test("/mod is a single namespaced command (no clash with adb-plugin-moderation)", () => {
	const json = buildCommand().toJSON();
	assert.equal(json.name, "mod");
	assert.deepEqual(json.options.map((o) => o.name), ["warn", "mute", "unmute", "timeout", "kick", "softban", "note", "warnings"]);
});

// ── Behavior with fakes ──────────────────────────────────────────────────

function fakeModel() {
	const docs = [];
	const matches = (doc, query) => Object.entries(query).every(([k, v]) =>
		v && typeof v === "object" && "$in" in v ? v.$in.includes(doc[k]) : doc[k] === v);
	return {
		docs,
		create: async (fields) => { const doc = { _id: docs.length + 1, createdAt: new Date(), ...fields }; docs.push(doc); return doc; },
		countDocuments: async (q) => docs.filter((d) => matches(d, q)).length,
		find: async (q) => docs.filter((d) => matches(d, q)),
		updateMany: async (q, { $set }) => { const hit = docs.filter((d) => matches(d, q)); hit.forEach((d) => Object.assign(d, $set)); return { modifiedCount: hit.length }; },
		findOneAndUpdate: async (q, update) => {
			let doc = docs.find((d) => matches(d, q));
			if (!doc && update.$inc) { doc = { ...q, seq: 0 }; docs.push(doc); }
			if (!doc) return null;
			for (const [k, n] of Object.entries(update.$inc || {})) doc[k] += n;
			Object.assign(doc, update.$set || {});
			return doc;
		},
	};
}

function setup(settings = {}) {
	const models = {};
	let command;
	const ctx = {
		defineModel: (name) => (models[name] = fakeModel()),
		registerCommand: (c) => { command = c; },
		registerEvent: () => {},
		scheduler: { schedule: () => {}, unschedule: () => {} },
		hooks: { on: () => {} },
		logger: { error: () => {}, warn: () => {} },
	};
	register(ctx);
	Database.getInstance = async () => ({ getPluginConfig: async () => ({ data: settings }) });

	const calls = [];
	const dms = [];
	const role = (position) => ({ position, comparePositionTo: (other) => position - other.position });
	const member = {
		id: "target", roles: { highest: role(1), cache: new Map(), add: async (id) => calls.push(["roles.add", id]), remove: async (ids) => calls.push(["roles.remove", ids]) },
		moderatable: true, kickable: true, bannable: true, manageable: true,
		isCommunicationDisabled: () => false,
		timeout: async (ms) => calls.push(["timeout", ms]),
		kick: async () => calls.push(["kick"]),
	};
	const guild = {
		id: "g", name: "Guild", ownerId: "owner",
		members: {
			fetch: async (id) => (id === "target" ? member : { id, roles: { highest: role(5) } }),
			ban: async (id, opts) => calls.push(["ban", id, opts]),
			unban: async (id) => calls.push(["unban", id]),
		},
	};
	const run = async (sub, opts = {}, { group = null, perms = true } = {}) => {
		const replies = [];
		const interaction = {
			inGuild: () => true, guild, client: { user: { id: "bot" } },
			user: { id: "mod" }, member: { roles: { highest: role(5) } },
			memberPermissions: { has: () => perms },
			deferReply: async () => {}, reply: async (r) => replies.push(r), editReply: async (r) => replies.push(r),
			options: {
				getSubcommandGroup: () => group, getSubcommand: () => sub,
				getUser: () => ({ id: "target", tag: "target#0", send: async (m) => { dms.push(m); }, toString: () => "<@target>" }),
				getString: (name) => opts[name] ?? null, getInteger: (name) => opts[name] ?? null, getAttachment: () => opts.evidence ?? null,
			},
		};
		await command.execute(interaction);
		const last = replies.at(-1);
		return typeof last === "string" ? last : last.embeds[0].data.description;
	};
	return { models, calls, dms, run, member };
}

test("warn records an active case, DMs the member, and auto-escalates at the threshold", async () => {
	const h = setup({ warn_threshold_timeout: 2, warn_timeout_duration: "1h", appeal_info: "https://appeal" });
	const first = await h.run("warn", { reason: "spam", evidence: { url: "https://cdn/x.png" } });
	assert.match(first, /case #1/);
	assert.equal(h.calls.length, 0, "no escalation below threshold");
	assert.deepEqual(h.models.infraction.docs[0].evidence, ["https://cdn/x.png"]);
	assert.equal(h.models.infraction.docs[0].active, true);
	assert.match(h.dms[0].embeds[0].data.description, /https:\/\/appeal/);

	const second = await h.run("warn", { reason: "spam again" });
	assert.match(second, /Auto-escalation: \*\*Timeout\*\*/);
	assert.deepEqual(h.calls, [["timeout", 3_600_000]]);
	const auto = h.models.infraction.docs.at(-1);
	assert.equal(auto.type, "timeout");
	assert.equal(auto.auto, true);
	assert.equal(auto.moderatorId, "bot");
	assert.deepEqual(h.models.infraction.docs.map((d) => d.caseId), [1, 2, 3], "case IDs are sequential per guild");
});

test("removed warnings don't count toward escalation", async () => {
	const h = setup({ warn_threshold_kick: 2 });
	await h.run("warn", { reason: "a" });
	await h.run("remove", { case: 1 }, { group: "warnings" });
	await h.run("warn", { reason: "b" });
	assert.equal(h.calls.length, 0);
});

test("mute uses the configured mute role and expires; unmute removes it", async () => {
	const h = setup({ mute_role_id: "muted" });
	await h.run("mute", { duration: "2h", reason: "x" });
	assert.deepEqual(h.calls, [["roles.add", "muted"]]);
	const mute = h.models.infraction.docs[0];
	assert.equal(mute.muteRoleId, "muted");
	assert.ok(mute.expiresAt > new Date(Date.now() + 7_000_000));

	h.member.roles.cache.set("muted", {});
	const out = await h.run("unmute", { reason: "ok" });
	assert.match(out, /Unmuted/);
	assert.deepEqual(h.calls.at(-1), ["roles.remove", ["muted"]]);
	assert.equal(mute.active, false);
});

test("guards: role hierarchy, missing permission, bad duration, DMs off", async () => {
	const h = setup({ dm_on_action: false });
	h.member.roles.highest = { position: 9, comparePositionTo: (o) => 9 - o.position };
	assert.match(await h.run("kick", {}), /at or above yours/);
	h.member.roles.highest = { position: 1, comparePositionTo: (o) => 1 - o.position };
	assert.match(await h.run("kick", {}, { perms: false }), /permission/);
	assert.match(await h.run("timeout", { duration: "soon" }), /Invalid duration/);
	assert.match(await h.run("timeout", { duration: "30d" }), /28 days/);
	assert.doesNotMatch(await h.run("kick", {}), /Could not DM/, "DMs disabled is not a DM failure");
	assert.equal(h.dms.length, 0);
	assert.equal(h.calls.length, 1);
});
