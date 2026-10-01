// Infractions + moderation actions (/mod), with configurable warn escalation.
//
// Everything is a subcommand of /mod: the top-level names /warn, /warnings,
// /kick and /timeout belong to adb-plugin-moderation, and PluginManager refuses
// a second owner for a command name — that plugin would then fail to load.

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags, Events } = require("discord.js");
const mongoose = require("mongoose");
const ms = require("ms");
const Database = require("../../utils/database");
const { settings } = require("./plugin.json");

const PLUGIN = "administration";
const SWEEP_TASK = "administration:infraction-expiry";
const DEFAULTS = Object.fromEntries(settings.schema.map((field) => [field.key, field.default]));
const PAGE_SIZE = 10;
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
// Most severe first: when several thresholds share a count, the harshest wins.
const ESCALATIONS = ["ban", "tempban", "kick", "timeout", "mute"];
const LABELS = {
	warn: "Warning", mute: "Mute", unmute: "Unmute", timeout: "Timeout", kick: "Kick",
	softban: "Softban", tempban: "Temporary ban", ban: "Ban",
};
const COLORS = {
	warn: 0xfacc15, mute: 0xf97316, timeout: 0xf97316, kick: 0xef4444,
	softban: 0xef4444, tempban: 0xb91c1c, ban: 0xb91c1c, unmute: 0x22c55e,
};
// Discord API error codes meaning "already undone" during expiry.
const ALREADY_GONE = new Set([10007, 10011, 10026]); // Unknown Member / Role / Ban

const infractionSchema = new mongoose.Schema(
	{
		guildId: { type: String, required: true },
		caseId: { type: Number, required: true },
		userId: { type: String, required: true },
		moderatorId: { type: String, required: true },
		type: { type: String, enum: Object.keys(LABELS), required: true },
		reason: { type: String, default: "No reason provided" },
		evidence: [String],
		notes: [{ authorId: String, text: String, createdAt: { type: Date, default: Date.now } }],
		duration: Number,
		expiresAt: Date,
		muteRoleId: String, // set for role-based mutes so expiry removes the right role
		active: { type: Boolean, default: false },
		auto: { type: Boolean, default: false },
	},
	{ timestamps: true },
);
infractionSchema.index({ guildId: 1, caseId: 1 }, { unique: true });
infractionSchema.index({ guildId: 1, userId: 1, type: 1, active: 1 });
infractionSchema.index({ active: 1, expiresAt: 1 });

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

function parseDuration(text) {
	try {
		const value = ms(String(text ?? "").trim());
		return Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		return null; // ms() throws on over-long input
	}
}

/** The escalation step triggered when a member reaches `activeWarnings`, or null. */
function pickEscalation(activeWarnings, config) {
	return ESCALATIONS.find((action) => {
		const threshold = Number(config[`warn_threshold_${action}`]);
		return threshold > 0 && activeWarnings === threshold;
	}) || null;
}

async function getSettings(guildId) {
	const db = await Database.getInstance();
	const config = await db.getPluginConfig(guildId, PLUGIN);
	return { ...DEFAULTS, ...(config?.data || {}) };
}

