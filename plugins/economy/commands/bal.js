const {
	SlashCommandBuilder,
	EmbedBuilder,
	MessageFlags,
} = require("discord.js");
const Database = require("../../../utils/database");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("bal")
		.setDescription("💰 Check your wallet and bank balance")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to check the balance of (optional)")
				.setRequired(false),
		),
	async execute(interaction) {
		const db = await Database.getInstance();
		await db.ensureConnection();
		const targetUser = interaction.options.getUser("user") || interaction.user;
		const guildId = interaction.guild.id;

		await interaction.deferReply();

		const profile = await db.getUserProfile(targetUser.id, guildId);

		if (!profile) {
			return await interaction.editReply({
				content: `❌ No profile data found for ${targetUser.username}.`,
			});
		}

		const balanceEmbed = new EmbedBuilder()
			.setColor("#FFD700") // Gold color for economy!
			.setTitle(`💰 ${targetUser.username}'s Balance`)
			.setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
			.addFields(
				{
					name: "👛 Wallet",
					value: `**${(profile.wallet || 0).toLocaleString()}** coins`,
					inline: true,
				},
				{
					name: "🏦 Bank",
					value: `**${(profile.bank || 0).toLocaleString()}** coins`,
					inline: true,
				},
				{
					name: "📊 Total",
					value: `**${(
						(profile.wallet || 0) + (profile.bank || 0)
					).toLocaleString()}** coins`,
					inline: true,
				},
			)
			.setFooter({
				text: `Requested by ${interaction.user.tag}`,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTimestamp();

		await interaction.editReply({ embeds: [balanceEmbed] });
	},
};
