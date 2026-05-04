const {
	Events,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	StringSelectMenuBuilder,
} = require("discord.js");

const Database = require("../utils/database");

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction, client) {
		// 🎯 Handle slash commands
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.commands.get(interaction.commandName);

			if (!command) {
				console.error(
					`❌ No command matching ${interaction.commandName} was found.`,
				);
				return;
			}

			// 🔄 Cooldown system
			const { cooldowns } = interaction.client;

			if (!cooldowns.has(command.data.name)) {
				cooldowns.set(command.data.name, new Map());
			}

			const now = Date.now();
			const timestamps = cooldowns.get(command.data.name);
			const defaultCooldownDuration = 3;
			const cooldownAmount =
				(command.cooldown ?? defaultCooldownDuration) * 1000;

			if (timestamps.has(interaction.user.id)) {
				const expirationTime =
					timestamps.get(interaction.user.id) + cooldownAmount;

				if (now < expirationTime) {
					const expiredTimestamp = Math.round(expirationTime / 1000);

					const cooldownEmbed = new EmbedBuilder()
						.setColor("#FFA500")
						.setTitle("⏱️ Slow down there!")
						.setDescription(
							`Please wait <t:${expiredTimestamp}:R> before using \`/${command.data.name}\` again.`,
						)
						.setTimestamp();

					return interaction.reply({
						embeds: [cooldownEmbed],
						flags: 64, // MessageFlags.Ephemeral
					});
				}
			}

			timestamps.set(interaction.user.id, now);
			setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

			// 🛡️ Execute command with error handling
			try {
				await command.execute(interaction, client);
			} catch (error) {
				console.error(`❌ Error executing ${interaction.commandName}:`, error);

				const errorEmbed = new EmbedBuilder()
					.setColor("#FF0000")
					.setTitle("⚠️ Something went wrong!")
					.setDescription(
						"There was an error while executing this command. Please try again later.",
					)
					.setTimestamp();

				try {
					if (interaction.replied || interaction.deferred) {
						await interaction.followUp({
							embeds: [errorEmbed],
							flags: 64, // MessageFlags.Ephemeral
						});
					} else {
						await interaction.reply({
							embeds: [errorEmbed],
							flags: 64, // MessageFlags.Ephemeral
						});
					}
				} catch (replyError) {
					console.error("Failed to send error message:", replyError);
				}
			}
		}

		// 🎮 Handle button interactions
		if (interaction.isButton()) {
			// Handle help menu navigation
			if (interaction.customId.startsWith("help_")) {
				await handleHelpNavigation(interaction, client);
			}

			// Handle feedback interactions
			if (interaction.customId.startsWith("feedback_")) {
				await handleFeedbackInteraction(interaction, client);
			}

			// Handle AI context modal
			if (interaction.customId === "show_context_modal") {
				await showContextModal(interaction, client);
			}

			// Handle Truth or Dare buttons
			if (interaction.customId.startsWith("tod_")) {
				await handleTruthOrDareButton(interaction, client);
			}

			// Handle AI assistant buttons
			if (interaction.customId.startsWith("ai_ask_again_")) {
				await handleAIAskAgain(interaction, client);
			}

			if (interaction.customId.startsWith("ai_feedback_")) {
				await handleAIFeedback(interaction, client);
			}

			// Handle AI rating buttons
			if (interaction.customId.startsWith("ai_rate_")) {
				await handleAIRating(interaction, client);
			}

			// Handle ticket system buttons
			if (interaction.customId.startsWith("ticket_")) {
				await handleTicketButtons(interaction, client);
			}

			// Handle reminder buttons
			if (interaction.customId.startsWith("reminder_")) {
				await handleReminderButtons(interaction, client);
			}
		}

		// 📋 Handle select menu interactions
		if (interaction.isStringSelectMenu()) {
			if (interaction.customId === "feedback_select") {
				await handleFeedbackSelection(interaction, client);
			}
		}

		// 📝 Handle modal submissions
		if (interaction.isModalSubmit()) {
			if (interaction.customId === "feedback_submit") {
				await handleFeedbackSubmission(interaction, client);
			}

			// Handle AI context modal (if it exists)
			if (interaction.customId === "ai_context_modal") {
				await handleAIContextModal(interaction, client);
			}

			// Handle AI ask modal submission
			if (interaction.customId === "ai_ask_modal") {
				await handleAIAskModal(interaction, client);
			}

			// Handle ticket closing modal
			if (interaction.customId.startsWith("close_ticket_modal_")) {
				await handleCloseTicketModal(interaction, client);
			}
		}
	},
};