function buildCommand() {
	const user = (sc) => sc.addUserOption((o) => o.setName("user").setDescription("Target member").setRequired(true));
	const reason = (sc, required = false) => sc.addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(512).setRequired(required));
	const evidence = (sc) => sc.addAttachmentOption((o) => o.setName("evidence").setDescription("Evidence (screenshot, log, ...)"));
	const duration = (sc) => sc.addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 1h, 7d").setRequired(true));
	const page = (sc) => sc.addIntegerOption((o) => o.setName("page").setDescription("Page").setMinValue(1));
	const caseId = (sc) => sc.addIntegerOption((o) => o.setName("case").setDescription("Case ID").setMinValue(1).setRequired(true));

	return new SlashCommandBuilder()
		.setName("mod")
		.setDescription("Moderation actions and infraction history")
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addSubcommand((sc) => evidence(reason(user(sc.setName("warn").setDescription("Warn a member")), true)))
		.addSubcommand((sc) => evidence(reason(duration(user(sc.setName("mute").setDescription("Mute a member (mute role if configured, else timeout)"))))))
		.addSubcommand((sc) => reason(user(sc.setName("unmute").setDescription("Unmute a member / clear their timeout"))))
		.addSubcommand((sc) => evidence(reason(duration(user(sc.setName("timeout").setDescription("Timeout a member (max 28d)"))))))
		.addSubcommand((sc) => evidence(reason(user(sc.setName("kick").setDescription("Kick a member")))))
		.addSubcommand((sc) => evidence(reason(user(sc.setName("softban").setDescription("Ban then unban to delete recent messages"))))
			.addIntegerOption((o) => o.setName("delete_days").setDescription("Days of messages to delete (default 1)").setMinValue(1).setMaxValue(7)))
		.addSubcommand((sc) => caseId(sc.setName("note").setDescription("Add a private moderator note to a case"))
			.addStringOption((o) => o.setName("text").setDescription("Note").setMaxLength(512).setRequired(true)))
		.addSubcommandGroup((group) => group.setName("warnings").setDescription("Infraction history")
			.addSubcommand((sc) => page(user(sc.setName("view").setDescription("View a member's infractions"))))
			.addSubcommand((sc) => caseId(sc.setName("remove").setDescription("Remove (deactivate) a warning")))
			.addSubcommand((sc) => user(sc.setName("clear").setDescription("Clear all active warnings for a member")))
			.addSubcommand((sc) => page(sc.setName("list").setDescription("Recent infractions server-wide")))
			.addSubcommand((sc) => sc.setName("stats").setDescription("Infraction statistics")));
}

