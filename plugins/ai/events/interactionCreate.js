const {
	Events,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} = require("discord.js");
const { GoogleGenAI } = require("@google/genai");
const Database = require("../../../utils/database");

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction, client) {
		if (interaction.isButton()) {
			if (interaction.customId === "show_context_modal") {
				await showContextModal(interaction);
			}

			if (interaction.customId.startsWith("ai_ask_again_")) {
				await handleAIAskAgain(interaction);
			}

			if (interaction.customId.startsWith("ai_feedback_")) {
				await handleAIFeedback(interaction, client);
			}

			if (interaction.customId.startsWith("ai_rate_")) {
				await handleAIRating(interaction, client);
			}
		}

		if (interaction.isModalSubmit()) {
			if (interaction.customId === "ai_context_modal") {
				await handleAIContextModal(interaction, client);
			}

			if (interaction.customId === "ai_ask_modal") {
				await handleAIAskModal(interaction, client);
			}
		}
	},
};

async function handleAIContextModal(interaction, client) {
	const context = interaction.fields.getTextInputValue("ai_context_input");

	try {
		const db = await Database.getInstance();
		await db.updateServerConfig(interaction.guild.id, {
			aiContext: context,
		});

		const successEmbed = new EmbedBuilder()
			.setColor(client.colors.success)
			.setTitle("✅ AI Context Updated")
			.setDescription(
				"Successfully updated the AI assistant context for your server.",
			)
			.addFields({
				name: "📝 Context Preview",
				value: context.substring(0, 500) + (context.length > 500 ? "..." : ""),
				inline: false,
			})
			.setFooter({
				text: `Updated by ${interaction.user.tag}`,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTimestamp();

		await interaction.reply({
			embeds: [successEmbed],
			flags: 64,
		});
	} catch (error) {
		console.error("❌ Error updating AI context:", error);

		const errorEmbed = new EmbedBuilder()
			.setColor(client.colors.error)
			.setTitle("❌ Error")
			.setDescription("Failed to update AI context. Please try again later.");

		await interaction.reply({
			embeds: [errorEmbed],
			flags: 64,
		});
	}
}

async function showContextModal(interaction) {
	const modal = new ModalBuilder()
		.setCustomId("ai_context_modal")
		.setTitle("🤖 Set AI Assistant Context");

	const contextInput = new TextInputBuilder()
		.setCustomId("ai_context_input")
		.setLabel("Server Information & FAQs")
		.setStyle(TextInputStyle.Paragraph)
		.setPlaceholder(
			"Enter server rules, FAQs, information that the AI should know about your server...\n\n" +
				"Example:\n" +
				"Server Rules:\n1. Be respectful\n2. No spam\n\n" +
				"FAQ:\nQ: How to get verified?\nA: Use /verify command",
		)
		.setRequired(true)
		.setMaxLength(3000);

	const row = new ActionRowBuilder().addComponents(contextInput);
	modal.addComponents(row);

	await interaction.showModal(modal);
}

async function handleAIAskAgain(interaction) {
	const modal = new ModalBuilder()
		.setCustomId("ai_ask_modal")
		.setTitle("🤖 Ask AI Assistant Anything");

	const questionInput = new TextInputBuilder()
		.setCustomId("ai_question_input")
		.setLabel("Your Question")
		.setStyle(TextInputStyle.Paragraph)
		.setPlaceholder("Ask me anything! I'm here to help.")
		.setRequired(true)
		.setMaxLength(1000);

	const row = new ActionRowBuilder().addComponents(questionInput);
	modal.addComponents(row);

	await interaction.showModal(modal);
}

async function handleAIFeedback(interaction, client) {
	const feedbackEmbed = new EmbedBuilder()
		.setColor(client.colors.primary)
		.setTitle("⭐ Rate AI Response")
		.setDescription(
			"How was the AI's response? Your feedback helps us improve!",
		)
		.addFields({
			name: "🎯 What we track",
			value:
				"• Response helpfulness\n• Accuracy\n• Clarity\n• Overall satisfaction",
			inline: false,
		})
		.setFooter({ text: "Your feedback is anonymous and helps improve the AI" });

	const feedbackRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`ai_rate_excellent_${interaction.user.id}`)
			.setLabel("Excellent")
			.setStyle(ButtonStyle.Success)
			.setEmoji("⭐"),
		new ButtonBuilder()
			.setCustomId(`ai_rate_good_${interaction.user.id}`)
			.setLabel("Good")
			.setStyle(ButtonStyle.Primary)
			.setEmoji("👍"),
		new ButtonBuilder()
			.setCustomId(`ai_rate_poor_${interaction.user.id}`)
			.setLabel("Poor")
			.setStyle(ButtonStyle.Danger)
			.setEmoji("👎"),
	);

	await interaction.reply({
		embeds: [feedbackEmbed],
		components: [feedbackRow],
		flags: 64,
	});
}

