const mongoose = require("mongoose");
const {
	ServerConfig,
	UserProfile,
	Ticket,
	AIRateLimit,
	XPTransaction,
	Leaderboard,
	Birthday,
	TruthOrDareConfig,
	AntiRaid,
	GuildEconomy,
	ShopItem,
	PluginConfig,
} = require("../models/schemas");

class Database {
	constructor() {
		// Don't connect in constructor to avoid multiple connections
		this.isConnected = false;

		// Expose models for direct access
		this.ServerConfig = ServerConfig;
		this.UserProfile = UserProfile;
		this.User = UserProfile; // Alias for UserProfile
		this.Ticket = Ticket;
		this.AIRateLimit = AIRateLimit;
		this.XPTransaction = XPTransaction;
		this.Leaderboard = Leaderboard;
		this.Birthday = Birthday;
		this.TruthOrDareConfig = TruthOrDareConfig;
		this.AntiRaid = AntiRaid;
		this.GuildConfig = ServerConfig; // Alias for ServerConfig
		this.GuildEconomy = GuildEconomy;
		this.ShopItem = ShopItem;
		this.PluginConfig = PluginConfig;
	}

	static async getInstance() {
		if (!Database.instance) {
			Database.instance = new Database();
			await Database.instance.connect();
		}
		return Database.instance;
	}

	async connect() {
		if (this.isConnected || mongoose.connection.readyState === 1) {
			return;
		}

		try {
			if (!process.env.MONGODB_URI) {
				throw new Error("MONGODB_URI environment variable is not set");
			}

			await mongoose.connect(process.env.MONGODB_URI);

			this.isConnected = true;
			console.log("🚀 MongoDB connected successfully");
		} catch (error) {
			console.error("❌ MongoDB connection error:", error);
			process.exit(1);
		}
	}

	async ensureConnection() {
		if (!this.isConnected && mongoose.connection.readyState !== 1) {
			await this.connect();
		}
	}

	// 🏰 Server Config Methods
	async getServerConfig(guildId) {
		await this.ensureConnection();
		try {
			let config = await ServerConfig.findOne({ guildId });
			if (!config) {
				config = await ServerConfig.create({ guildId });
			}
			return config;
		} catch (error) {
			console.error("Error getting server config:", error);
			throw error;
		}
	}

	async updateServerConfig(guildId, updateData) {
		await this.ensureConnection();
		try {
			const config = await ServerConfig.findOneAndUpdate(
				{ guildId },
				{ $set: updateData },
				{ upsert: true, new: true },
			);
			return config;
		} catch (error) {
			console.error("Error updating server config:", error);
			throw error;
		}
	}

	// 🧩 Plugin Config Methods
	async getPluginConfig(guildId, pluginName) {
		await this.ensureConnection();
		try {
			let config = await PluginConfig.findOne({ guildId, pluginName });
			if (!config) {
				config = await PluginConfig.create({ guildId, pluginName, data: {} });
			}
			return config;
		} catch (error) {
			console.error("Error getting plugin config:", error);
			throw error;
		}
	}

	async updatePluginConfig(guildId, pluginName, data) {
		await this.ensureConnection();
		try {
			const config = await PluginConfig.findOneAndUpdate(
				{ guildId, pluginName },
				{ $set: { data } },
				{ upsert: true, new: true },
			);
			return config;
		} catch (error) {
			console.error("Error updating plugin config:", error);
			throw error;
		}
	}

	async getAllPluginConfigs(guildId) {
		await this.ensureConnection();
		try {
			return await PluginConfig.find({ guildId }).sort({ pluginName: 1 });
		} catch (error) {
			console.error("Error listing plugin configs:", error);
			throw error;
		}
	}

	// 🎫 Ticket Methods
	async createTicket(ticketData) {
		await this.ensureConnection();
		try {
			const ticket = await Ticket.create(ticketData);
			return ticket;
		} catch (error) {
			console.error("Error creating ticket:", error);
			throw error;
		}
	}

	async getTickets(guildId, status = null) {
		await this.ensureConnection();
		try {
			const query = { guildId };
			if (status) {
				query.status = status;
			}
			const tickets = await Ticket.find(query).sort({ createdAt: -1 });
			return tickets;
		} catch (error) {
			console.error("Error getting tickets:", error);
			throw error;
		}
	}

