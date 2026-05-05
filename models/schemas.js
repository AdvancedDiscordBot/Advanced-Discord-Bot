const mongoose = require("mongoose");

// 🏰 Server Configuration Schema
const serverConfigSchema = new mongoose.Schema(
	{
		guildId: {
			type: String,
			required: true,
			unique: true,
		},
		// AI Assistant Config
		aiEnabled: {
			type: Boolean,
			default: false,
		},
		aiContext: {
			type: String,
			default: "",
		},
		aiChannels: [
			{
				type: String,
			},
		],
		aiMode: {
			type: String,
			enum: ["disabled", "context", "auto", "hybrid"],
			default: "disabled",
		},
		// Ticket System Config
		ticketCategoryId: String,
		ticketLogChannelId: String,
		// XP & Role System Config
		xpEnabled: {
			type: Boolean,
			default: true,
		},
		xpPerMessage: {
			type: Number,
			default: 1,
		},
		xpPerVoiceMinute: {
			type: Number,
			default: 2,
		},
		roleAutomation: {
			type: Boolean,
			default: false,
		},
		roleRewards: [
			{
				roleName: String,
				roleId: String,
				xpThreshold: Number,
				topRank: Number, // for top N users
			},
		],
		// Tracking Settings
		trackingChannels: [
			{
				type: String,
			},
		],
		excludeChannels: [
			{
				type: String,
			},
		],
		// Birthday System Config
		birthdayEnabled: {
			type: Boolean,
			default: false,
		},
		birthdayChannelId: String,
		birthdayRoleId: String,
	},
	{
		timestamps: true,
	},
);

// 👤 User Profile Schema
const userProfileSchema = new mongoose.Schema(
	{
		userId: {
			type: String,
			required: true,
		},
		guildId: {
			type: String,
			required: true,
		},
		// Basic Info
		username: String,
		discriminator: String,
		joinedAt: Date,
		// Economy
		wallet: {
			type: Number,
			default: 0,
		},
		bank: {
			type: Number,
			default: 0,
		},
		inventory: [
			{
				type: String, // This will store the roleId of purchased items
			},
		],
		collectCooldowns: {
			type: Map,
			of: Date,
			default: {},
		},
		// XP & Activity
		totalXp: {
			type: Number,
			default: 0,
		},
		level: {
			type: Number,
			default: 1,
		},
		messageCount: {
			type: Number,
			default: 0,
		},
		voiceMinutes: {
			type: Number,
			default: 0,
		},
		lastMessageAt: Date,
		lastVoiceAt: Date,
		// Moderation
		warnings: {
			type: Number,
			default: 0,
		},
		bans: {
			type: Number,
			default: 0,
		},
		kicks: {
			type: Number,
			default: 0,
		},
		// Activity Score
		activityScore: {
			type: Number,
			default: 0,
		},
		// Points System
		points: {
			type: Number,
			default: 0,
		},
		pointsGiven: {
			type: Number,
			default: 0,
		},
		pointsReceived: {
			type: Number,
			default: 0,
		},
		lastDailyPoints: {
			type: Date,
			default: null,
		},
		dailyStreak: {
			type: Number,
			default: 0,
		},
		// Rewards
		currentRoles: [
			{
				roleId: String,
				roleName: String,
				earnedAt: {
					type: Date,
					default: Date.now,
				},
			},
		],
		// Statistics
		dailyXp: {
			type: Number,
			default: 0,
		},
		weeklyXp: {
			type: Number,
			default: 0,
		},
		monthlyXp: {
			type: Number,
			default: 0,
		},
		lastDailyReset: {
			type: Date,
			default: Date.now,
		},
		lastWeeklyReset: {
			type: Date,
			default: Date.now,
		},
		lastMonthlyReset: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true,
	},
);