async function handleAIRating(interaction, client) {
	const rating = interaction.customId.split("_")[2];

	const ratingEmojis = {
		excellent: "⭐⭐⭐⭐⭐",
		good: "👍👍👍",
		poor: "👎",
	};

	const ratingMessages = {
		excellent: "Thank you! We're glad the AI was very helpful!",
		good: "Thanks for the feedback! We'll keep improving.",
		poor: "Thanks for letting us know. We'll work on improving the AI responses.",
	};

	const ratingEmbed = new EmbedBuilder()
		.setColor(
			rating === "excellent"
				? client.colors.success
				: rating === "good"
					? client.colors.primary
					: client.colors.warning,
		)
		.setTitle(`${ratingEmojis[rating]} Rating Submitted`)
		.setDescription(ratingMessages[rating])
		.setFooter({ text: "Your feedback helps us improve the AI assistant!" })
		.setTimestamp();

	console.log(
		`AI Feedback: ${rating} from ${interaction.user.tag} in ${interaction.guild.name}`,
	);

	await interaction.update({
		embeds: [ratingEmbed],
		components: [],
	});
}

async function handleAIAskModal(interaction, client) {
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
	const history = [];

	const question = interaction.fields.getTextInputValue("ai_question_input");

	const db = await Database.getInstance();
	const rateLimit = await db.checkRateLimit(
		interaction.user.id,
		interaction.guild.id,
		5,
		3600000,
	);

	if (!rateLimit.allowed) {
		const resetTime = Math.floor(rateLimit.resetTime.getTime() / 1000);
		const rateLimitEmbed = new EmbedBuilder()
			.setColor("#ff9900")
			.setTitle("⏱️ Rate Limited")
			.setDescription(
				`You've reached the AI request limit (5 per hour).\n\n**Reset:** <t:${resetTime}:R>`,
			)
			.setFooter({
				text: "Rate limiting helps manage API costs and ensures fair usage.",
			})
			.setTimestamp();

		return interaction.reply({ embeds: [rateLimitEmbed], ephemeral: true });
	}

	await interaction.deferReply();

	try {
		const systemPrompt =
			"You are a helpful AI assistant named ADB. Give concise answers of the questions, queries of the user";

		history.push({
			role: "user",
			parts: [{ text: question }],
		});

		const response = await ai.models.generateContent({
			model: "gemini-2.5-flash",
			contents: history,
			config: {
				systemInstruction: systemPrompt,
			},
		});

		const truncatedResponse =
			response.text.length > 1500
				? response.text.substring(0, 1500) + "..."
				: response.text;

		const aiEmbed = new EmbedBuilder()
			.setColor("#0099ff")
			.setTitle("🤖 AI Assistant")
			.setDescription(truncatedResponse)
			.addFields({
				name: "❓ Your Question",
				value:
					question.length > 200 ? question.substring(0, 200) + "..." : question,
				inline: false,
			})
			.setFooter({
				text: `Asked by ${interaction.user.tag}`,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTimestamp();

		const actionRow = new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(`ai_ask_again_${interaction.user.id}`)
				.setLabel("Ask Another")
				.setStyle(ButtonStyle.Primary)
				.setEmoji("🔄"),
			new ButtonBuilder()
				.setCustomId(`ai_rate_${interaction.user.id}`)
				.setLabel("Rate Response")
				.setStyle(ButtonStyle.Secondary)
				.setEmoji("⭐"),
		);

		await interaction.editReply({
			embeds: [aiEmbed],
			components: [actionRow],
		});
	} catch (error) {
		console.error("AI generation error:", error);

		let errorEmbed;

		if (error.message && error.message.includes("429")) {
			errorEmbed = new EmbedBuilder()
				.setColor("#ff6b6b")
				.setTitle("🚫 API Quota Exceeded")
				.setDescription(
					"The AI service is currently at its daily quota limit. This usually resets at midnight UTC.\n\n" +
						"**What you can do:**\n" +
						"• Try again later (quota resets daily)\n" +
						"• Use shorter, simpler questions\n" +
						"• Contact server admins if this persists\n\n" +
						"**Alternative:** Try using the `/help` command for basic information!",
				)
				.setFooter({
					text: "We're using Google's free tier - quota limits help keep the bot free!",
				})
				.setTimestamp();
		} else if (error.message && error.message.includes("SAFETY")) {
			errorEmbed = new EmbedBuilder()
				.setColor("#ff9900")
				.setTitle("🛡️ Content Safety Filter")
				.setDescription(
					"Your question was flagged by the AI's safety filters. Please try rephrasing your question in a different way.",
				)
				.setTimestamp();
		} else {
			errorEmbed = new EmbedBuilder()
				.setColor("#ff0000")
				.setTitle("❌ AI Error")
				.setDescription(
					"Sorry, I encountered an error processing your question. Please try again in a moment.",
				)
				.setTimestamp();
		}

		await interaction.editReply({ embeds: [errorEmbed] });
	}
}