	async getTicketByChannel(channelId) {
		await this.ensureConnection();
		try {
			const ticket = await Ticket.findOne({ channelId });
			return ticket;
		} catch (error) {
			console.error("Error getting ticket by channel:", error);
			throw error;
		}
	}

	async getTicketById(ticketId) {
		await this.ensureConnection();
		try {
			const ticket = await Ticket.findById(ticketId);
			return ticket;
		} catch (error) {
			console.error("Error getting ticket by ID:", error);
			throw error;
		}
	}

	async updateTicket(ticketId, updateData) {
		await this.ensureConnection();
		try {
			const ticket = await Ticket.findByIdAndUpdate(ticketId, updateData, {
				new: true,
			});
			return ticket;
		} catch (error) {
			console.error("Error updating ticket:", error);
			throw error;
		}
	}

	async updateTicketStatus(ticketId, status, moderatorId = null) {
		await this.ensureConnection();
		try {
			const updateData = { status };
			if (moderatorId) updateData.moderatorId = moderatorId;
			if (status === "closed" || status === "resolved") {
				updateData.closedAt = new Date();
			}

			const ticket = await Ticket.findByIdAndUpdate(ticketId, updateData, {
				new: true,
			});
			return ticket;
		} catch (error) {
			console.error("Error updating ticket status:", error);
			throw error;
		}
	}

	async addTicketMessage(ticketId, userId, message, attachmentUrl = null) {
		await this.ensureConnection();
		try {
			const messageData = {
				userId,
				message,
				attachmentUrl,
				timestamp: new Date(),
			};

			const ticket = await Ticket.findByIdAndUpdate(
				ticketId,
				{ $push: { messages: messageData } },
				{ new: true },
			);
			return ticket;
		} catch (error) {
			console.error("Error adding ticket message:", error);
			throw error;
		}
	}

	// 🤖 AI Rate Limiting Methods
	async checkRateLimit(
		userId,
		guildId,
		maxRequests = 10,
		timeWindow = 3600000,
	) {
		await this.ensureConnection();
		try {
			const now = new Date();
			let rateLimit = await AIRateLimit.findOne({ userId, guildId });

			if (!rateLimit) {
				// First request
				await AIRateLimit.create({
					userId,
					guildId,
					requestCount: 1,
					lastRequest: now,
					resetAt: new Date(now.getTime() + timeWindow),
				});
				return { allowed: true, remaining: maxRequests - 1 };
			}

			const timeDiff = now.getTime() - rateLimit.lastRequest.getTime();

			if (timeDiff > timeWindow || now > rateLimit.resetAt) {
				// Reset counter
				rateLimit.requestCount = 1;
				rateLimit.lastRequest = now;
				rateLimit.resetAt = new Date(now.getTime() + timeWindow);
				await rateLimit.save();
				return { allowed: true, remaining: maxRequests - 1 };
			} else if (rateLimit.requestCount >= maxRequests) {
				// Rate limited
				return {
					allowed: false,
					remaining: 0,
					resetTime: rateLimit.resetAt,
				};
			} else {
				// Increment counter
				rateLimit.requestCount += 1;
				rateLimit.lastRequest = now;
				await rateLimit.save();
				return {
					allowed: true,
					remaining: maxRequests - rateLimit.requestCount,
				};
			}
		} catch (error) {
			console.error("Error checking rate limit:", error);
			throw error;
		}
	}

	// 👤 User Profile & XP Methods
	async getUserProfile(userId, guildId) {
		await this.ensureConnection();
		try {
			let profile = await UserProfile.findOne({ userId, guildId });
			if (!profile) {
				profile = await UserProfile.create({ userId, guildId });
			}
			return profile;
		} catch (error) {
			console.error("Error getting user profile:", error);
			throw error;
		}
	}

	async updateUserProfile(userId, guildId, updateData) {
		await this.ensureConnection();
		try {
			const profile = await UserProfile.findOneAndUpdate(
				{ userId, guildId },
				{ $set: updateData },
				{ upsert: true, new: true },
			);
			return profile;
		} catch (error) {
			console.error("Error updating user profile:", error);
			throw error;
		}
	}

