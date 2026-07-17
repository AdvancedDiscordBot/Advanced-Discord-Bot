const { PermissionFlagsBits } = require("discord.js");
const { generateWelcomeCard } = require("../lib/card");

function formatWelcomeText(text, member) {
	if (!text) return "";
	return text
		.replace(/{user}/g, `<@${member.id || member.userId}>`)
		.replace(/{username}/g, member.user?.username || member.username || "User")
		.replace(/{server}/g, member.guild?.name || member.guildName || "Server")
		.replace(/{guild}/g, member.guild?.name || member.guildName || "Server")
		.replace(/{memberCount}/g, member.guild?.memberCount || member.memberCount || 0);
}

module.exports = {
	data: {
		name: "welcome",
		description: "Configure welcome and goodbye messages/cards",
		options: [
			{
				name: "channel",
				description: "Set or clear the welcome channel",
				type: 1, // SUB_COMMAND
				options: [
					{
						name: "channel",
						description: "The channel to send welcome messages in (leave empty to disable)",
						type: 7, // CHANNEL
						required: false,
					},
				],
			},
			{
				name: "message",
				description: "Set the welcome message text",
				type: 1, // SUB_COMMAND
				options: [
					{
						name: "text",
						description: "Welcome text. Use placeholders: {user}, {username}, {server}, {memberCount}",
						type: 3, // STRING
						required: true,
					},
				],
			},
			{
				name: "goodbye-channel",
				description: "Set or clear the goodbye channel",
				type: 1, // SUB_COMMAND
				options: [
					{
						name: "channel",
						description: "The channel to send goodbye messages in (leave empty to disable)",
						type: 7, // CHANNEL
						required: false,
					},
				],
			},
			{
				name: "goodbye-message",
				description: "Set the goodbye message text",
				type: 1, // SUB_COMMAND
				options: [
					{
						name: "text",
						description: "Goodbye text. Use placeholders: {username}, {server}, {memberCount}",
						type: 3, // STRING
						required: true,
					},
				],
			},
			{
				name: "dm",
				description: "Toggle welcome messages in Direct Messages (DM)",
				type: 1, // SUB_COMMAND
				options: [
					{
						name: "status",
						description: "Choose ON or OFF",
						type: 3, // STRING
						required: true,
						choices: [
							{ name: "on", value: "on" },
							{ name: "off", value: "off" },
						],
					},
				],
			},
			{
				name: "card",
				description: "Toggle welcome/goodbye image cards",
				type: 1, // SUB_COMMAND
				options: [
					{
						name: "status",
						description: "Choose ON or OFF",
						type: 3, // STRING
						required: true,
						choices: [
							{ name: "on", value: "on" },
							{ name: "off", value: "off" },
						],
					},
				],
			},
			{
				name: "preview",
				description: "Preview the welcome card/message in the current channel",
				type: 1, // SUB_COMMAND
			},
			{
				name: "test",
				description: "Simulate a real welcome and goodbye event",
				type: 1, // SUB_COMMAND
			},
		],
		toJSON() {
			return this;
		},
	},

	async execute(interaction, ctx) {
		// Enforce ManageGuild permission
		if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.reply({
				content: "❌ You need the **Manage Server** permission to use this command.",
				ephemeral: true,
			});
		}

		const subcommand = interaction.options.getSubcommand();
		const config = await ctx.db.getPluginConfig(interaction.guildId, "adb-plugin-welcome");
		if (!config.data) {
			config.data = {};
		}

		if (subcommand === "channel") {
			const channel = interaction.options.getChannel("channel");
			if (channel) {
				if (!channel.isTextBased()) {
					return interaction.reply({
						content: "❌ Selected channel must be a text-based channel.",
						ephemeral: true,
					});
				}
				config.data.welcomeChannelId = channel.id;
				await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
				return interaction.reply({
					content: `✅ Welcome messages will now be sent in ${channel}.`,
					ephemeral: true,
				});
			} else {
				config.data.welcomeChannelId = null;
				await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
				return interaction.reply({
					content: "✅ Welcome channel disabled.",
					ephemeral: true,
				});
			}
		}

		if (subcommand === "message") {
			const text = interaction.options.getString("text");
			config.data.welcomeMessage = text;
			await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
			return interaction.reply({
				content: `✅ Welcome message updated.\n**Preview:** ${text}`,
				ephemeral: true,
			});
		}

		if (subcommand === "goodbye-channel") {
			const channel = interaction.options.getChannel("channel");
			if (channel) {
				if (!channel.isTextBased()) {
					return interaction.reply({
						content: "❌ Selected channel must be a text-based channel.",
						ephemeral: true,
					});
				}
				config.data.goodbyeChannelId = channel.id;
				await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
				return interaction.reply({
					content: `✅ Goodbye messages will now be sent in ${channel}.`,
					ephemeral: true,
				});
			} else {
				config.data.goodbyeChannelId = null;
				await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
				return interaction.reply({
					content: "✅ Goodbye channel disabled.",
					ephemeral: true,
				});
			}
		}

		if (subcommand === "goodbye-message") {
			const text = interaction.options.getString("text");
			config.data.goodbyeMessage = text;
			await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
			return interaction.reply({
				content: `✅ Goodbye message updated.\n**Preview:** ${text}`,
				ephemeral: true,
			});
		}

		if (subcommand === "dm") {
			const status = interaction.options.getString("status");
			config.data.dmEnabled = status === "on";
			await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
			return interaction.reply({
				content: `✅ Welcome DMs are now turned **${status.toUpperCase()}**.`,
				ephemeral: true,
			});
		}

		if (subcommand === "card") {
			const status = interaction.options.getString("status");
			config.data.cardEnabled = status === "on";
			await ctx.db.updatePluginConfig(interaction.guildId, "adb-plugin-welcome", config.data);
			return interaction.reply({
				content: `✅ Welcome/Goodbye image cards are now turned **${status.toUpperCase()}**.`,
				ephemeral: true,
			});
		}

		if (subcommand === "preview") {
			await interaction.deferReply();
			const welcomeText =
				config.data.welcomeMessage || "Welcome to the server, {user}! You are member #{memberCount}.";
			const goodbyeText = config.data.goodbyeMessage || "Goodbye {username}! We will miss you.";
			const cardEnabled = config.data.cardEnabled;

			const embeds = [];
			const files = [];

			// 1. Welcome Preview
			const formattedWelcome = formatWelcomeText(welcomeText, interaction.member);
			const welcomeEmbed = {
				color: 0x5865f2,
				title: "👋 Welcome Preview",
				description: formattedWelcome,
				timestamp: new Date().toISOString(),
			};

			if (cardEnabled) {
				try {
					const avatarUrl = interaction.member.user.displayAvatarURL({ extension: "png", size: 256 });
					const serverIconUrl = interaction.guild.iconURL({ extension: "png", size: 128 });
					const welcomeBuffer = await generateWelcomeCard({
						avatarUrl,
						username: interaction.member.user.username,
						serverIconUrl,
						serverName: interaction.guild.name,
						memberCount: interaction.guild.memberCount,
						isWelcome: true,
					});
					files.push({ name: "welcome.png", data: welcomeBuffer });
					welcomeEmbed.image = { url: "attachment://welcome.png" };
				} catch (err) {
					ctx.logger.error("Failed to generate welcome preview card", err);
				}
			}
			embeds.push(welcomeEmbed);

			// 2. Goodbye Preview
			const formattedGoodbye = formatWelcomeText(goodbyeText, interaction.member);
			const goodbyeEmbed = {
				color: 0xed4245,
				title: "🚪 Goodbye Preview",
				description: formattedGoodbye,
				timestamp: new Date().toISOString(),
			};

			if (cardEnabled) {
				try {
					const avatarUrl = interaction.member.user.displayAvatarURL({ extension: "png", size: 256 });
					const serverIconUrl = interaction.guild.iconURL({ extension: "png", size: 128 });
					const goodbyeBuffer = await generateWelcomeCard({
						avatarUrl,
						username: interaction.member.user.username,
						serverIconUrl,
						serverName: interaction.guild.name,
						memberCount: interaction.guild.memberCount,
						isWelcome: false,
					});
					files.push({ name: "goodbye.png", data: goodbyeBuffer });
					goodbyeEmbed.image = { url: "attachment://goodbye.png" };
				} catch (err) {
					ctx.logger.error("Failed to generate goodbye preview card", err);
				}
			}
			embeds.push(goodbyeEmbed);

			return interaction.editReply({
				content: "🎨 **Welcome & Goodbye Preview:**",
				embeds,
				files,
			});
		}

		if (subcommand === "test") {
			await interaction.deferReply();

			const data = config.data || {};
			const welcomeText =
				data.welcomeMessage || "Welcome to the server, {user}! You are member #{memberCount}.";
			const goodbyeText = data.goodbyeMessage || "Goodbye {username}! We will miss you.";
			const cardEnabled = data.cardEnabled;
			const welcomeChannelId = data.welcomeChannelId;
			const goodbyeChannelId = data.goodbyeChannelId;
			const dmEnabled = data.dmEnabled;

			let welcomeSent = false;
			let welcomeDmSent = false;
			let goodbyeSent = false;

			// Generate Welcome Embed
			const formattedWelcome = formatWelcomeText(welcomeText, interaction.member);
			const welcomeEmbed = {
				color: 0x5865f2,
				title: `Welcome to ${interaction.guild.name}!`,
				description: formattedWelcome,
				timestamp: new Date().toISOString(),
			};

			const welcomeFiles = [];
			if (cardEnabled) {
				try {
					const avatarUrl = interaction.member.user.displayAvatarURL({ extension: "png", size: 256 });
					const serverIconUrl = interaction.guild.iconURL({ extension: "png", size: 128 });
					const welcomeBuffer = await generateWelcomeCard({
						avatarUrl,
						username: interaction.member.user.username,
						serverIconUrl,
						serverName: interaction.guild.name,
						memberCount: interaction.guild.memberCount,
						isWelcome: true,
					});
					welcomeFiles.push({ name: "welcome.png", data: welcomeBuffer });
					welcomeEmbed.image = { url: "attachment://welcome.png" };
				} catch (err) {
					ctx.logger.error("Failed to generate welcome test card", err);
				}
			}

			// Send welcome to channel via ctx.discord
			if (welcomeChannelId) {
				try {
					await ctx.discord.sendToChannel(welcomeChannelId, {
						content: formattedWelcome,
						embeds: [welcomeEmbed],
						files: welcomeFiles,
					});
					welcomeSent = true;
				} catch (err) {
					// Silent — already logged by ctx.discord
				}
			}

			// Send welcome to DM via ctx.discord
			if (dmEnabled) {
				try {
					await ctx.discord.sendDM(interaction.user.id, {
						content: formattedWelcome,
						embeds: [welcomeEmbed],
						files: welcomeFiles,
					});
					welcomeDmSent = true;
				} catch (err) {
					ctx.logger.error("Failed to send test welcome DM to user", err);
				}
			}

			// Generate Goodbye Embed
			const formattedGoodbye = formatWelcomeText(goodbyeText, interaction.member);
			const goodbyeEmbed = {
				color: 0xed4245,
				title: `Goodbye from ${interaction.guild.name}!`,
				description: formattedGoodbye,
				timestamp: new Date().toISOString(),
			};

			const goodbyeFiles = [];
			if (cardEnabled) {
				try {
					const avatarUrl = interaction.member.user.displayAvatarURL({ extension: "png", size: 256 });
					const serverIconUrl = interaction.guild.iconURL({ extension: "png", size: 128 });
					const goodbyeBuffer = await generateWelcomeCard({
						avatarUrl,
						username: interaction.member.user.username,
						serverIconUrl,
						serverName: interaction.guild.name,
						memberCount: interaction.guild.memberCount,
						isWelcome: false,
					});
					goodbyeFiles.push({ name: "goodbye.png", data: goodbyeBuffer });
					goodbyeEmbed.image = { url: "attachment://goodbye.png" };
				} catch (err) {
					ctx.logger.error("Failed to generate goodbye test card", err);
				}
			}

			// Send goodbye to channel via ctx.discord
			if (goodbyeChannelId) {
				try {
					await ctx.discord.sendToChannel(goodbyeChannelId, {
						content: formattedGoodbye,
						embeds: [goodbyeEmbed],
						files: goodbyeFiles,
					});
					goodbyeSent = true;
				} catch (err) {
					// Silent — already logged
				}
			}

			// Send summary report
			const statusLines = [
				`📢 **Welcome Channel:** ${welcomeChannelId ? (welcomeSent ? "✅ Sent successfully" : "❌ Failed to send") : "⏸️ Not configured"}`,
				`📥 **Welcome DM:** ${dmEnabled ? (welcomeDmSent ? "✅ Sent successfully" : "❌ Failed (DMs blocked?)") : "⏸️ Disabled"}`,
				`🚪 **Goodbye Channel:** ${goodbyeChannelId ? (goodbyeSent ? "✅ Sent successfully" : "❌ Failed to send") : "⏸️ Not configured"}`,
			];

			return interaction.editReply({
				content: `🧪 **Test Simulations Completed!**\n\n${statusLines.join("\n")}`,
			});
		}
	},
	formatWelcomeText,
};
