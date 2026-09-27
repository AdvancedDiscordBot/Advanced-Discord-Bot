/**
 * risk-disclosure.js — Manifest → plain-language "worst case" statements.
 *
 * Turns a normalized v2 manifest into a deterministic list of risk statements
 * shown to the server owner at install/approval time. This is what makes the
 * isolation layer a *responsible* plugin framework rather than just a sandbox:
 * the user sees, in fixed wording, exactly what they're trusting the plugin with.
 *
 * Two hard rules, both deliberate:
 *   1. Wording is TEMPLATE-based, never AI-generated per install. Every plugin
 *      requesting BanMembers shows the identical sentence every time — the same
 *      reason mobile OS permission prompts use fixed strings. Consistency is what
 *      gets users to actually read these instead of clicking through.
 *   2. Unmapped capabilities FAIL LOUD. If a manifest declares something with no
 *      template, generateRiskCard throws — submission must be blocked until a
 *      template is added. A blank risk card for an unanticipated capability is a
 *      silent trust hole, so we never render one.
 */

const { normalize } = require("./manifest-schema");

// Fixed, human-readable "this plugin can…" statements, keyed by permission.
// {placeholder} tokens are filled from the manifest at generation time.
const RISK_TEMPLATES = {
	// discord.<Permission>
	"discord.SendMessages": "send messages in your server's channels",
	"discord.ReadMessageHistory": "read your server's full message history",
	"discord.EmbedLinks": "post rich embeds in your server",
	"discord.AttachFiles": "upload files and images to your server",
	"discord.AddReactions": "add reactions to messages",
	"discord.ManageMessages": "delete or pin any message in your server",
	"discord.ManageRoles": "grant or remove roles, including elevated ones",
	"discord.BanMembers": "permanently ban any member from your server",
	"discord.KickMembers": "remove any member from your server",
	"discord.ModerateMembers": "timeout (mute) any member in your server",
	"discord.ManageChannels": "create, delete, or modify any channel",
	"discord.ManageGuild": "change your server's settings",
	"discord.ManageWebhooks": "create and use webhooks in your server",
	"discord.ViewChannel": "view your server's channels",
	"discord.ViewAuditLog": "read your server's audit log",
	"discord.MentionEveryone": "ping @everyone and @here",
	"discord.GuildInfo": "read information about your server",
	"discord.ChannelInfo": "read information about your channels",
	"discord.UseApplicationCommands": "use application commands in your server",
	"discord.Connect": "connect to voice channels in your server",
	"discord.Speak": "speak and play audio in your server's voice channels",
	"discord.MoveMembers": "move members between voice channels in your server",

	// storage.<scope>
	"storage.own-collection": "store and retrieve its own data",
	"storage.read-profiles": "read member profiles (XP, levels, warnings, points)",
	"storage.write-profiles": "modify member profiles (XP, levels, warnings, points)",

	// ai.<model>
	"ai.gemini-proxy": "send prompts to the AI model through the bot (API keys never leave the bot)",

	// hooks.<action>
	"hooks.subscribe": "listen to events emitted by other plugins",
	"hooks.emit": "emit events that other plugins can react to",

	// scheduler.<action>
	"scheduler.cron": "run tasks automatically on a schedule",

	// system.<escalation> — HIGH RISK. These reduce or remove the sandbox.
	"system.env": "read the bot's environment variables, which may include secrets and API keys",
	"system.bot-token": "read the bot's Discord login token — enough to fully control the bot account",
	"system.raw-client": "run WITHOUT the sandbox, in the bot's main process, with unrestricted access to the bot, your server, and the host machine",

	// Composite / non-list permissions (filled with placeholders).
	"filesystem.read": "read files in: {paths}",
	"filesystem.write": "modify or delete files in: {paths}",
	"network.outbound": "send data from your server to: {hosts}",
	"process.persistent": "run continuously in the background ({reason})",
	"childProcess": "launch other programs on the host machine",
	"nativeAddons": "load native code extensions on the host machine",

	// Legacy flat-list permission keys (the format every registry-published
	// plugin ships: permissions: ["db.read", ...]).
	"commands.register": "register slash commands in your server",
	"events.register": "receive your server's events (messages, member joins, moderation, …)",
};

// Legacy flat key → [v2 category, value] for keys whose power is already
// described by an existing v2 facet.
const FLAT_PERMISSIONS_MAP = {
	"db.read": ["storage", "own-collection"],
	"db.write": ["storage", "own-collection"],
	"messages.read": ["discord", "ReadMessageHistory"],
	"manageWebhooks": ["discord", "ManageWebhooks"],
};

