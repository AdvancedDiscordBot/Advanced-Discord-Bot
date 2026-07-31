/**
 * permission-resolver.js — who can do what, in which guild.
 *
 * Discord OAuth tells us who someone is. This module decides what that means
 * for a given guild, deriving a tier and a permission set on every request
 * rather than trusting a snapshot taken at login time (a user demoted in
 * Discord must lose dashboard access without having to log out).
 *
 * Tiers:
 *   HOST_OWNER  — listed in OWNER_IDS. The person running the bot. Sole
 *                 authority for installing/uninstalling plugins. Implicitly
 *                 holds every dashboard permission in every guild.
 *   GUILD_ADMIN — guild owner, or has ADMINISTRATOR / MANAGE_GUILD in that
 *                 guild. Holds every dashboard permission for THAT guild,
 *                 which includes enabling/disabling plugins for their server
 *                 but never installing or uninstalling.
 *   MEMBER      — in the guild, with the union of the permissions granted to
 *                 their roles via GuildRoleGrant. Usually empty.
 *   NONE        — not in the guild (or the bot isn't). 403.
 *
 * Results are cached per (userId, guildId) for a short TTL so a dashboard page
 * that makes a dozen API calls doesn't make a dozen member lookups. The cache
 * is invalidated eagerly on role changes and on grant edits.
 */

const { catalogKeys } = require("./dashboard-permissions");

const TIERS = {
	HOST_OWNER: "HOST_OWNER",
	GUILD_ADMIN: "GUILD_ADMIN",
	MEMBER: "MEMBER",
	NONE: "NONE",
};

const ADMINISTRATOR = 1n << 3n; // 0x8
const MANAGE_GUILD = 1n << 5n; // 0x20

const DEFAULT_TTL_MS = 60 * 1000;