function register(ctx) {
	const Infraction = ctx.defineModel("infraction", infractionSchema);
	const Counter = ctx.defineModel("infraction_counter", counterSchema);
	let readyClient = null;

	const nextCaseId = async (guildId) =>
		(await Counter.findOneAndUpdate({ _id: guildId }, { $inc: { seq: 1 } }, { upsert: true, new: true })).seq;

	async function record(fields) {
		return Infraction.create({ ...fields, caseId: await nextCaseId(fields.guildId) });
	}

	async function notify(user, guild, type, reason, durationMs, config) {
		if (type === "warn" ? !config.dm_on_warn : !config.dm_on_action) return null; // DMs off by config
		const lines = [`You received a **${LABELS[type].toLowerCase()}** in **${guild.name}**.`, `**Reason:** ${reason}`];
		if (durationMs) lines.push(`**Duration:** ${ms(durationMs, { long: true })}`);
		if (config.appeal_info) lines.push(`**Appeal:** ${config.appeal_info}`);
		const embed = new EmbedBuilder().setColor(COLORS[type]).setDescription(lines.join("\n")).setTimestamp();
		return user.send({ embeds: [embed] }).then(() => true, () => false); // closed DMs are normal
	}

	/** Why the bot can't act on this member, or null. */
	function botCannot(type, member, config) {
		if (!member) return ["warn", "softban", "tempban", "ban"].includes(type) ? null : "That user isn't in this server.";
		if ((type === "timeout" || (type === "mute" && !config.mute_role_id)) && !member.moderatable) return "I can't timeout that member (role hierarchy or missing Timeout Members).";
		if (type === "mute" && config.mute_role_id && !member.manageable) return "I can't manage that member's roles.";
		if (type === "kick" && !member.kickable) return "I can't kick that member.";
		if (["softban", "tempban", "ban"].includes(type) && !member.bannable) return "I can't ban that member.";
		return null;
	}

	/**
	 * Perform a moderation action on Discord, DM the user first (they can't be
	 * reached after a kick/ban), then record the infraction.
	 */
	async function act({ guild, user, member, moderatorId, type, reason, durationMs, evidence = [], config, auto = false, deleteDays = 1 }) {
		const dmSent = await notify(user, guild, type, reason, durationMs, config);
		const fields = { guildId: guild.id, userId: user.id, moderatorId, type, reason, evidence, auto };
		const audit = `${reason} (by ${moderatorId})`.slice(0, 512);
		switch (type) {
			case "warn":
				fields.active = true;
				break;
			case "mute":
				if (config.mute_role_id) {
					await member.roles.add(config.mute_role_id, audit);
					fields.muteRoleId = config.mute_role_id;
				} else {
					durationMs = Math.min(durationMs, MAX_TIMEOUT_MS);
					await member.timeout(durationMs, audit);
				}
				break;
			case "timeout":
				await member.timeout(durationMs, audit);
				break;
			case "kick":
				await member.kick(audit);
				break;
			case "softban":
				await guild.members.ban(user.id, { reason: audit, deleteMessageSeconds: deleteDays * 86400 });
				await guild.members.unban(user.id, "Softban");
				break;
			case "tempban":
			case "ban":
				await guild.members.ban(user.id, { reason: audit });
				break;
		}
		if (durationMs && ["mute", "timeout", "tempban"].includes(type)) {
			Object.assign(fields, { active: true, duration: durationMs, expiresAt: new Date(Date.now() + durationMs) });
		}
		return { infraction: await record(fields), dmSent };
	}

	/** Run the configured escalation step after a warning; returns a summary line or null. */
	async function escalate({ guild, user, member, config, client }) {
		const count = await Infraction.countDocuments({ guildId: guild.id, userId: user.id, type: "warn", active: true });
		const type = pickEscalation(count, config);
		if (!type) return null;
		const durationKey = { mute: "warn_mute_duration", timeout: "warn_timeout_duration", tempban: "warn_tempban_duration" }[type];
		let durationMs = null;
		if (durationKey) {
			durationMs = parseDuration(config[durationKey]);
			if (!durationMs) return `⚠️ Auto-${type} skipped: invalid \`${durationKey}\` setting.`;
			if (type === "timeout") durationMs = Math.min(durationMs, MAX_TIMEOUT_MS);
		}
		const blocked = botCannot(type, member, config);
		if (blocked) return `⚠️ Auto-${type} skipped: ${blocked}`;
		const { infraction } = await act({
			guild, user, member, type, durationMs, config, auto: true,
			moderatorId: client.user.id,
			reason: `Auto-escalation: ${count} active warnings`,
		});
		return `⚡ Auto-escalation: **${LABELS[type]}**${durationMs ? ` (${ms(durationMs, { long: true })})` : ""} — case #${infraction.caseId}`;
	}

	function formatCase(inf, { showUser = false } = {}) {
		const flags = [inf.auto ? "auto" : null, inf.active ? "active" : null].filter(Boolean).join(", ");
		const head = `**#${inf.caseId}** · ${LABELS[inf.type]}${flags ? ` (${flags})` : ""} · <t:${Math.floor(new Date(inf.createdAt).getTime() / 1000)}:R>`;
		const lines = [head, `${showUser ? `<@${inf.userId}> · ` : ""}by <@${inf.moderatorId}> · ${inf.reason}`];
		if (inf.evidence?.length) lines.push(`📎 ${inf.evidence.map((url, i) => `[evidence ${i + 1}](${url})`).join(" ")}`);
		for (const note of inf.notes || []) lines.push(`📝 <@${note.authorId}>: ${note.text}`);
		const text = lines.join("\n");
		return text.length > 380 ? `${text.slice(0, 377)}...` : text;
	}

	async function page(interaction, query, title, showUser) {
		const pageNo = interaction.options.getInteger("page") ?? 1;
		const [total, items] = await Promise.all([
			Infraction.countDocuments(query),
			Infraction.find(query).sort({ caseId: -1 }).skip((pageNo - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
		]);
		const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
		const embed = new EmbedBuilder()
			.setColor(0x6366f1)
			.setTitle(title)
			.setDescription(items.length ? items.map((inf) => formatCase(inf, { showUser })).join("\n\n") : "No infractions.")
			.setFooter({ text: `Page ${Math.min(pageNo, pages)}/${pages} · ${total} total` });
		return interaction.editReply({ embeds: [embed] });
	}

	async function execute(interaction) {
		if (!interaction.inGuild() || !interaction.guild) {
			return interaction.reply({ content: "Use this in a server.", flags: MessageFlags.Ephemeral });
		}
		const group = interaction.options.getSubcommandGroup(false);
		const sub = interaction.options.getSubcommand();
		const { guild, client } = interaction;
		readyClient ??= client;
		const isView = group === "warnings" || sub === "note";
		await interaction.deferReply(isView ? { flags: MessageFlags.Ephemeral } : {});

		const required = { kick: PermissionFlagsBits.KickMembers, softban: PermissionFlagsBits.BanMembers }[sub] ?? PermissionFlagsBits.ModerateMembers;
		if (!interaction.memberPermissions?.has(required)) {
			return interaction.editReply("You don't have permission to do that.");
		}
		const config = await getSettings(guild.id);

		if (group === "warnings") {
			if (sub === "view") {
				const target = interaction.options.getUser("user", true);
				return page(interaction, { guildId: guild.id, userId: target.id }, `Infractions for ${target.tag}`, false);
			}
			if (sub === "list") return page(interaction, { guildId: guild.id }, "Recent infractions", true);
			if (sub === "remove") {
				const inf = await Infraction.findOneAndUpdate(
					{ guildId: guild.id, caseId: interaction.options.getInteger("case", true), type: "warn", active: true },
					{ $set: { active: false } },
				);
				return interaction.editReply(inf ? `Removed warning #${inf.caseId} for <@${inf.userId}>.` : "No active warning with that case ID.");
			}
			if (sub === "clear") {
				const target = interaction.options.getUser("user", true);
				const res = await Infraction.updateMany({ guildId: guild.id, userId: target.id, type: "warn", active: true }, { $set: { active: false } });
				return interaction.editReply(`Cleared ${res.modifiedCount} active warning(s) for ${target}.`);
			}
			if (sub === "stats") {
				const [byType, top, active] = await Promise.all([
					Infraction.aggregate([{ $match: { guildId: guild.id } }, { $group: { _id: "$type", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
					Infraction.aggregate([
						{ $match: { guildId: guild.id, type: "warn", active: true } },
						{ $group: { _id: "$userId", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 },
					]),
					Infraction.countDocuments({ guildId: guild.id, type: "warn", active: true }),
				]);
				const embed = new EmbedBuilder()
					.setColor(0x6366f1)
					.setTitle("Infraction stats")
					.addFields(
						{ name: "By type", value: byType.map((t) => `${LABELS[t._id] || t._id}: **${t.n}**`).join("\n") || "None" },
						{ name: "Active warnings", value: String(active) },
						{ name: "Most warned (active)", value: top.map((t, i) => `${i + 1}. <@${t._id}> — ${t.n}`).join("\n") || "None" },
					);
				return interaction.editReply({ embeds: [embed] });
			}
		}

		if (sub === "note") {
			const inf = await Infraction.findOneAndUpdate(
				{ guildId: guild.id, caseId: interaction.options.getInteger("case", true) },
				{ $push: { notes: { authorId: interaction.user.id, text: interaction.options.getString("text", true) } } },
				{ new: true },
			);
			return interaction.editReply(inf ? `Note added to case #${inf.caseId}.` : "No case with that ID.");
		}

		// ── Actions ──────────────────────────────────────────────────────
		const user = interaction.options.getUser("user", true);
		const reason = interaction.options.getString("reason") || "No reason provided";
		if (user.id === interaction.user.id) return interaction.editReply("You can't moderate yourself.");
		if (user.id === client.user.id) return interaction.editReply("I can't moderate myself.");
		const member = await guild.members.fetch(user.id).catch(() => null);
		if (member) {
			if (member.id === guild.ownerId) return interaction.editReply("You can't moderate the server owner.");
			const moderator = interaction.member?.roles?.highest ? interaction.member : await guild.members.fetch(interaction.user.id);
			if (guild.ownerId !== interaction.user.id && member.roles.highest.comparePositionTo(moderator.roles.highest) >= 0) {
				return interaction.editReply("That member's highest role is at or above yours.");
			}
		}

		if (sub === "unmute") {
			if (!member) return interaction.editReply("That user isn't in this server.");
			const mutes = await Infraction.find({ guildId: guild.id, userId: user.id, type: { $in: ["mute", "timeout"] }, active: true });
			const roles = new Set([...mutes.map((m) => m.muteRoleId).filter(Boolean), config.mute_role_id].filter((id) => id && member.roles.cache.has(id)));
			if (!roles.size && !member.isCommunicationDisabled()) return interaction.editReply("That member isn't muted.");
			if (roles.size) await member.roles.remove([...roles], reason);
			if (member.isCommunicationDisabled()) await member.timeout(null, reason);
			await Infraction.updateMany({ _id: { $in: mutes.map((m) => m._id) } }, { $set: { active: false } });
			const inf = await record({ guildId: guild.id, userId: user.id, moderatorId: interaction.user.id, type: "unmute", reason });
			return interaction.editReply(`🔊 Unmuted ${user} — case #${inf.caseId}`);
		}

		let durationMs = null;
		if (sub === "mute" || sub === "timeout") {
			durationMs = parseDuration(interaction.options.getString("duration", true));
			if (!durationMs) return interaction.editReply("Invalid duration. Use e.g. `10m`, `1h`, `7d`.");
			if (sub === "timeout" && durationMs > MAX_TIMEOUT_MS) return interaction.editReply("Timeouts can be at most 28 days.");
		}
		const blocked = botCannot(sub, member, config);
		if (blocked) return interaction.editReply(blocked);

		const attachment = interaction.options.getAttachment("evidence");
		const { infraction, dmSent } = await act({
			guild, user, member, type: sub, reason, durationMs, config,
			moderatorId: interaction.user.id,
			evidence: attachment ? [attachment.url] : [],
			deleteDays: interaction.options.getInteger("delete_days") ?? 1,
		});
		const lines = [
			`**${LABELS[sub]}** · ${user} · case #${infraction.caseId}`,
			`**Reason:** ${reason}`,
			infraction.duration ? `**Duration:** ${ms(infraction.duration, { long: true })}` : null,
			dmSent === false ? "_Could not DM the user._" : null,
		];
		if (sub === "warn") {
			const escalation = await escalate({ guild, user, member, config, client }).catch((error) => {
				ctx.logger.error(`Escalation failed in ${guild.id}:`, error);
				return "⚠️ Auto-escalation failed — check the bot's permissions.";
			});
			lines.push(escalation);
		}
		const embed = new EmbedBuilder().setColor(COLORS[sub]).setDescription(lines.filter(Boolean).join("\n")).setTimestamp();
		return interaction.editReply({ embeds: [embed] });
	}

	/** Lift role mutes and temp bans whose time is up. */
	async function sweepExpired() {
		if (!readyClient || mongoose.connection.readyState !== 1) return;
		const due = await Infraction.find({ active: true, expiresAt: { $lte: new Date() } }).limit(100);
		for (const inf of due) {
			try {
				const guild = readyClient.guilds.cache.get(inf.guildId);
				if (guild && inf.type === "tempban") {
					await guild.members.unban(inf.userId, `Temporary ban expired (case #${inf.caseId})`);
				}
				if (guild && inf.type === "mute" && inf.muteRoleId) {
					const member = await guild.members.fetch(inf.userId).catch(() => null);
					if (member) await member.roles.remove(inf.muteRoleId, `Mute expired (case #${inf.caseId})`);
				}
			} catch (error) {
				// Leave it active so it's retried next minute, unless it's already undone.
				if (!ALREADY_GONE.has(error.code)) {
					ctx.logger.warn(`Expiry for case #${inf.caseId} in ${inf.guildId} failed: ${error.message}`);
					continue;
				}
			}
			inf.active = false;
			await inf.save();
		}
	}

	ctx.registerCommand({ data: buildCommand(), execute });
	// ponytail: a manual reload after login misses ClientReady; the sweep then
	// waits for the next /mod use to learn the client. Fine for minute-grained expiry.
	ctx.registerEvent(Events.ClientReady, (client) => { readyClient = client; });
	ctx.scheduler?.schedule(SWEEP_TASK, "* * * * *", sweepExpired);
	ctx.hooks?.on("onPluginUnload", ({ pluginName }) => {
		if (pluginName === PLUGIN) ctx.scheduler?.unschedule(SWEEP_TASK);
	});
}

module.exports = { register, parseDuration, pickEscalation, buildCommand };