// 📚 Help navigation handler
async function handleHelpNavigation(interaction, client) {
	const {
		EmbedBuilder,
		ActionRowBuilder,
		ButtonBuilder,
		ButtonStyle,
	} = require("discord.js");
	const helpCommand = require("../commands/general/help");

	const category = interaction.customId.split("_")[1];

	if (category === "refresh") {
		// Return to main help menu
		return await helpCommand.execute(interaction, client);
	}

	const categoryData = helpCommand.getCommands[category];
	if (!categoryData) {
		return await interaction.reply({
			content: "❌ Category not found!",
			flags: 64,
		});
	}

	const categoryEmbed = new EmbedBuilder()
		.setColor(categoryData.color)
		.setTitle(categoryData.title)
		.setDescription(categoryData.description)
		.addFields({
			name: "📋 Available Commands",
			value: categoryData.commands.join("\n"),
			inline: false,
		})
		.setFooter({
			text: `Requested by ${interaction.user.tag}`,
			iconURL: interaction.user.displayAvatarURL(),
		})
		.setTimestamp();

	const backRow = new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId("help_refresh")
			.setLabel("◀️ Back to Menu")
			.setStyle(ButtonStyle.Secondary),
	);

	await interaction.update({
		embeds: [categoryEmbed],
		components: [backRow],
	});
}

// 📝 Feedback interaction handler
async function handleFeedbackInteraction(interaction, client) {
	const {
		EmbedBuilder,
		ModalBuilder,
		TextInputBuilder,
		TextInputStyle,
		ActionRowBuilder,
	} = require("discord.js");

	if (interaction.customId === "feedback_modal") {
		const modal = new ModalBuilder()
			.setCustomId("feedback_submit")
			.setTitle("📝 Send Feedback");

		const typeInput = new TextInputBuilder()
			.setCustomId("feedback_type")
			.setLabel("Feedback Type")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Bug Report, Feature Request, General Feedback, etc.")
			.setRequired(true)
			.setMaxLength(50);

		const titleInput = new TextInputBuilder()
			.setCustomId("feedback_title")
			.setLabel("Title")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Brief title for your feedback")
			.setRequired(true)
			.setMaxLength(100);

		const descriptionInput = new TextInputBuilder()
			.setCustomId("feedback_description")
			.setLabel("Description")
			.setStyle(TextInputStyle.Paragraph)
			.setPlaceholder("Detailed description of your feedback...")
			.setRequired(true)
			.setMaxLength(1000);

		const contactInput = new TextInputBuilder()
			.setCustomId("feedback_contact")
			.setLabel("Contact Info (Optional)")
			.setStyle(TextInputStyle.Short)
			.setPlaceholder("Discord tag, email, etc. (optional)")
			.setRequired(false)
			.setMaxLength(100);

		const row1 = new ActionRowBuilder().addComponents(typeInput);
		const row2 = new ActionRowBuilder().addComponents(titleInput);
		const row3 = new ActionRowBuilder().addComponents(descriptionInput);
		const row4 = new ActionRowBuilder().addComponents(contactInput);

		modal.addComponents(row1, row2, row3, row4);
		await interaction.showModal(modal);
	}
}

// 📋 Feedback selection handler
async function handleFeedbackSelection(interaction, client) {
	const { EmbedBuilder } = require("discord.js");

	const feedbackType = interaction.values[0];

	const embed = new EmbedBuilder()
		.setColor(client.colors.success)
		.setTitle("📝 Feedback Form")
		.setDescription(
			`You selected: **${feedbackType}**\n\nPlease fill out the form that will appear.`,
		)
		.setFooter({ text: "Thank you for helping us improve!" });

	await interaction.reply({
		embeds: [embed],
		flags: 64,
	});
}