function parseOwnerIds() {
	return (process.env.OWNER_IDS || "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

/**
 * True if a fetched GuildMember holds ADMINISTRATOR or MANAGE_GUILD.
 * Reads the raw bitfield so this works against both real discord.js members
 * and plain test doubles.
 */
function hasAdminPermissions(member) {
	const permissions = member?.permissions;
	if (!permissions) return false;

	// discord.js PermissionsBitField
	if (typeof permissions.has === "function") {
		try {
			if (permissions.has(ADMINISTRATOR) || permissions.has(MANAGE_GUILD)) {
				return true;
			}
		} catch {
			// Fall through to the raw bitfield read below.
		}
	}

	const raw =
		permissions.bitfield !== undefined ? permissions.bitfield : permissions;
	if (typeof raw === "bigint") {
		return (raw & ADMINISTRATOR) !== 0n || (raw & MANAGE_GUILD) !== 0n;
	}
	if (typeof raw === "number" || typeof raw === "string") {
		try {
			const bits = BigInt(raw);
			return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_GUILD) !== 0n;
		} catch {
			return false;
		}
	}
	return false;
}

/** Role IDs on a member, tolerating both discord.js shapes and plain arrays. */
function roleIdsOf(member) {
	const roles = member?.roles;
	if (!roles) return [];
	if (Array.isArray(roles)) return roles;
	if (roles.cache && typeof roles.cache.keys === "function") {
		return Array.from(roles.cache.keys());
	}
	if (Array.isArray(roles.cache)) return roles.cache.map((r) => r.id || r);
	return [];
}

class PermissionResolver {
	constructor({ client, db, pluginManager, ttlMs = DEFAULT_TTL_MS, logger }) {
		this.client = client;
		this.db = db;
		this.pluginManager = pluginManager;
		this.ttlMs = ttlMs;
		this.logger = logger;
		this.cache = new Map(); // "userId:guildId" → { expiresAt, result }
	}

	// ── cache ────────────────────────────────────────────────────────────────

	static cacheKey(userId, guildId) {
		return `${userId}:${guildId}`;
	}

	invalidate(userId, guildId) {
		this.cache.delete(PermissionResolver.cacheKey(userId, guildId));
	}

	invalidateGuild(guildId) {
		const suffix = `:${guildId}`;
		for (const key of this.cache.keys()) {
			if (key.endsWith(suffix)) this.cache.delete(key);
		}
	}

	invalidateAll() {
		this.cache.clear();
	}

	/**
	 * Drop cached results when Discord-side state changes underneath us: a
	 * member's roles change, they leave, or a role's permissions are edited.
	 */
	watch(client = this.client) {
		if (!client || typeof client.on !== "function") return;

		client.on("guildMemberUpdate", (_old, member) => {
			this.invalidate(member?.id, member?.guild?.id);
		});
		client.on("guildMemberRemove", (member) => {
			this.invalidate(member?.id, member?.guild?.id);
		});
		// A role's permissions or a role deletion can change every member's
		// effective access, so blow away the whole guild.
		client.on("roleUpdate", (_old, role) => {
			this.invalidateGuild(role?.guild?.id);
		});
		client.on("roleDelete", (role) => {
			this.invalidateGuild(role?.guild?.id);
		});
	}

	// ── resolution ───────────────────────────────────────────────────────────

	/** Every permission key currently defined, across core + loaded plugins. */
	allPermissions() {
		const plugins = this.pluginManager?.plugins
			? Array.from(this.pluginManager.plugins.values())
			: [];
		return catalogKeys(plugins);
	}

	isHostOwner(userId) {
		return !!userId && parseOwnerIds().includes(userId);
	}

	/**
	 * Resolve a user's access to one guild.
	 *
	 * @param {string} userId
	 * @param {string} guildId
	 * @returns {Promise<{tier: string, permissions: Set<string>, guildId: string}>}
	 */
	async resolve(userId, guildId) {
		if (!userId || !guildId) {
			return { tier: TIERS.NONE, permissions: new Set(), guildId };
		}

		const key = PermissionResolver.cacheKey(userId, guildId);
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.result;
		}

		const result = await this._resolveUncached(userId, guildId);
		this.cache.set(key, { expiresAt: Date.now() + this.ttlMs, result });
		return result;
	}

	async _resolveUncached(userId, guildId) {
		// Host owner short-circuits: no guild membership required at all, so the
		// owner can administer a server they haven't joined.
		if (this.isHostOwner(userId)) {
			return {
				tier: TIERS.HOST_OWNER,
				permissions: this.allPermissions(),
				guildId,
			};
		}

		const guild = this.client?.guilds?.cache?.get(guildId);
		if (!guild) {
			return { tier: TIERS.NONE, permissions: new Set(), guildId };
		}

		const member = await this._fetchMember(guild, userId);
		if (!member) {
			return { tier: TIERS.NONE, permissions: new Set(), guildId };
		}

		if (guild.ownerId === userId || hasAdminPermissions(member)) {
			return {
				tier: TIERS.GUILD_ADMIN,
				permissions: this.allPermissions(),
				guildId,
			};
		}

		const permissions = await this._grantedPermissions(
			guildId,
			roleIdsOf(member),
		);
		return { tier: TIERS.MEMBER, permissions, guildId };
	}

	/** Member from cache, falling back to a REST fetch. */
	async _fetchMember(guild, userId) {
		const cached = guild.members?.cache?.get(userId);
		if (cached) return cached;
		try {
			return await guild.members.fetch(userId);
		} catch {
			// Not a member, or the fetch failed. Either way: no access.
			return null;
		}
	}

	/** Union of the grants attached to the member's roles. */
	async _grantedPermissions(guildId, roleIds) {
		const permissions = new Set();
		if (roleIds.length === 0) return permissions;

		try {
			const grants = await this.db.getGuildRoleGrants(guildId);
			const roleSet = new Set(roleIds);
			for (const grant of grants) {
				if (!roleSet.has(grant.roleId)) continue;
				for (const permission of grant.permissions || []) {
					permissions.add(permission);
				}
			}
		} catch (error) {
			// Fail closed: a DB blip must not hand out permissions.
			this.logger?.warn?.(
				`Failed to load role grants for guild ${guildId}: ${error.message}`,
			);
		}

		return permissions;
	}

	/**
	 * Convenience check used by route guards.
	 *
	 * @returns {Promise<{allowed: boolean, tier: string, permissions: Set<string>}>}
	 */
	async check(userId, guildId, permission) {
		const resolved = await this.resolve(userId, guildId);
		const allowed =
			resolved.tier !== TIERS.NONE &&
			(!permission || resolved.permissions.has(permission));
		return { ...resolved, allowed };
	}
}

module.exports = {
	PermissionResolver,
	TIERS,
	parseOwnerIds,
	hasAdminPermissions,
	roleIdsOf,
};