	async addXP(userId, guildId, amount, type = "message", reason = null) {
		await this.ensureConnection();
		try {
			// Get current profile
			const profile = await this.getUserProfile(userId, guildId);

			// Calculate new XP and level
			const newTotalXp = Math.max(0, profile.totalXp + amount);
			const newLevel = this.calculateLevel(newTotalXp);

			// Update profile
			const updateData = {
				totalXp: newTotalXp,
				level: newLevel,
				dailyXp: profile.dailyXp + amount,
				weeklyXp: profile.weeklyXp + amount,
				monthlyXp: profile.monthlyXp + amount,
				activityScore: this.calculateActivityScore(profile, amount, type),
			};

			if (type === "message") {
				updateData.messageCount = (profile.messageCount || 0) + 1;
				updateData.lastMessageAt = new Date();
			} else if (type === "voice") {
				updateData.voiceMinutes = (profile.voiceMinutes || 0) + 1;
				updateData.lastVoiceAt = new Date();
			}

			const updatedProfile = await UserProfile.findOneAndUpdate(
				{ userId, guildId },
				{ $set: updateData },
				{ new: true },
			);

			// Record XP transaction
			await XPTransaction.create({
				userId,
				guildId,
				amount,
				type,
				reason,
			});

			return {
				profile: updatedProfile,
				levelUp: newLevel > profile.level,
				oldLevel: profile.level,
				newLevel,
			};
		} catch (error) {
			console.error("Error adding XP:", error);
			throw error;
		}
	}

	calculateLevel(totalXp) {
		// Level formula: Level = floor(sqrt(totalXp / 100))
		return Math.floor(Math.sqrt(totalXp / 100)) + 1;
	}

	getXPRequiredForLevel(level) {
		// XP required = (level - 1)^2 * 100
		return Math.pow(level - 1, 2) * 100;
	}

	calculateActivityScore(profile, xpGained, type) {
		const baseScore = profile.activityScore || 0;
		const multiplier = type === "voice" ? 1.5 : 1;
		const timeBonus = this.getTimeBonus();

		return Math.floor(baseScore + xpGained * multiplier * timeBonus);
	}

	getTimeBonus() {
		const hour = new Date().getHours();
		// Higher bonus during peak hours (6 PM - 10 PM)
		if (hour >= 18 && hour <= 22) return 1.2;
		// Lower bonus during quiet hours (11 PM - 6 AM)
		if (hour >= 23 || hour <= 6) return 0.8;
		return 1.0;
	}

	// 🏆 Leaderboard Methods
	async getTopUsers(guildId, limit = 10, type = "totalXp") {
		await this.ensureConnection();
		try {
			const sortField = {};
			sortField[type] = -1;

			const users = await UserProfile.find({ guildId })
				.sort(sortField)
				.limit(limit)
				.select(
					"userId username totalXp level messageCount voiceMinutes activityScore",
				);

			return users.map((user, index) => ({
				...user.toObject(),
				rank: index + 1,
			}));
		} catch (error) {
			console.error("Error getting top users:", error);
			throw error;
		}
	}

	async getUserRank(userId, guildId, type = "totalXp") {
		await this.ensureConnection();
		try {
			const user = await UserProfile.findOne({ userId, guildId });
			if (!user) return null;

			const rankQuery = {};
			rankQuery[type] = { $gt: user[type] };
			rankQuery.guildId = guildId;

			const rank = (await UserProfile.countDocuments(rankQuery)) + 1;
			return { rank, user };
		} catch (error) {
			console.error("Error getting user rank:", error);
			throw error;
		}
	}

	// 🎯 Role Reward Methods
	async checkRoleRewards(userId, guildId) {
		await this.ensureConnection();
		try {
			const config = await this.getServerConfig(guildId);
			const profile = await this.getUserProfile(userId, guildId);

			if (!config.roleAutomation || !config.roleRewards) {
				return { newRoles: [], removedRoles: [] };
			}

			const eligibleRoles = [];
			const topUsers = await this.getTopUsers(guildId, 50);
			const userRank = topUsers.findIndex((u) => u.userId === userId) + 1;

			for (const reward of config.roleRewards) {
				let eligible = false;

				if (reward.xpThreshold && profile.totalXp >= reward.xpThreshold) {
					eligible = true;
				}

				if (reward.topRank && userRank > 0 && userRank <= reward.topRank) {
					eligible = true;
				}

				if (eligible) {
					eligibleRoles.push(reward);
				}
			}

			return { eligibleRoles, currentRoles: profile.currentRoles || [] };
		} catch (error) {
			console.error("Error checking role rewards:", error);
			throw error;
		}
	}