// 🎫 Ticket Schema
const ticketSchema = new mongoose.Schema(
	{
		guildId: {
			type: String,
			required: true,
		},
		channelId: {
			type: String,
			required: true,
		},
		userId: {
			type: String,
			required: true,
		},
		moderatorId: String,
		title: {
			type: String,
			required: true,
		},
		description: String,
		status: {
			type: String,
			enum: ["open", "in_progress", "waiting", "closed", "resolved"],
			default: "open",
		},
		priority: {
			type: String,
			enum: ["low", "medium", "high"],
			default: "medium",
		},
		messages: [
			{
				userId: String,
				message: String,
				attachmentUrl: String,
				timestamp: {
					type: Date,
					default: Date.now,
				},
			},
		],
		closedAt: Date,
	},
	{
		timestamps: true,
	},
);

// 🤖 AI Rate Limiting Schema
const aiRateLimitSchema = new mongoose.Schema(
	{
		userId: {
			type: String,
			required: true,
		},
		guildId: {
			type: String,
			required: true,
		},
		requestCount: {
			type: Number,
			default: 1,
		},
		lastRequest: {
			type: Date,
			default: Date.now,
		},
		resetAt: {
			type: Date,
			default: () => new Date(Date.now() + 3600000), // 1 hour from now
		},
	},
	{
		timestamps: true,
	},
);

// 📊 XP Transaction Schema (for detailed tracking)
const xpTransactionSchema = new mongoose.Schema(
	{
		userId: {
			type: String,
			required: true,
		},
		guildId: {
			type: String,
			required: true,
		},
		amount: {
			type: Number,
			required: true,
		},
		type: {
			type: String,
			enum: ["message", "voice", "bonus", "penalty", "manual"],
			required: true,
		},
		reason: String,
		moderatorId: String,
	},
	{
		timestamps: true,
	},
);

// 🏆 Leaderboard Cache Schema
const leaderboardSchema = new mongoose.Schema(
	{
		guildId: {
			type: String,
			required: true,
			unique: true,
		},
		topUsers: [
			{
				userId: String,
				username: String,
				totalXp: Number,
				level: Number,
				rank: Number,
			},
		],
		lastUpdated: {
			type: Date,
			default: Date.now,
		},
	},
	{
		timestamps: true,
	},
);

// 🎂 Birthday Schema
const birthdaySchema = new mongoose.Schema(
	{
		userId: {
			type: String,
			required: true,
		},
		guildId: {
			type: String,
			required: true,
		},
		birthdayDate: {
			type: Date,
			required: true,
		},
		timezone: {
			type: String,
			default: "UTC",
		},
		isPrivate: {
			type: Boolean,
			default: false,
		},
		lastCelebrated: {
			type: Date,
		},
		celebrationCount: {
			type: Number,
			default: 0,
		},
	},
	{
		timestamps: true,
	},
);

// 🎮 Truth or Dare Configuration Schema
const truthOrDareConfigSchema = new mongoose.Schema(
	{
		guildId: {
			type: String,
			required: true,
			unique: true,
		},
		enabled: {
			type: Boolean,
			default: true,
		},
		allowedChannels: [
			{
				type: String,
			},
		],
		customTruths: [
			{
				text: String,
				addedBy: String,
				addedAt: {
					type: Date,
					default: Date.now,
				},
			},
		],
		customDares: [
			{
				text: String,
				addedBy: String,
				addedAt: {
					type: Date,
					default: Date.now,
				},
			},
		],
		moderationEnabled: {
			type: Boolean,
			default: true,
		},
		cooldownTime: {
			type: Number,
			default: 5, // seconds
		},
	},
	{
		timestamps: true,
	},
);

// 🧩 Plugin Configuration Schema
const pluginConfigSchema = new mongoose.Schema(
	{
		guildId: {
			type: String,
			required: true,
		},
		pluginName: {
			type: String,
			required: true,
		},
		data: {
			type: mongoose.Schema.Types.Mixed,
			default: {},
		},
	},
	{
		timestamps: true,
	},
);