// 📝 Feedback submission handler
async function handleFeedbackSubmission(interaction, client) {
	const { EmbedBuilder } = require("discord.js");

	const feedbackType = interaction.fields.getTextInputValue("feedback_type");
	const title = interaction.fields.getTextInputValue("feedback_title");
	const description = interaction.fields.getTextInputValue(
		"feedback_description",
	);
	const contact =
		interaction.fields.getTextInputValue("feedback_contact") || "Not provided";

	// Create feedback embed for developers
	const feedbackEmbed = new EmbedBuilder()
		.setColor(client.colors.primary)
		.setTitle(`📝 New Feedback: ${feedbackType}`)
		.setDescription(title)
		.addFields(
			{
				name: "📋 Description",
				value: description,
				inline: false,
			},
			{
				name: "👤 User",
				value: `${interaction.user.tag} (${interaction.user.id})`,
				inline: true,
			},
			{
				name: "🏠 Server",
				value: `${interaction.guild.name} (${interaction.guild.id})`,
				inline: true,
			},
			{
				name: "📞 Contact",
				value: contact,
				inline: true,
			},
		)
		.setThumbnail(interaction.user.displayAvatarURL())
		.setTimestamp();

	// Send to feedback channel (you can configure this)
	// const feedbackChannel = client.channels.cache.get("YOUR_FEEDBACK_CHANNEL_ID");
	// if (feedbackChannel) {
	//   await feedbackChannel.send({ embeds: [feedbackEmbed] });
	// }

	// Log to console for now
	console.log("📝 New Feedback Received:", {
		type: feedbackType,
		title,
		user: interaction.user.tag,
		server: interaction.guild.name,
	});

	// Confirm to user
	const confirmEmbed = new EmbedBuilder()
		.setColor(client.colors.success)
		.setTitle("✅ Feedback Submitted!")
		.setDescription(
			"Thank you for your feedback! Our team will review it soon.",
		)
		.addFields({
			name: "📋 Your Submission",
			value: `**Type:** ${feedbackType}\n**Title:** ${title}`,
			inline: false,
		})
		.setFooter({ text: "We appreciate your input!" });

	await interaction.reply({
		embeds: [confirmEmbed],
		flags: 64,
	});
}