	async updateUserRoles(userId, guildId, newRoles) {
		await this.ensureConnection();
		try {
			const rolesData = newRoles.map((role) => ({
				roleId: role.roleId,
				roleName: role.roleName,
				earnedAt: new Date(),
			}));

			const profile = await UserProfile.findOneAndUpdate(
				{ userId, guildId },
				{ $set: { currentRoles: rolesData } },
				{ new: true },
			);

			return profile;
		} catch (error) {
			console.error("Error updating user roles:", error);
			throw error;
		}
	}

	// 📊 Statistics Methods
	async resetDailyStats(guildId) {
		await this.ensureConnection();
		try {
			const result = await UserProfile.updateMany(
				{
					guildId,
					lastDailyReset: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
				},
				{
					$set: {
						dailyXp: 0,
						lastDailyReset: new Date(),
					},
				},
			);
			return result;
		} catch (error) {
			console.error("Error resetting daily stats:", error);
			throw error;
		}
	}

	async resetWeeklyStats(guildId) {
		await this.ensureConnection();
		try {
			const result = await UserProfile.updateMany(
				{
					guildId,
					lastWeeklyReset: {
						$lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
					},
				},
				{
					$set: {
						weeklyXp: 0,
						lastWeeklyReset: new Date(),
					},
				},
			);
			return result;
		} catch (error) {
			console.error("Error resetting weekly stats:", error);
			throw error;
		}
	}

	async getServerStats(guildId) {
		await this.ensureConnection();
		try {
			const totalUsers = await UserProfile.countDocuments({ guildId });
			const totalXp = await UserProfile.aggregate([
				{ $match: { guildId } },
				{ $group: { _id: null, total: { $sum: "$totalXp" } } },
			]);
			const totalMessages = await UserProfile.aggregate([
				{ $match: { guildId } },
				{ $group: { _id: null, total: { $sum: "$messageCount" } } },
			]);

			return {
				totalUsers,
				totalXp: totalXp[0]?.total || 0,
				totalMessages: totalMessages[0]?.total || 0,
			};
		} catch (error) {
			console.error("Error getting server stats:", error);
			throw error;
		}
	}

	// Points System Methods
	async givePoints(
		fromUserId,
		toUserId,
		guildId,
		amount,
		reason = "No reason provided",
	) {
		await this.ensureConnection();
		try {
			// Update giver (deduct points and increment pointsGiven)
			const giverUpdate = await UserProfile.findOneAndUpdate(
				{ userId: fromUserId, guildId },
				{
					$inc: {
						points: -amount,
						pointsGiven: amount,
					},
				},
				{ upsert: true, new: true },
			);

			// Update receiver (add points and increment pointsReceived)
			const receiverUpdate = await UserProfile.findOneAndUpdate(
				{ userId: toUserId, guildId },
				{
					$inc: {
						points: amount,
						pointsReceived: amount,
					},
				},
				{ upsert: true, new: true },
			);

			return { giver: giverUpdate, receiver: receiverUpdate };
		} catch (error) {
			console.error("Error giving points:", error);
			throw error;
		}
	}

	async getPointsLeaderboard(guildId, limit = 10, skip = 0) {
		await this.ensureConnection();
		try {
			const users = await UserProfile.find({ guildId })
				.sort({ points: -1 })
				.skip(skip)
				.limit(limit)
				.lean();

			const totalUsers = await UserProfile.countDocuments({
				guildId,
				points: { $gt: 0 },
			});

			return { users, totalUsers };
		} catch (error) {
			console.error("Error getting points leaderboard:", error);
			throw error;
		}
	}

	async getUserPoints(userId, guildId) {
		await this.ensureConnection();
		try {
			const profile = await UserProfile.findOne({ userId, guildId });
			return {
				points: profile?.points || 0,
				pointsGiven: profile?.pointsGiven || 0,
				pointsReceived: profile?.pointsReceived || 0,
			};
		} catch (error) {
			console.error("Error getting user points:", error);
			throw error;
		}
	}

	async getGuildEconomy(guildId) {
		try {
			let economySettings = await this.GuildEconomy.findOne({ guildId });
			if (!economySettings) {
				// If no settings exist, create them with default values
				economySettings = new this.GuildEconomy({ guildId });
				await economySettings.save();
			}
			return economySettings;
		} catch (error) {
			console.error("Error getting guild economy settings:", error);
			return null;
		}
	}

	close() {
		if (mongoose.connection.readyState === 1) {
			mongoose.disconnect();
			console.log("📊 Database connection closed");
		}
	}
}

module.exports = Database;