/**
 * Registry entries and legacy plugins ship `permissions: ["db.read", ...]` —
 * a flat string list, not the nested v2 manifest shape the generator reads.
 * Build the v2 shape from it. Keys with an existing facet are mapped; keys
 * with their own template pass through verbatim; anything else is kept so
 * generateRiskCard's UnmappedCapabilityError fails loud instead of silently
 * showing a reassuringly-empty card.
 *
 * @param {object} entry - registry entry or plugin.json with flat permissions
 * @returns {object} v2-shaped pseudo-manifest
 */
function manifestFromFlatPermissions(entry) {
	const perm = {
		discord: [],
		storage: [],
		ai: [],
		hooks: [],
		scheduler: [],
		system: [],
		network: { outbound: [] },
		filesystem: { read: [], write: [] },
		childProcess: false,
		nativeAddons: false,
	};
	const direct = [];
	for (const key of Array.isArray(entry?.permissions) ? entry.permissions : []) {
		const mapped = FLAT_PERMISSIONS_MAP[key];
		if (mapped && !perm[mapped[0]].includes(mapped[1])) perm[mapped[0]].push(mapped[1]);
		else if (mapped) continue; // already mapped — one statement is enough
		else {
			// v2-style "category.Value" keys (e.g. discord.ManageChannels) route
			// into the category list so the withheld facets see them too.
			const dot = key.indexOf(".");
			const category = dot > 0 ? key.slice(0, dot) : null;
			if (category && Array.isArray(perm[category])) {
				const value = key.slice(dot + 1);
				if (!perm[category].includes(value)) perm[category].push(value);
			} else {
				direct.push(key);
			}
		}
	}
	return { ...entry, manifestVersion: 2, permissions: perm, _flatDirect: direct };
}

/**
 * Adapt any manifest: nested v2 manifests pass through untouched; flat
 * permission lists are converted. Returns null if there is nothing to go on.
 *
 * @param {object} manifest - raw manifest or registry entry
 * @returns {object|null} v2-shaped manifest
 */
function riskCardManifest(manifest) {
	if (!manifest) return null;
	if (Array.isArray(manifest.permissions)) return manifestFromFlatPermissions(manifest);
	return manifest;
}

// Negative-disclosure facets — the "does NOT have access to" list. Each facet is
// a category of power a server owner cares about, with a predicate over the
// normalized permissions: if the predicate is false, the facet is WITHHELD and
// its withheld-label is shown. This is what turns the risk card from legal cover
// into real information — the user sees the boundary, not just the grant.
//
// Order is stable and user-facing. "other plugins' data" is always withheld
// (per-plugin storage isolation is structural), so it has no predicate.
const WITHHELD_FACETS = [
	{
		label: "run outside its sandbox with full access to the bot and host machine",
		granted: (perm) => perm.system.includes("raw-client"),
	},
	{
		label: "read the bot's environment variables or login token",
		granted: (perm) =>
			perm.system.includes("env") ||
			perm.system.includes("bot-token") ||
			perm.system.includes("raw-client"),
	},
	{
		label: "manage your server's members (ban, kick, or timeout)",
		granted: (perm) =>
			["BanMembers", "KickMembers", "ModerateMembers", "MoveMembers"].some((p) => perm.discord.includes(p)),
	},
	{
		label: "manage your server's roles",
		granted: (perm) => perm.discord.includes("ManageRoles"),
	},
	{
		label: "manage your server's channels",
		granted: (perm) => perm.discord.includes("ManageChannels"),
	},
	{
		label: "change your server's settings",
		granted: (perm) => perm.discord.includes("ManageGuild"),
	},
	{
		label: "read your server's message history",
		granted: (perm) => perm.discord.includes("ReadMessageHistory"),
	},
	{
		label: "read or modify member profiles (XP, levels, warnings)",
		granted: (perm) =>
			perm.storage.includes("read-profiles") || perm.storage.includes("write-profiles"),
	},
	{
		label: "read or write files on the host machine",
		granted: (perm) => perm.filesystem.read.length > 0 || perm.filesystem.write.length > 0,
	},
	{
		label: "send data anywhere on the internet",
		granted: (perm) => perm.network.outbound.length > 0,
	},
	{
		label: "any other plugin's data",
		granted: () => false, // per-plugin storage is always isolated
	},
];

