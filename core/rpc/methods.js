/**
 * methods.js — RPC method catalog.
 *
 * Maps every RPC method name to:
 *   - capability: the capability required to call it (category:value)
 *   - handler:    the name of the actual implementation function in the broker
 *   - description: human-readable description for docs/UI
 *
 * The broker checks capabilities before executing. If a plugin hasn't
 * declared the required capability in its manifest, the call is denied.
 */

const RPC_METHODS = {
	// ── Database: Plugin Config (own-collection) ────────────────────────
	"db.getPluginConfig": {
		capability: "storage:own-collection",
		handler: "getPluginConfig",
		description: "Read this plugin's per-guild configuration",
	},
	"db.updatePluginConfig": {
		capability: "storage:own-collection",
		handler: "updatePluginConfig",
		description: "Write this plugin's per-guild configuration",
	},
	"db.getAllPluginConfigs": {
		capability: "storage:own-collection",
		handler: "getAllPluginConfigs",
		description: "Read all plugin configs for a guild",
	},

	// ── Database: User Profiles (read-profiles) ─────────────────────────
	"db.getUserProfile": {
		capability: "storage:read-profiles",
		handler: "getUserProfile",
		description: "Read a user's profile (XP, level, warnings, etc.)",
	},
	"db.getTopUsers": {
		capability: "storage:read-profiles",
		handler: "getTopUsers",
		description: "Get top users by XP or other metric",
	},
	"db.getUserRank": {
		capability: "storage:read-profiles",
		handler: "getUserRank",
		description: "Get a user's rank in the guild",
	},
	"db.checkRoleRewards": {
		capability: "storage:read-profiles",
		handler: "checkRoleRewards",
		description: "Check which role rewards a user is eligible for",
	},
	"db.getServerConfig": {
		capability: "storage:read-profiles",
		handler: "getServerConfig",
		description: "Read guild server configuration",
	},
	"db.getServerStats": {
		capability: "storage:read-profiles",
		handler: "getServerStats",
		description: "Get aggregate guild statistics",
	},
	"db.getUserPoints": {
		capability: "storage:read-profiles",
		handler: "getUserPoints",
		description: "Get a user's points balance",
	},
	"db.getPointsLeaderboard": {
		capability: "storage:read-profiles",
		handler: "getPointsLeaderboard",
		description: "Get the points leaderboard for a guild",
	},

	// ── Database: User Profiles (write-profiles) ────────────────────────
	"db.updateUserProfile": {
		capability: "storage:write-profiles",
		handler: "updateUserProfile",
		description: "Update a user's profile data",
	},
	"db.addXP": {
		capability: "storage:write-profiles",
		handler: "addXP",
		description: "Award XP to a user (message, voice, bonus, etc.)",
	},
	"db.updateUserRoles": {
		capability: "storage:write-profiles",
		handler: "updateUserRoles",
		description: "Update a user's earned roles",
	},
	"db.givePoints": {
		capability: "storage:write-profiles",
		handler: "givePoints",
		description: "Transfer points between users",
	},
	"db.updateServerConfig": {
		capability: "storage:write-profiles",
		handler: "updateServerConfig",
		description: "Update guild server configuration",
	},

	// ── Database: Tickets ───────────────────────────────────────────────
	"db.createTicket": {
		capability: "storage:own-collection",
		handler: "createTicket",
		description: "Create a new support ticket",
	},
	"db.getTickets": {
		capability: "storage:own-collection",
		handler: "getTickets",
		description: "List tickets for a guild",
	},
	"db.getTicketById": {
		capability: "storage:own-collection",
		handler: "getTicketById",
		description: "Get a ticket by ID",
	},
	"db.updateTicket": {
		capability: "storage:own-collection",
		handler: "updateTicket",
		description: "Update a ticket",
	},
	"db.updateTicketStatus": {
		capability: "storage:own-collection",
		handler: "updateTicketStatus",
		description: "Change ticket status (open, in_progress, closed)",
	},

	// ── Discord Actions ─────────────────────────────────────────────────
	"discord.sendMessage": {
		capability: "discord:SendMessages",
		handler: "discordSendMessage",
		description: "Send a simple text message to a channel",
	},
	"discord.sendEmbed": {
		capability: "discord:EmbedLinks",
		handler: "discordSendEmbed",
		description: "Send an embed to a channel",
	},
	"discord.sendRichMessage": {
		capability: "discord:SendMessages",
		handler: "discordSendRichMessage",
		description: "Send a message with content, embeds, and file attachments to a channel",
	},
	"discord.sendDM": {
		capability: "discord:SendMessages",
		handler: "discordSendDM",
		description: "Send a DM with content, embeds, and file attachments to a user",
	},
	"discord.addReaction": {
		capability: "discord:AddReactions",
		handler: "discordAddReaction",
		description: "Add a reaction to a message",
	},
	"discord.deleteMessage": {
		capability: "discord:ManageMessages",
		handler: "discordDeleteMessage",
		description: "Delete a message from a channel",
	},
	"discord.timeout": {
		capability: "discord:ModerateMembers",
		handler: "discordTimeout",
		description: "Timeout a member",
	},
	"discord.kick": {
		capability: "discord:KickMembers",
		handler: "discordKick",
		description: "Kick a member from the server",
	},
	"discord.ban": {
		capability: "discord:BanMembers",
		handler: "discordBan",
		description: "Ban a member from the server",
	},

	// ── Discord Lookups ─────────────────────────────────────────────────
	"discord.getGuild": {
		capability: "discord:GuildInfo",
		handler: "discordGetGuild",
		description: "Fetch guild information by ID",
	},
	"discord.getMember": {
		capability: "discord:GuildInfo",
		handler: "discordGetMember",
		description: "Fetch a guild member by ID",
	},
	"discord.fetchChannel": {
		capability: "discord:ChannelInfo",
		handler: "discordFetchChannel",
		description: "Fetch a channel by ID",
	},
	"discord.addRole": {
		capability: "discord:ManageRoles",
		handler: "discordAddRole",
		description: "Add a role to a member",
	},
	"discord.removeRole": {
		capability: "discord:ManageRoles",
		handler: "discordRemoveRole",
		description: "Remove a role from a member",
	},

	// ── Hook Actions ────────────────────────────────────────────────────
	"hooks.emit": {
		capability: "hooks:emit",
		handler: "hooksEmit",
		description: "Emit a hook event for other plugins to listen to",
	},
	"hooks.on": {
		capability: "hooks:subscribe",
		handler: "hooksOn",
		description: "Subscribe to a hook event from other plugins",
	},

	// ── Plugin-Scoped Model CRUD ───────────────────────────────────────
	"model.find": {
		capability: "storage:own-collection",
		handler: "modelFind",
		description: "Find documents in a plugin-scoped model",
	},
	"model.findOne": {
		capability: "storage:own-collection",
		handler: "modelFindOne",
		description: "Find one document in a plugin-scoped model",
	},
	"model.create": {
		capability: "storage:own-collection",
		handler: "modelCreate",
		description: "Create a document in a plugin-scoped model",
	},
	"model.updateOne": {
		capability: "storage:own-collection",
		handler: "modelUpdateOne",
		description: "Update one document in a plugin-scoped model",
	},
	"model.deleteOne": {
		capability: "storage:own-collection",
		handler: "modelDeleteOne",
		description: "Delete one document in a plugin-scoped model",
	},
	"model.countDocuments": {
		capability: "storage:own-collection",
		handler: "modelCountDocuments",
		description: "Count documents in a plugin-scoped model",
	},
	"model.save": {
		capability: "storage:own-collection",
		handler: "modelSave",
		description: "Save a document (after mutations) in a plugin-scoped model",
	},
	"model.markModified": {
		capability: "storage:own-collection",
		handler: "modelMarkModified",
		description: "Mark a Mixed field as modified for proper save",
	},

	// ── Scheduler ───────────────────────────────────────────────────────
	"scheduler.schedule": {
		capability: "scheduler:cron",
		handler: "schedulerSchedule",
		description: "Schedule a recurring task with a cron expression",
	},
	"scheduler.cancel": {
		capability: "scheduler:cron",
		handler: "schedulerCancel",
		description: "Cancel a scheduled task",
	},
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Get the method definition for an RPC method name.
 * @param {string} method
 * @returns {object|null}
 */
function getMethodDef(method) {
	return RPC_METHODS[method] || null;
}

/**
 * Check if a method name is valid.
 * @param {string} method
 * @returns {boolean}
 */
function isValidMethod(method) {
	return method in RPC_METHODS;
}

/**
 * List all available methods (for docs/UI).
 * @returns {{ method: string, capability: string, description: string }[]}
 */
function listMethods() {
	return Object.entries(RPC_METHODS).map(([method, def]) => ({
		method,
		capability: def.capability,
		description: def.description,
	}));
}

module.exports = {
	RPC_METHODS,
	getMethodDef,
	isValidMethod,
	listMethods,
};