// 🛡️ Anti-Raid Configuration Schema
const antiRaidSchema = new mongoose.Schema(
	{
		guildId: {
			type: String,
			required: true,
			unique: true,
		},
		enabled: {
			type: Boolean,
			default: false,
		},
		joinThreshold: {
			type: Number,
			default: 5, // max joins per timeWindow
		},
		timeWindow: {
			type: Number,
			default: 10, // seconds
		},
		action: {
			type: String,
			enum: ["kick", "ban", "mute"],
			default: "kick",
		},
		alertChannel: String,
		whitelist: [
			{
				type: String, // user IDs that are exempt
			},
		],
		suspiciousJoins: [
			{
				userId: String,
				joinedAt: {
					type: Date,
					default: Date.now,
				},
			},
		],
		raidDetections: [
			{
				detectedAt: {
					type: Date,
					default: Date.now,
				},
				usersAffected: [String],
				actionTaken: String,
			},
		],
	},
	{
		timestamps: true,
	},
);

// ⚙️ Guild Economy Schema
const guildEconomySchema = new mongoose.Schema({
	guildId: {
		type: String,
		required: true,
		unique: true,
	},
	minWorkAmount: { type: Number, default: 50 }, // New: Minimum work amount
	maxWorkAmount: { type: Number, default: 250 }, // New: Maximum work amount
	workCooldown: {
		type: Number,
		default: 3600, // Default cooldown in seconds (1 hour)
	},
});

// 🛍️ Shop Item Schema
const shopItemSchema = new mongoose.Schema({
	guildId: {
		type: String,
		required: true,
	},
	roleId: {
		type: String,
		required: true,
		unique: true,
	},
	name: {
		type: String,
		required: true,
	},
	price: {
		type: Number,
		required: true,
	},
	itemType: {
		type: String,
		enum: ["cosmetic", "income"],
		required: true,
	},
	incomeAmount: {
		type: Number,
		default: 0,
	},
	incomeCooldown: {
		type: Number, // Cooldown in seconds
		default: 0,
	},
});

// Create compound indexes for better query performance
userProfileSchema.index({ userId: 1, guildId: 1 }, { unique: true });
userProfileSchema.index({ guildId: 1, totalXp: -1 });
userProfileSchema.index({ guildId: 1, activityScore: -1 });
ticketSchema.index({ guildId: 1, status: 1 });
aiRateLimitSchema.index({ userId: 1, guildId: 1 }, { unique: true });
xpTransactionSchema.index({ userId: 1, guildId: 1, createdAt: -1 });
birthdaySchema.index({ userId: 1, guildId: 1 }, { unique: true });
birthdaySchema.index({ guildId: 1, birthdayDate: 1 });
shopItemSchema.index({ guildId: 1, name: 1 }, { unique: true });
pluginConfigSchema.index({ guildId: 1, pluginName: 1 }, { unique: true });
// Note: serverConfig, leaderboard, truthOrDareConfig, and antiRaid schemas
// already have unique: true on guildId, so no additional index needed

module.exports = {
	ServerConfig: mongoose.model("ServerConfig", serverConfigSchema),
	UserProfile: mongoose.model("UserProfile", userProfileSchema),
	Ticket: mongoose.model("Ticket", ticketSchema),
	AIRateLimit: mongoose.model("AIRateLimit", aiRateLimitSchema),
	XPTransaction: mongoose.model("XPTransaction", xpTransactionSchema),
	Leaderboard: mongoose.model("Leaderboard", leaderboardSchema),
	Birthday: mongoose.model("Birthday", birthdaySchema),
	GuildEconomy: mongoose.model("GuildEconomy", guildEconomySchema),
	ShopItem: mongoose.model("ShopItem", shopItemSchema),
	TruthOrDareConfig: mongoose.model(
		"TruthOrDareConfig",
		truthOrDareConfigSchema,
	),
	PluginConfig: mongoose.model("PluginConfig", pluginConfigSchema),
	AntiRaid: mongoose.model("AntiRaid", antiRaidSchema),
};