/** Fill {token} placeholders in a template string. */
function fill(template, vars = {}) {
	return template.replace(/\{(\w+)\}/g, (_, key) =>
		Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{${key}}`,
	);
}

/**
 * Error thrown when a manifest declares a capability that has no risk template.
 * Callers (submission/approval) should treat this as a hard block.
 */
class UnmappedCapabilityError extends Error {
	constructor(keys) {
		super(`No risk-disclosure template for: ${keys.join(", ")}. Add a template before approving.`);
		this.name = "UnmappedCapabilityError";
		this.unmapped = keys;
	}
}

/**
 * Generate the ordered list of risk statements for a manifest.
 *
 * @param {object} manifest - Raw or normalized v2 manifest
 * @returns {string[]} plain-language statements, rendered as a bullet list
 * @throws {UnmappedCapabilityError} if any declared capability lacks a template
 */
function generateRiskCard(manifest) {
	const m = normalize(manifest);
	const perm = m.permissions;
	const statements = [];
	const unmapped = [];

	const push = (key, vars) => {
		const template = RISK_TEMPLATES[key];
		if (template === undefined) {
			unmapped.push(key);
			return;
		}
		statements.push(vars ? fill(template, vars) : template);
	};

	// List-backed permission categories, in a stable order.
	for (const value of perm.discord) push(`discord.${value}`);
	for (const value of perm.storage) push(`storage.${value}`);
	for (const value of perm.ai) push(`ai.${value}`);
	for (const value of perm.hooks) push(`hooks.${value}`);
	for (const value of perm.scheduler) push(`scheduler.${value}`);
	for (const value of perm.system) push(`system.${value}`);

	// Composite permissions.
	if (perm.filesystem.read.length) {
		push("filesystem.read", { paths: perm.filesystem.read.join(", ") });
	}
	if (perm.filesystem.write.length) {
		push("filesystem.write", { paths: perm.filesystem.write.join(", ") });
	}
	if (perm.network.outbound.length) {
		push("network.outbound", { hosts: perm.network.outbound.join(", ") });
	}
	if (m.process.model === "persistent") {
		push("process.persistent", { reason: m.process.persistentReason || "no reason given" });
	}
	if (perm.childProcess) push("childProcess");
	if (perm.nativeAddons) push("nativeAddons");

	// Keys carried over from a legacy flat permission list (see
	// manifestFromFlatPermissions) that have their own template.
	for (const key of m._flatDirect || []) push(key);

	if (unmapped.length) {
		throw new UnmappedCapabilityError(unmapped);
	}

	return statements;
}

/**
 * Generate the "does NOT have access to" list for a manifest.
 *
 * A facet appears here exactly when its `granted` predicate is false against the
 * manifest's permissions — i.e. the power exists in the platform but this plugin
 * wasn't given it. Seeing the withheld boundary alongside the grants is what lets
 * a server owner calibrate trust instead of assuming the worst or clicking blind.
 *
 * @param {object} manifest - Raw or normalized v2 manifest
 * @returns {string[]} plain-language "cannot" statements, stable order
 */
function generateWithheld(manifest) {
	const m = normalize(manifest);
	const perm = m.permissions;
	// Full host access bypasses every broker restriction; do not promise otherwise.
	if (perm.system.includes("raw-client")) return [];
	return WITHHELD_FACETS.filter((f) => !f.granted(perm)).map((f) => f.label);
}

/**
 * Full install-screen disclosure: what the plugin CAN do (grants) and what it
 * explicitly can NOT (withheld). This is the shape Journey 2 renders.
 *
 * @param {object} manifest - Raw or normalized v2 manifest
 * @returns {{ granted: string[], withheld: string[] }}
 * @throws {UnmappedCapabilityError} if any declared capability lacks a template
 */
function generateFullRiskCard(manifest) {
	return {
		granted: generateRiskCard(manifest),
		withheld: generateWithheld(manifest),
	};
}

/**
 * Diff two manifests' risk cards — used on version bumps to show the installing
 * user exactly what a new version adds (or drops), not just "update available".
 *
 * @param {object} prevManifest - Previously approved manifest
 * @param {object} nextManifest - New version's manifest
 * @returns {{ added: string[], removed: string[], changed: boolean }}
 */
function diffRiskCards(prevManifest, nextManifest) {
	const prev = generateRiskCard(prevManifest);
	const next = generateRiskCard(nextManifest);
	const prevSet = new Set(prev);
	const nextSet = new Set(next);
	const added = next.filter((s) => !prevSet.has(s));
	const removed = prev.filter((s) => !nextSet.has(s));
	return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

module.exports = {
	RISK_TEMPLATES,
	WITHHELD_FACETS,
	UnmappedCapabilityError,
	manifestFromFlatPermissions,
	riskCardManifest,
	generateRiskCard,
	generateWithheld,
	generateFullRiskCard,
	diffRiskCards,
	fill,
};
