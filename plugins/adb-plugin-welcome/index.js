const { EmbedBuilder } = require("discord.js");
const welcomeCommand = require("./commands/welcome");
const { generateWelcomeCard } = require("./lib/card");

/**
 * Every ADB plugin exports a single `load(ctx)` function. `ctx` is frozen
 * and namespaced to this plugin.
 *
 * In isolated mode, ctx.client is null and ctx.discord provides RPC-routed
 * Discord API access. Card generation (canvas) runs locally in the worker.
 */
async function load(ctx) {
	// --- Register slash command -----------------------------------------
	ctx.registerCommand({
		data: welcomeCommand.data,
		execute: (interaction) => welcomeCommand.execute(interaction, ctx),
	});

	// --- Listen to guildMemberAdd event --------------------------------
	ctx.registerEvent("guildMemberAdd", async (eventPayload) => {
		try {
			// In isolated mode, eventPayload is a serialized object from the broker
			// with { member: { id, guildId, user: { id, username, avatarURL } }, guild: { id, name, memberCount, iconURL } }
			const memberData = eventPayload.member || eventPayload;
			const guildData = eventPayload.guild || {};
			const guildId = memberData.guildId || guildData.id;
			const userId = memberData.user?.id || memberData.id;

			const config = await ctx.db.getPluginConfig(guildId, "adb-plugin-welcome");
			if (!config || !config.data) return;

			const data = config.data;
			const welcomeChannelId = data.welcomeChannelId;
			const welcomeText = data.welcomeMessage || "Welcome to the server, {user}! You are member #{memberCount}.";
			const cardEnabled = data.cardEnabled;
			const dmEnabled = data.dmEnabled;

			if (!welcomeChannelId && !dmEnabled) return;

			const username = memberData.user?.username || "NewMember";
			const displayName = `<@${userId}>`;

			// Format welcome text with placeholders
			const formattedWelcome = welcomeText
				.replace(/{user}/g, displayName)
				.replace(/{username}/g, username)
				.replace(/{server}/g, guildData.name || "Server")
				.replace(/{guild}/g, guildData.name || "Server")
				.replace(/{memberCount}/g, guildData.memberCount || 0);

			const welcomeEmbed = {
				color: 0x5865f2,
				title: `Welcome to ${guildData.name || "Server"}!`,
				description: formattedWelcome,
				timestamp: new Date().toISOString(),
			};

			const files = [];
			if (cardEnabled) {
				const avatarUrl = memberData.user?.avatarURL || null;
				const serverIconUrl = guildData.iconURL || null;
				const welcomeBuffer = await generateWelcomeCard({
					avatarUrl,
					username,
					serverIconUrl,
					serverName: guildData.name,
					memberCount: guildData.memberCount,
					isWelcome: true,
				}).catch((err) => {
					ctx.logger.error("Failed to generate welcome card image", err);
					return null;
				});

				if (welcomeBuffer) {
					files.push({ name: "welcome.png", data: welcomeBuffer });
					welcomeEmbed.image = { url: "attachment://welcome.png" };
				}
			}

			// Send to welcome channel via ctx.discord
			if (welcomeChannelId) {
				try {
					await ctx.discord.sendToChannel(welcomeChannelId, {
						content: formattedWelcome,
						embeds: [welcomeEmbed],
						files,
					});
				} catch (err) {
					ctx.logger.error(`Failed to send welcome message to channel ${welcomeChannelId}`, err);
				}
			}

			// Send to DM
			if (dmEnabled) {
				try {
					await ctx.discord.sendDM(userId, {
						content: formattedWelcome,
						embeds: [welcomeEmbed],
						files,
					});
				} catch (err) {
					ctx.logger.error(`Failed to send welcome DM to user ${username}`, err);
				}
			}
		} catch (err) {
			ctx.logger.error("Error in guildMemberAdd event handler:", err);
		}
	});

	// --- Listen to guildMemberRemove event ------------------------------
	ctx.registerEvent("guildMemberRemove", async (eventPayload) => {
		try {
			const memberData = eventPayload.member || eventPayload;
			const guildData = eventPayload.guild || {};
			const guildId = memberData.guildId || guildData.id;
			const userId = memberData.user?.id || memberData.id;

			const config = await ctx.db.getPluginConfig(guildId, "adb-plugin-welcome");
			if (!config || !config.data) return;

			const data = config.data;
			const goodbyeChannelId = data.goodbyeChannelId;
			const goodbyeText = data.goodbyeMessage || "Goodbye {username}! We will miss you.";
			const cardEnabled = data.cardEnabled;

			if (!goodbyeChannelId) return;

			const username = memberData.user?.username || "Member";

			const formattedGoodbye = goodbyeText
				.replace(/{user}/g, `<@${userId}>`)
				.replace(/{username}/g, username)
				.replace(/{server}/g, guildData.name || "Server")
				.replace(/{guild}/g, guildData.name || "Server")
				.replace(/{memberCount}/g, guildData.memberCount || 0);

			const goodbyeEmbed = {
				color: 0xed4245,
				title: `Goodbye from ${guildData.name || "Server"}!`,
				description: formattedGoodbye,
				timestamp: new Date().toISOString(),
			};

			const files = [];
			if (cardEnabled) {
				const avatarUrl = memberData.user?.avatarURL || null;
				const serverIconUrl = guildData.iconURL || null;
				const goodbyeBuffer = await generateWelcomeCard({
					avatarUrl,
					username,
					serverIconUrl,
					serverName: guildData.name,
					memberCount: guildData.memberCount,
					isWelcome: false,
				}).catch((err) => {
					ctx.logger.error("Failed to generate goodbye card image", err);
					return null;
				});

				if (goodbyeBuffer) {
					files.push({ name: "goodbye.png", data: goodbyeBuffer });
					goodbyeEmbed.image = { url: "attachment://goodbye.png" };
				}
			}

			// Send to goodbye channel via ctx.discord
			try {
				await ctx.discord.sendToChannel(goodbyeChannelId, {
					content: formattedGoodbye,
					embeds: [goodbyeEmbed],
					files,
				});
			} catch (err) {
				ctx.logger.error(`Failed to send goodbye message to channel ${goodbyeChannelId}`, err);
			}
		} catch (err) {
			ctx.logger.error("Error in guildMemberRemove event handler:", err);
		}
	});

	ctx.logger.info("Welcome plugin loaded successfully");
}

module.exports = { load };
