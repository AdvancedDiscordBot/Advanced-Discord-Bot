const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getRandomResponse } = require("../../utils/helpers");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("8ball")
		.setDescription(
			"🎱 Ask the magic 8-ball a question and receive mystical wisdom",
		)
		.addStringOption((option) =>
			option
				.setName("question")
				.setDescription("The question you want to ask the magic 8-ball")
				.setRequired(true),
		),
	cooldown: 3,
	async execute(interaction, client) {
		const question = interaction.options.getString("question");

		// 🎱 Magic 8-ball responses with personality
		const responses = [
			// Positive responses
			"✨ It is certain",
			"🌟 Without a doubt",
			"💫 Yes definitely",
			"🎯 You may rely on it",
			"🚀 As I see it, yes",
			"⭐ Most likely",
			"🎉 Outlook good",
			"💎 Yes",
			"🏆 Signs point to yes",

			// Negative responses
			"❌ Don't count on it",
			"🚫 My reply is no",
			"💔 My sources say no",
			"⛔ Outlook not so good",
			"🌑 Very doubtful",
			"❎ No way",
			"🔒 Absolutely not",

			// Neutral/uncertain responses
			"🤔 Reply hazy, try again",
			"💭 Ask again later",
			"🌀 Better not tell you now",
			"⏳ Cannot predict now",
			"🔮 Concentrate and ask again",
			"🎭 The future is unclear",
			"🌊 Signs are mixed",
			"⚖️ Could go either way",
		];

		const response = getRandomResponse(responses);

		// 🎨 Color based on response type
		let embedColor;
		if (
			response.includes("✨") ||
			response.includes("🌟") ||
			response.includes("💫") ||
			response.includes("🎯") ||
			response.includes("🚀") ||
			response.includes("⭐") ||
			response.includes("🎉") ||
			response.includes("💎") ||
			response.includes("🏆")
		) {
			embedColor = client.colors.success;
		} else if (
			response.includes("❌") ||
			response.includes("🚫") ||
			response.includes("💔") ||
			response.includes("⛔") ||
			response.includes("🌑") ||
			response.includes("❎") ||
			response.includes("🔒")
		) {
			embedColor = client.colors.error;
		} else {
			embedColor = client.colors.warning;
		}

		const eightBallEmbed = new EmbedBuilder()
			.setColor(embedColor)
			.setTitle("🎱 Magic 8-Ball Oracle")
			.addFields(
				{
					name: "❓ Your Question",
					value: `*"${question}"*`,
					inline: false,
				},
				{
					name: "🔮 The 8-Ball Says...",
					value: `**${response}**`,
					inline: false,
				},
			)
			.setThumbnail("https://cdn.discordapp.com/emojis/🎱.png")
			.setFooter({
				text: `Asked by ${interaction.user.tag} • The magic 8-ball has spoken!`,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTimestamp();

		await interaction.reply({ embeds: [eightBallEmbed] });
	},
};
