const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const Database = require("../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("antiraid")
		.setDescription("🛡️ Simple anti-raid protection")
		.addSubcommand((subcommand) =>
			subcommand
				.setName("enable")
				.setDescription("Enable anti-raid protection"),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("disable")
				.setDescription("Disable anti-raid protection"),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("status").setDescription("Check anti-raid status"),
		),

	async execute(interaction) {
		if (!interaction.member.permissions.has("Administrator")) {
			return interaction.reply({
				embeds: [
					new EmbedBuilder()
						.setColor("#ff0000")
						.setTitle("❌ No Permission")
						.setDescription(
							"You need Administrator permissions to use this command.",
						),
				],
				flags: 64,
			});
		}

		const subcommand = interaction.options.getSubcommand();

		try {
			const db = await Database.getInstance();
			await db.ensureConnection();

			switch (subcommand) {
				case "enable":
					await handleEnable(interaction, db);
					break;
				case "disable":
					await handleDisable(interaction, db);
					break;
				case "status":
					await handleStatus(interaction, db);
					break;
			}
		} catch (error) {
			console.error("Anti-raid command error:", error);

			await interaction.reply({
				embeds: [
					new EmbedBuilder()
						.setColor("#ff0000")
						.setTitle("❌ Error")
						.setDescription(
							"An error occurred while processing anti-raid command.",
						),
				],
				flags: 64,
			});
		}
	},
};

async function handleEnable(interaction, db) {
	try {
		await db.GuildConfig.findOneAndUpdate(
			{ guildId: interaction.guild.id },
			{
				$set: {
					antiRaidEnabled: true,
					antiRaidThreshold: 5,
					antiRaidTimeWindow: 10000, // 10 seconds
				},
			},
			{ upsert: true, new: true },
		);

		await interaction.reply({
			embeds: [
				new EmbedBuilder()
					.setColor("#00ff00")
					.setTitle("✅ Anti-Raid Enabled")
					.setDescription(
						"Anti-raid protection has been enabled with default settings.",
					)
					.addFields(
						{ name: "Threshold", value: "5 joins", inline: true },
						{ name: "Time Window", value: "10 seconds", inline: true },
					),
			],
		});
	} catch (error) {
		console.error("Error enabling anti-raid:", error);
		throw error;
	}
}

async function handleDisable(interaction, db) {
	try {
		await db.GuildConfig.findOneAndUpdate(
			{ guildId: interaction.guild.id },
			{ $set: { antiRaidEnabled: false } },
			{ upsert: true, new: true },
		);

		await interaction.reply({
			embeds: [
				new EmbedBuilder()
					.setColor("#ff0000")
					.setTitle("❌ Anti-Raid Disabled")
					.setDescription("Anti-raid protection has been disabled."),
			],
		});
	} catch (error) {
		console.error("Error disabling anti-raid:", error);
		throw error;
	}
}

async function handleStatus(interaction, db) {
	try {
		const config = await db.GuildConfig.findOne({
			guildId: interaction.guild.id,
		});

		const isEnabled = config?.antiRaidEnabled || false;
		const threshold = config?.antiRaidThreshold || 5;
		const timeWindow = config?.antiRaidTimeWindow || 10000;

		await interaction.reply({
			embeds: [
				new EmbedBuilder()
					.setColor(isEnabled ? "#00ff00" : "#ff0000")
					.setTitle("🛡️ Anti-Raid Status")
					.addFields(
						{
							name: "Status",
							value: isEnabled ? "✅ Enabled" : "❌ Disabled",
							inline: true,
						},
						{ name: "Threshold", value: `${threshold} joins`, inline: true },
						{
							name: "Time Window",
							value: `${timeWindow / 1000} seconds`,
							inline: true,
						},
					),
			],
		});
	} catch (error) {
		console.error("Error checking anti-raid status:", error);
		throw error;
	}
}