// 🤖 AI Context modal handler
async function handleAIContextModal(interaction, client) {
	const { EmbedBuilder } = require("discord.js");
	const Database = require("../utils/database");

	const context = interaction.fields.getTextInputValue("ai_context_input");

	try {
		const db = await Database.getInstance();
		await db.updateServerConfig(interaction.guild.id, {
			ai_context: context,
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

// 🤖 Show context modal
async function showContextModal(interaction, client) {
	const {
		ModalBuilder,
		TextInputBuilder,
		TextInputStyle,
		ActionRowBuilder,
	} = require("discord.js");

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

// 🎮 Handle Truth or Dare button interactions
async function handleTruthOrDareButton(interaction, client) {
	const { EmbedBuilder, MessageFlags } = require("discord.js");
	const Database = require("../utils/database");
	const {
		getRandomTruthOrDare,
	} = require("../commands/truth-or-dare/truthordare");

	const customIdParts = interaction.customId.split("_");
	const action = customIdParts[1]; // "truth", "dare", "random", "rules", "stats"
	const targetUserId = customIdParts[2];

	// Handle non-game actions first
	if (action === "rules") {
		const rulesEmbed = new EmbedBuilder()
			.setColor("#4287f5")
			.setTitle("📋 Truth or Dare Rules")
			.setDescription("Keep it fun and respectful for everyone!")
			.addFields(
				{
					name: "✅ Do's",
					value:
						"• Be honest with truths\n• Complete dares safely\n• Respect others' boundaries\n• Keep it appropriate for the server",
					inline: false,
				},
				{
					name: "❌ Don'ts",
					value:
						"• Share inappropriate content\n• Do anything harmful or illegal\n• Force participation\n• Break server rules",
					inline: false,
				},
				{
					name: "🛡️ Safety First",
					value:
						"If you're uncomfortable with a truth or dare, you can always skip it. Your safety and comfort matter most!",
					inline: false,
				},
			)
			.setFooter({ text: "Have fun and play responsibly!" });

		return interaction.reply({
			embeds: [rulesEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	if (action === "stats") {
		try {
			const db = await Database.getInstance();
			const config = await db.TruthOrDareConfig.findOne({
				guildId: interaction.guild.id,
			});

			const customTruths = config?.customTruths?.length || 0;
			const customDares = config?.customDares?.length || 0;
			const totalCustom = customTruths + customDares;

			const statsEmbed = new EmbedBuilder()
				.setColor("#00ff88")
				.setTitle("📊 Truth or Dare Server Stats")
				.setDescription(`Statistics for **${interaction.guild.name}**`)
				.addFields(
					{
						name: "💭 Custom Truths",
						value: `${customTruths}`,
						inline: true,
					},
					{
						name: "🎯 Custom Dares",
						value: `${customDares}`,
						inline: true,
					},
					{
						name: "🎮 Total Custom Content",
						value: `${totalCustom}`,
						inline: true,
					},
					{
						name: "📚 Default Content",
						value: "15 truths, 15 dares",
						inline: true,
					},
					{
						name: "🎲 Total Available",
						value: `${30 + totalCustom} questions/dares`,
						inline: true,
					},
					{
						name: "⚙️ Status",
						value: config?.enabled !== false ? "✅ Enabled" : "❌ Disabled",
						inline: true,
					},
				)
				.setFooter({ text: "Use /truthordare add to contribute content!" });

			return interaction.reply({
				embeds: [statsEmbed],
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			console.error("Error fetching ToD stats:", error);
			return interaction.reply({
				content: "❌ Failed to fetch server stats.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	// Check if the user clicking is the target user or the original user
	if (
		interaction.user.id !== targetUserId &&
		interaction.user.id !== interaction.message.interaction?.user?.id
	) {
		const notAllowedEmbed = new EmbedBuilder()
			.setColor("#ff0000")
			.setTitle("❌ Not Allowed")
			.setDescription(
				"Only the targeted user can respond to this Truth or Dare!",
			)
			.setTimestamp();

		return interaction.reply({
			embeds: [notAllowedEmbed],
			flags: MessageFlags.Ephemeral,
		});
	}

	try {
		const db = await Database.getInstance();

		// Check cooldown
		const config = await db.TruthOrDareConfig.findOne({
			guildId: interaction.guild.id,
		});
		const cooldownTime = (config?.cooldownTime || 5) * 1000;

		// Simple cooldown check using user interaction timestamp
		const lastUsed = client.truthOrDareCooldowns?.get(interaction.user.id) || 0;
		const now = Date.now();

		if (now - lastUsed < cooldownTime) {
			const remainingTime = Math.ceil((cooldownTime - (now - lastUsed)) / 1000);
			const cooldownEmbed = new EmbedBuilder()
				.setColor("#ffaa00")
				.setTitle("⏱️ Cooldown Active")
				.setDescription(
					`Please wait ${remainingTime} more seconds before using Truth or Dare again.`,
				)
				.setTimestamp();

			return interaction.reply({
				embeds: [cooldownEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}

		// Set cooldown
		if (!client.truthOrDareCooldowns) client.truthOrDareCooldowns = new Map();
		client.truthOrDareCooldowns.set(interaction.user.id, now);

		// Determine the type (handle random selection)
		let type = action;
		if (action === "random") {
			type = Math.random() < 0.5 ? "truth" : "dare";
		}

		// Get random truth or dare
		const question = await getRandomTruthOrDare(db, interaction.guild.id, type);

		const resultEmbed = new EmbedBuilder()
			.setColor(type === "truth" ? "#4287f5" : "#ff4757")
			.setTitle(type === "truth" ? "💭 Truth Question" : "🎯 Dare Challenge")
			.setDescription(question)
			.addFields(
				{
					name: "For",
					value: `<@${targetUserId}>`,
					inline: true,
				},
				{
					name: "Type",
					value:
						action === "random"
							? `🎲 Random (${type})`
							: type.charAt(0).toUpperCase() + type.slice(1),
					inline: true,
				},
			)
			.setThumbnail(
				interaction.guild.members.cache.get(targetUserId)?.displayAvatarURL() ||
					null,
			)
			.setFooter({
				text: `Have fun and stay safe! • ${
					type === "truth" ? "Be honest" : "Be careful"
				}`,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTimestamp();

		await interaction.update({ embeds: [resultEmbed], components: [] });
	} catch (error) {
		console.error("Error handling Truth or Dare button:", error);

		const errorEmbed = new EmbedBuilder()
			.setColor("#ff0000")
			.setTitle("❌ Error")
			.setDescription(
				"An error occurred while processing your Truth or Dare request.",
			)
			.setTimestamp();

		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		} else {
			await interaction.reply({
				embeds: [errorEmbed],
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}

// 🤖 Handle AI ask again interaction
async function handleAIAskAgain(interaction, client) {
	const {
		ModalBuilder,
		TextInputBuilder,
		TextInputStyle,
		ActionRowBuilder,
	} = require("discord.js");

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

// ⭐ Handle AI feedback button
async function handleAIFeedback(interaction, client) {
	const {
		EmbedBuilder,
		ActionRowBuilder,
		ButtonBuilder,
		ButtonStyle,
	} = require("discord.js");

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

// ⭐ Handle AI rating
async function handleAIRating(interaction, client) {
	const { EmbedBuilder } = require("discord.js");

	const rating = interaction.customId.split("_")[2]; // excellent, good, or poor

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

	// Log the feedback (you could save this to database for analytics)
	console.log(
		`AI Feedback: ${rating} from ${interaction.user.tag} in ${interaction.guild.name}`,
	);

	await interaction.update({
		embeds: [ratingEmbed],
		components: [],
	});
}

// 🤖 Handle AI ask modal submission
async function handleAIAskModal(interaction, client) {
	const { GoogleGenAI } = require("@google/genai");
	const {
		EmbedBuilder,
		ActionRowBuilder,
		ButtonBuilder,
		ButtonStyle,
	} = require("discord.js");
	const Database = require("../utils/database");
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	const history = [];

	const question = interaction.fields.getTextInputValue("ai_question_input");

	// Check rate limiting (5 requests per hour - same as slash command)
	const db = await Database.getInstance();
	const rateLimit = await db.checkRateLimit(
		interaction.user.id,
		interaction.guild.id,
		5, // 5 requests
		3600000, // 1 hour
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
		// Initialize Gemini AI
		const systemPrompt = `You are a helpful AI assistant named Vaish. Give concise answers of the questions, queries of the user`;

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

		// Truncate if too long
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

		// Add modern UI components for user interaction
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

		// Handle specific API errors
		if (error.message && error.message.includes("429")) {
			// Gemini API quota exceeded
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
		} else if (
			error.status === 429 ||
			(error.response && error.response.status === 429)
		) {
			// Another way quota exceeded error might appear
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
			// Content safety filter triggered
			errorEmbed = new EmbedBuilder()
				.setColor("#ff9900")
				.setTitle("🛡️ Content Safety Filter")
				.setDescription(
					"Your question was flagged by the AI's safety filters. Please try rephrasing your question in a different way.",
				)
				.setTimestamp();
		} else {
			// Generic error
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

// ⏰ Handle reminder buttons
async function handleReminderButtons(interaction, client) {
	const { EmbedBuilder } = require("discord.js");

	const action = interaction.customId.split("_")[1]; // info, tips, snooze, done

	switch (action) {
		case "info":
			const infoEmbed = new EmbedBuilder()
				.setColor(client.colors.primary)
				.setTitle("📋 Reminder Information")
				.setDescription("Here's everything you need to know about reminders:")
				.addFields(
					{
						name: "📬 Delivery Method",
						value:
							"• Direct Messages (preferred)\n• Channel fallback if DMs fail\n• Make sure your DMs are open",
						inline: false,
					},
					{
						name: "⏱️ Time Formats",
						value:
							"• `30s` - 30 seconds\n• `5m` - 5 minutes\n• `2h` - 2 hours\n• `1d` - 1 day\n• `1w` - 1 week",
						inline: true,
					},
					{
						name: "🛡️ Limits",
						value:
							"• Minimum: 30 seconds\n• Maximum: 1 year\n• Cooldown: 5 seconds",
						inline: true,
					},
				)
				.setFooter({ text: "Use reminders responsibly!" });

			await interaction.reply({ embeds: [infoEmbed], flags: 64 });
			break;

		case "tips":
			const tipsEmbed = new EmbedBuilder()
				.setColor(client.colors.success)
				.setTitle("💡 Reminder Tips & Best Practices")
				.setDescription("Get the most out of your reminders:")
				.addFields(
					{
						name: "✅ Do's",
						value:
							"• Be specific in your reminder text\n• Include context for future you\n• Use appropriate time frames\n• Enable DMs for reliable delivery",
						inline: false,
					},
					{
						name: "❌ Don'ts",
						value:
							"• Don't spam short reminders\n• Avoid setting too many at once\n• Don't rely on bot for critical tasks\n• Don't use offensive language",
						inline: false,
					},
					{
						name: "🔥 Pro Tips",
						value:
							"• Include action items: 'Call John about project'\n• Use time zones: 'Meeting at 3pm EST'\n• Be descriptive: 'Take medicine after lunch'",
						inline: false,
					},
				)
				.setFooter({ text: "Happy reminder setting!" });

			await interaction.reply({ embeds: [tipsEmbed], flags: 64 });
			break;

		case "snooze":
			// Set a 5-minute snooze
			setTimeout(
				async () => {
					try {
						const snoozeEmbed = new EmbedBuilder()
							.setColor(client.colors.warning)
							.setTitle("💤 Snooze Alert!")
							.setDescription("Your snoozed reminder is here!")
							.addFields({
								name: "⏰ Snoozed",
								value: "5 minutes ago",
								inline: true,
							})
							.setFooter({ text: "This was a snoozed reminder" })
							.setTimestamp();

						await interaction.user.send({ embeds: [snoozeEmbed] });
					} catch (error) {
						console.error("Failed to send snooze reminder:", error);
					}
				},
				5 * 60 * 1000,
			); // 5 minutes

			const snoozeConfirmEmbed = new EmbedBuilder()
				.setColor(client.colors.success)
				.setTitle("💤 Reminder Snoozed")
				.setDescription("I'll remind you again in 5 minutes!")
				.setTimestamp();

			await interaction.update({
				embeds: [snoozeConfirmEmbed],
				components: [],
			});
			break;

		case "done":
			const doneEmbed = new EmbedBuilder()
				.setColor(client.colors.success)
				.setTitle("✅ Reminder Completed")
				.setDescription("Great job! Reminder marked as done.")
				.setFooter({ text: "Thanks for staying organized!" })
				.setTimestamp();

			await interaction.update({ embeds: [doneEmbed], components: [] });
			break;
	}
}

// 🎫 Handle ticket system button interactions
async function handleTicketButtons(interaction, client) {
	const Database = require("../utils/database");
	const { isModeratorOrOwner } = require("../utils/moderation");

	const db = await Database.getInstance();
	const customId = interaction.customId;

	try {
		if (customId.startsWith("ticket_claim_")) {
			const ticketId = customId.split("_")[2];

			// Check if user is a moderator
			if (!isModeratorOrOwner(interaction.member, interaction.guild)) {
				return await interaction.reply({
					content: "❌ Only moderators can claim tickets.",
					ephemeral: true,
				});
			}

			// Update ticket in database
			await db.updateTicket(ticketId, {
				moderatorId: interaction.user.id,
				status: "in_progress",
			});

			// Update embed
			const ticket = await db.getTicketById(ticketId);
			const embed = EmbedBuilder.from(interaction.message.embeds[0])
				.addFields({
					name: "👨‍💼 Claimed by",
					value: `${interaction.user}`,
					inline: true,
				})
				.setColor("#FFA500");

			// Update buttons
			const newButtons = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(`ticket_unclaim_${ticketId}`)
					.setLabel("❌ Unclaim")
					.setStyle(ButtonStyle.Secondary),
				new ButtonBuilder()
					.setCustomId(`ticket_close_${ticketId}`)
					.setLabel("🔒 Close Ticket")
					.setStyle(ButtonStyle.Danger),
				new ButtonBuilder()
					.setCustomId(`ticket_priority_${ticketId}`)
					.setLabel("📊 Change Priority")
					.setStyle(ButtonStyle.Secondary),
			);

			await interaction.update({
				embeds: [embed],
				components: [newButtons],
			});

			await interaction.followUp({
				content: `✅ ${interaction.user} has claimed this ticket and will assist you.`,
				ephemeral: false,
			});
		} else if (customId.startsWith("ticket_close_")) {
			const ticketId = customId.split("_")[2];

			// Check if user is a moderator or ticket creator
			const ticket = await db.getTicketById(ticketId);
			const isMod = isModeratorOrOwner(interaction.member, interaction.guild);
			const isCreator = ticket.userId === interaction.user.id;

			if (!isMod && !isCreator) {
				return await interaction.reply({
					content:
						"❌ Only moderators or the ticket creator can close tickets.",
					ephemeral: true,
				});
			}

			// Show confirmation modal
			const modal = new ModalBuilder()
				.setCustomId(`close_ticket_modal_${ticketId}`)
				.setTitle("Close Ticket");

			const reasonInput = new TextInputBuilder()
				.setCustomId("close_reason")
				.setLabel("Reason for closing (optional)")
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(false)
				.setMaxLength(500);

			modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

			await interaction.showModal(modal);
		} else if (customId.startsWith("ticket_priority_")) {
			const ticketId = customId.split("_")[2];

			// Check if user is a moderator
			if (!isModeratorOrOwner(interaction.member, interaction.guild)) {
				return await interaction.reply({
					content: "❌ Only moderators can change ticket priority.",
					ephemeral: true,
				});
			}

			// Show priority selection
			const priorityRow = new ActionRowBuilder().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId(`priority_select_${ticketId}`)
					.setPlaceholder("Select new priority level")
					.addOptions([
						{
							label: "🔴 High Priority",
							value: "high",
							description: "Urgent issues requiring immediate attention",
						},
						{
							label: "🟡 Medium Priority",
							value: "medium",
							description: "Standard issues with normal response time",
						},
						{
							label: "🟢 Low Priority",
							value: "low",
							description: "Minor issues with flexible response time",
						},
					]),
			);

			await interaction.reply({
				content: "Select the new priority level:",
				components: [priorityRow],
				ephemeral: true,
			});
		}
	} catch (error) {
		console.error("Error handling ticket button:", error);
		await interaction.reply({
			content: "❌ An error occurred while processing your request.",
			ephemeral: true,
		});
	}
}

// 🔒 Handle close ticket modal submission
async function handleCloseTicketModal(interaction, client) {
	const Database = require("../utils/database");
	const db = await Database.getInstance();

	const ticketId = interaction.customId.split("_")[3];
	const closeReason =
		interaction.fields.getTextInputValue("close_reason") ||
		"No reason provided";

	try {
		// Get ticket data
		const ticket = await db.getTicketById(ticketId);
		if (!ticket) {
			return await interaction.reply({
				content: "❌ Ticket not found.",
				ephemeral: true,
			});
		}

		// Update ticket status to closed
		await db.updateTicket(ticketId, {
			status: "closed",
			closedAt: new Date(),
			closedBy: interaction.user.id,
			closeReason: closeReason,
		});

		// Create closing embed
		const closeEmbed = new EmbedBuilder()
			.setColor("#FF0000")
			.setTitle("🔒 Ticket Closed")
			.setDescription("This ticket has been closed.")
			.addFields(
				{
					name: "👤 Closed by",
					value: `${interaction.user}`,
					inline: true,
				},
				{
					name: "📅 Closed at",
					value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
					inline: true,
				},
				{
					name: "📝 Reason",
					value: closeReason,
					inline: false,
				},
			)
			.setFooter({ text: "This channel will be deleted in 30 seconds." })
			.setTimestamp();

		// Send closing message
		await interaction.reply({
			embeds: [closeEmbed],
		});

		// Delete the channel after 30 seconds
		setTimeout(async () => {
			try {
				if (interaction.channel && interaction.channel.deletable) {
					await interaction.channel.delete();
				}
			} catch (error) {
				console.error("Error deleting ticket channel:", error);
			}
		}, 30000);

		console.log(
			`🔒 Ticket #${ticket.ticketId || ticketId} closed by ${interaction.user.tag}`,
		);
	} catch (error) {
		console.error("Error closing ticket:", error);
		await interaction.reply({
			content: "❌ An error occurred while closing the ticket.",
			ephemeral: true,
		});
	}
}
