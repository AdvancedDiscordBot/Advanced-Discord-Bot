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
			let command = interaction.client.commands.get(interaction.commandName);

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

			// 🧩 Run hook pipeline before command
			if (client.hooks) {
				const hookResult = await client.hooks.emitHook("beforeCommand", {
					interaction,
					command,
				});

				if (hookResult.cancelled) {
					return;
				}

				interaction = hookResult.payload.interaction || interaction;
				command = hookResult.payload.command || command;
			}

			// 🛡️ Execute command with error handling
			try {
				const result = await command.execute(interaction, client);

				if (client.hooks) {
					await client.hooks.emitHook("afterCommand", {
						interaction,
						command,
						result,
					});
				}
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
			// Handle feedback interactions
			if (interaction.customId.startsWith("feedback_")) {
				await handleFeedbackInteraction(interaction, client);
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

			// Handle ticket closing modal
			if (interaction.customId.startsWith("close_ticket_modal_")) {
				await handleCloseTicketModal(interaction, client);
			}
		}
	},
};

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
