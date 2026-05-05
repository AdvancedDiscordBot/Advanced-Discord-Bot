const { Events, EmbedBuilder } = require("discord.js");
const Database = require("../utils/database");

module.exports = {
	name: Events.MessageCreate,
	async execute(message, client) {
		// 🚫 Ignore bot messages and DMs
		if (message.author.bot || !message.guild) return;

		if (client.hooks) {
			const hookResult = await client.hooks.emitHook("beforeMessage", {
				message,
			});

			if (hookResult.cancelled) {
				return;
			}

			message = hookResult.payload.message || message;
		}

		const db = await Database.getInstance();
		await db.ensureConnection();

		try {
			// 🎯 XP TRACKING LOGIC FIRST
			await handleXPTracking(message, db, client);

			if (client.hooks) {
				await client.hooks.emitHook("afterMessage", { message });
			}
		} catch (error) {
			console.error("❌ Error in messageCreate event:", error);
		}
	},
};

// 🎯 XP Tracking Handler
async function handleXPTracking(message, db, client) {
	try {
		// Get server config
		const config = await db.getServerConfig(message.guild.id);

		// Check if XP is enabled
		if (!config.xpEnabled) return;

		// Check if channel is excluded
		if (
			config.excludeChannels &&
			config.excludeChannels.includes(message.channel.id)
		) {
			return;
		}

		// Check if channel is in tracking list (if specified)
		if (config.trackingChannels && config.trackingChannels.length > 0) {
			if (!config.trackingChannels.includes(message.channel.id)) {
				return;
			}
		}

		// Rate limit XP gain (1 XP per minute per user)
		const userId = message.author.id;
		const guildId = message.guild.id;
		const profile = await db.getUserProfile(userId, guildId);

		const now = new Date();
		const lastMessage = profile.lastMessageAt;

		// Check if enough time has passed (60 seconds)
		if (lastMessage && now - lastMessage < 60000) {
			return;
		}

		// Add XP based on configuration
		const xpAmount = config.xpPerMessage || 1;
		const result = await db.addXP(userId, guildId, xpAmount, "message");

		// Update username for leaderboards
		await db.updateUserProfile(userId, guildId, {
			username: message.author.username,
			discriminator: message.author.discriminator,
		});

		// Check for level up
		if (result.levelUp) {
			if (client.hooks) {
				await client.hooks.emitHook("onLevelUp", {
					user: message.author,
					guildId,
					newLevel: result.newLevel,
					profile: result.profile,
				});
			}
			const levelUpEmbed = new EmbedBuilder()
				.setColor(0x00ff00)
				.setTitle("🎉 Level Up!")
				.setDescription(
					`Congratulations ${message.author}! You've reached **Level ${result.newLevel}**!`,
				)
				.addFields({
					name: "📊 Your Stats",
					value: `**Total XP:** ${result.profile.totalXp}\n**Messages:** ${result.profile.messageCount}`,
					inline: true,
				})
				.setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
				.setFooter({
					text: `Keep chatting to earn more XP!`,
					iconUrl: client.user.displayAvatarURL(),
				})
				.setTimestamp();

			// Send level up message
			try {
				await message.channel.send({ embeds: [levelUpEmbed] });
			} catch (error) {
				console.error("Error sending level up message:", error);
			}
		}

		// Check for role rewards
		if (config.roleAutomation) {
			await checkAndAssignRoles(message.member, db, guildId);
		}
	} catch (error) {
		console.error("Error in XP tracking:", error);
	}
}

// 🎭 Role Assignment Handler
async function checkAndAssignRoles(member, db, guildId) {
	try {
		const roleCheck = await db.checkRoleRewards(member.id, guildId);
		const currentRoleIds = member.roles.cache.map((role) => role.id);

		// Get eligible role IDs
		const eligibleRoleIds = roleCheck.eligibleRoles.map((r) => r.roleId);

		// Roles to add
		const rolesToAdd = eligibleRoleIds.filter(
			(roleId) =>
				!currentRoleIds.includes(roleId) &&
				member.guild.roles.cache.has(roleId),
		);

		// Add new roles
		for (const roleId of rolesToAdd) {
			try {
				const role = member.guild.roles.cache.get(roleId);
				if (
					role &&
					role.position < member.guild.members.me.roles.highest.position
				) {
					await member.roles.add(role);
					console.log(`✅ Added role ${role.name} to ${member.user.username}`);
				}
			} catch (error) {
				console.error(`Error adding role ${roleId}:`, error);
			}
		}

		// Update database with current roles
		if (rolesToAdd.length > 0) {
			const newRoles = roleCheck.eligibleRoles.filter((r) =>
				eligibleRoleIds.includes(r.roleId),
			);
			await db.updateUserRoles(member.id, guildId, newRoles);
		}
	} catch (error) {
		console.error("Error checking/assigning roles:", error);
	}
}
