const { Events, EmbedBuilder } = require("discord.js");
const { GoogleGenAI } = require("@google/genai");
const Database = require("../../../utils/database");
const { sanitizeInput, isQuestion } = require("../../../utils/moderation");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const history = [];

module.exports = {
	name: Events.MessageCreate,
	async execute(message, client) {
		if (message.author.bot || !message.guild) return;

		try {
			const db = await Database.getInstance();
			await db.ensureConnection();
			await handleAIAssistant(message, db, client);
		} catch (error) {
			console.error("❌ Error in AI messageCreate handler:", error);
		}
	},
};

async function handleAIAssistant(message, db, client) {
	try {
		const config = await db.getServerConfig(message.guild.id);

		if (
			!config ||
			!config.aiEnabled ||
			config.aiMode === "disabled" ||
			config.aiMode === "context"
		) {
			return;
		}

		const listeningChannels = config.aiChannels || [];

		if (!listeningChannels.includes(message.channel.id)) {
			return;
		}

		if (!isQuestion(message.content)) {
			return;
		}

		const rateLimit = await db.checkRateLimit(
			message.author.id,
			message.guild.id,
			5,
			600000,
		);

		if (!rateLimit.allowed) {
			return;
		}

		let systemPrompt = `You are an AI assistant named Vaish in the Discord " ${message.guild.name} ". `;

		if (config.aiContext) {
			systemPrompt += `\n Here's important information about this server: ${config.aiContext} `;
		}

		const recentMessages = await message.channel.messages.fetch({
			limit: 5,
			before: message.id,
		});
		const channelContext = recentMessages
			.reverse()
			.map((msg) => `${msg.author.username}: ${sanitizeInput(msg.content)}`)
			.join("\n");

		systemPrompt += `\n\nRecent conversation context:\n${channelContext}\n\n`;
		systemPrompt +=
			"Please answer the user's question based on the information provided and recent context. If you don't have enough information, suggest they contact a moderator. Keep responses concise, helpful, and natural. You can reference the conversation context if relevant.";

		if (client.hooks) {
			const promptHook = await client.hooks.emitHook("onAIPrompt", {
				prompt: systemPrompt,
				context: {
					message,
					guildId: message.guild.id,
				},
			});

			systemPrompt = promptHook.payload.prompt || systemPrompt;
		}

		history.push({
			role: "user",
			parts: [{ text: message.content }],
		});

		const response = await ai.models.generateContent({
			model: "gemini-2.5-flash",
			contents: history,
			config: {
				systemInstruction: systemPrompt,
			},
		});

		history.push({
			role: "model",
			parts: [{ text: response.text }],
		});

		const truncatedResponse =
			response.text.length > 1500
				? response.text.substring(0, 1500) + "..."
				: response.text;

		const aiEmbed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle("🤖 AI Assistant")
			.setDescription(truncatedResponse)
			.setFooter({
				text: `Asked by ${message.author.tag}`,
				iconURL: message.author.displayAvatarURL(),
			})
			.setTimestamp();

		const reply = await message.reply({ embeds: [aiEmbed] });

		if (client.hooks) {
			await client.hooks.emitHook("onAIResponse", {
				response: response.text,
				context: {
					message,
					reply,
					guildId: message.guild.id,
				},
			});
		}
	} catch (error) {
		console.error("AI auto-response error:", error);
	}
}
