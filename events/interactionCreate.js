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
	PermissionsBitField,
	PermissionFlagsBits,
} = require("discord.js");

const Database = require("../utils/database");
const { isModeratorOrOwner } = require("../utils/moderation");

async function replyError(interaction, content) {
	try {
		if (interaction.isAutocomplete?.()) {
			if (!interaction.responded) await interaction.respond([]);
		} else if (interaction.deferred && !interaction.replied) {
			await interaction.editReply({ content, embeds: [], components: [] });
		} else if (interaction.replied) {
			await interaction.followUp({ content, flags: 64 });
		} else {
			await interaction.reply({ content, flags: 64 });
		}
	} catch (error) {
		console.error("Failed to send interaction error:", error);
	}
}

// Modal-capable commands cannot be deferred preemptively. Stop slow permission
// reads before the initial response deadline instead of letting them authorize.
async function permissionLookup(interaction, read) {
	const age = Math.max(0, Date.now() - (interaction.createdTimestamp ?? Date.now()));
	const timeout = interaction.deferred || interaction.replied ? 2000 : Math.min(2000, 2500 - age);
	if (timeout <= 0) throw new Error("Permission lookup deadline exceeded");
	let timer;
	try {
		return await Promise.race([
			Promise.resolve().then(read),
			new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Permission lookup timed out")), timeout); }),
		]);
	} finally {
		clearTimeout(timer);
	}
}

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction, client) {
		client = client || interaction.client;
		try {
			const autocomplete = interaction.isAutocomplete?.() === true;
			const contextMenu = interaction.isContextMenuCommand?.() || interaction.isUserContextMenuCommand?.() || interaction.isMessageContextMenuCommand?.();
			if (autocomplete || interaction.isChatInputCommand?.() || contextMenu) {
				const command = client.commands.get(interaction.commandName);
				const manager = client.pluginManager;
				const type = autocomplete ? 1 : interaction.commandType ?? (interaction.isUserContextMenuCommand?.() ? 2 : interaction.isMessageContextMenuCommand?.() ? 3 : 1);
				const registration = () => {
					if (!command || client.commands.get(interaction.commandName) !== command || command.enabled === false) return null;
					const definition = command.guildData === undefined ? command.data :
						Object.prototype.hasOwnProperty.call(command.guildData || {}, interaction.guildId) && command.guildData[interaction.guildId];
					const data = definition?.toJSON ? definition.toJSON() : definition;
					if (!data || data.name !== interaction.commandName || (data.type ?? 1) !== type) return null;
					if (command.guildIds !== undefined && (!Array.isArray(command.guildIds) || !command.guildIds.includes(interaction.guildId))) return null;
					const pluginName = manager?.getCommandOwner?.(command);
					const pluginState = manager?.plugins.get(pluginName);
					if (manager && (!pluginState?.enabled || pluginState.loaded === false || manager.broker?.isSuspended(pluginName) || pluginState.suspended)) return null;
					if (manager && interaction.guildId && manager.isGuildGateable(pluginName) && manager.isEnabledForGuild(interaction.guildId, pluginName) !== true) return null;
					const source = interaction.memberPermissions ?? interaction.member?.permissions;
					const available = new PermissionsBitField(interaction.guild?.ownerId === interaction.user.id ? PermissionFlagsBits.Administrator : source?.bitfield ?? source ?? 0n);
					for (const [required, isDefault] of [[command.permissions, false], [data.default_member_permissions ?? data.defaultMemberPermissions, true]]) {
						if (required === undefined || required === null) continue;
						const bits = PermissionsBitField.resolve(required);
						if (!available.has(isDefault && bits === 0n ? PermissionFlagsBits.Administrator : bits)) return null;
					}
					return { pluginName, pluginState };
				};
				const owner = registration();
				if (!owner) return await replyError(interaction, "This command is unavailable or you do not have permission to use it here.");

				if (interaction.guildId && owner.pluginState?.manifest?.settings?.commandPermissions) {
					const cfg = await permissionLookup(interaction, async () => {
						const db = manager.db || await Database.getInstance();
						return db.getPluginConfig(interaction.guildId, owner.pluginName);
					});
					const cmdCfg = cfg?.data?._commands?.[interaction.commandName];
					if (cmdCfg?.enabled !== undefined && typeof cmdCfg.enabled !== "boolean") throw new Error("Invalid command enable flag");
					if (cmdCfg?.enabled === false) return await replyError(interaction, "This command is disabled on this server.");
					const allowedRoles = cmdCfg?.allowedRoles;
					if (allowedRoles !== undefined) {
						if (!Array.isArray(allowedRoles) || !allowedRoles.every((role) => typeof role === "string")) throw new Error("Invalid command role restrictions");
						const roles = interaction.member?.roles;
						const roleIds = new Set(Array.isArray(roles) ? roles : roles?.cache?.keys() || []);
						if (allowedRoles.length && !allowedRoles.some((role) => roleIds.has(role))) return await replyError(interaction, "You do not have the required role to use this command.");
					}
				}

				if (autocomplete) {
					if (registration() && typeof command.autocomplete === "function") await command.autocomplete(interaction, client);
					if (!interaction.responded) await interaction.respond([]);
					return;
				}
				if (client.hooks) {
					const hookResult = await client.hooks.emitHook("beforeCommand", { interaction, command });
					if (hookResult?.cancelled) {
						if (!interaction.replied) await replyError(interaction, "Command cancelled.");
						return;
					}
					// Hooks may modify the registered command, but cannot substitute an
					// unchecked command or a different authenticated interaction.
					if ((hookResult?.payload?.command && hookResult.payload.command !== command) || (hookResult?.payload?.interaction && hookResult.payload.interaction !== interaction)) throw new Error("Hook replaced command routing identity");
				}
				if (!registration()) return await replyError(interaction, "This command is no longer available here.");

				const cooldown = command.cooldown ?? 3;
				if (typeof cooldown !== "number" || !Number.isFinite(cooldown) || cooldown < 0 || cooldown * 1000 > 2147483647) throw new Error("Invalid command cooldown");
				if (cooldown > 0) {
					const cooldowns = client.cooldowns || (client.cooldowns = new Map());
					const key = `${interaction.guildId || "dm"}:${interaction.user.id}`;
					const timestamps = cooldowns.get(command.data.name) || new Map();
					const now = Date.now();
					const expiration = (timestamps.get(key) ?? -Infinity) + cooldown * 1000;
					if (now < expiration) return await replyError(interaction, `Please wait <t:${Math.ceil(expiration / 1000)}:R> before using this command again.`);
					cooldowns.set(command.data.name, timestamps);
					timestamps.set(key, now);
					const timer = setTimeout(() => { if (timestamps.get(key) === now) timestamps.delete(key); }, cooldown * 1000);
					timer.unref?.();
				}
				const result = await command.execute(interaction, client);
				if (client.hooks) await client.hooks.emitHook("afterCommand", { interaction, command, result });
				return;
			}
			if (typeof interaction.customId !== "string") return;
			if (interaction.isButton()) {
				if (interaction.customId.startsWith("feedback_")) return await handleFeedbackInteraction(interaction, client);
				if (interaction.customId.startsWith("ticket_")) return await handleTicketButtons(interaction, client);
				if (interaction.customId.startsWith("reminder_")) return await handleReminderButtons(interaction, client);
			}
			if (interaction.isStringSelectMenu()) {
				if (interaction.customId === "feedback_select") return await handleFeedbackSelection(interaction, client);
				if (interaction.customId.startsWith("priority_select_")) return await handleTicketPrioritySelection(interaction);
			}
			if (interaction.isModalSubmit()) {
				if (interaction.customId === "feedback_submit") return await handleFeedbackSubmission(interaction, client);
				if (interaction.customId.startsWith("close_ticket_modal_")) return await handleCloseTicketModal(interaction, client);
			}
		} catch (error) {
			console.error(`Error handling interaction ${interaction.commandName || interaction.customId}:`, error);
			await replyError(interaction, "An error occurred while processing your request. Please try again later.");
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

async function authorizedTicket(interaction, ticketId, allowCreator = false) {
	const result = await permissionLookup(interaction, async () => {
		const db = await Database.getInstance();
		return { db, ticket: await db.getTicketById(ticketId) };
	});
	const { ticket } = result;
	if (!ticket || !interaction.guildId || ticket.guildId !== interaction.guildId ||
		interaction.guild?.id !== ticket.guildId || ticket.channelId !== interaction.channelId ||
		interaction.channel?.id !== ticket.channelId ||
		(interaction.channel.guildId && interaction.channel.guildId !== ticket.guildId)) {
		await replyError(interaction, "Ticket not found in this channel.");
		return null;
	}
	if (!interaction.member || (!isModeratorOrOwner(interaction.member, interaction.guild) && !(allowCreator && ticket.userId === interaction.user.id))) {
		await replyError(interaction, allowCreator ? "Only moderators or the ticket creator can close tickets." : "Only moderators can manage tickets.");
		return null;
	}
	if (["closed", "resolved"].includes(ticket.status)) {
		await replyError(interaction, "This ticket is already closed.");
		return null;
	}
	return result;
}

async function handleTicketButtons(interaction) {
	const match = /^ticket_(claim|unclaim|close|priority)_(.+)$/.exec(interaction.customId);
	if (!match) return;
	const [, action, ticketId] = match;
	if (action !== "close") await interaction.deferReply({ flags: 64 });
	const authorized = await authorizedTicket(interaction, ticketId, action === "close");
	if (!authorized) return;
	const { db, ticket } = authorized;

	if (action === "close") {
		const modal = new ModalBuilder().setCustomId(`close_ticket_modal_${ticketId}`).setTitle("Close Ticket");
		const reasonInput = new TextInputBuilder()
			.setCustomId("close_reason").setLabel("Reason for closing (optional)")
			.setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
		modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
		return interaction.showModal(modal);
	}
	if (action === "priority") {
		const priorityRow = new ActionRowBuilder().addComponents(
			new StringSelectMenuBuilder().setCustomId(`priority_select_${ticketId}`)
				.setPlaceholder("Select new priority level")
				.addOptions([
					{ label: "High Priority", value: "high" },
					{ label: "Medium Priority", value: "medium" },
					{ label: "Low Priority", value: "low" },
				]),
		);
		return interaction.editReply({ content: "Select the new priority level:", components: [priorityRow] });
	}

	const claimed = action === "claim";
	const updated = await db.updateTicket(ticketId, { moderatorId: claimed ? interaction.user.id : null, status: claimed ? "in_progress" : "open" });
	if (!updated) return replyError(interaction, "Ticket not found.");
	const embed = interaction.message.embeds?.[0]
		? EmbedBuilder.from(interaction.message.embeds[0])
		: new EmbedBuilder().setTitle(ticket.title || "Support ticket");
	embed.setFields((embed.data.fields || []).filter((field) => field.name !== "👨‍💼 Claimed by"));
	if (claimed) embed.addFields({ name: "👨‍💼 Claimed by", value: `${interaction.user}`, inline: true });
	embed.setColor(claimed ? "#FFA500" : "#5865F2");
	const buttons = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`ticket_${claimed ? "unclaim" : "claim"}_${ticketId}`).setLabel(claimed ? "Unclaim" : "Claim").setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ticket_close_${ticketId}`).setLabel("Close Ticket").setStyle(ButtonStyle.Danger),
		new ButtonBuilder().setCustomId(`ticket_priority_${ticketId}`).setLabel("Change Priority").setStyle(ButtonStyle.Secondary),
	);
	await interaction.message.edit({ embeds: [embed], components: [buttons] });
	await interaction.editReply({ content: claimed ? "You have claimed this ticket." : "This ticket is now unclaimed." });
}

async function handleTicketPrioritySelection(interaction) {
	await interaction.deferReply({ flags: 64 });
	const ticketId = interaction.customId.slice("priority_select_".length);
	const authorized = await authorizedTicket(interaction, ticketId);
	if (!authorized) return;
	const priority = interaction.values?.[0];
	if (interaction.values?.length !== 1 || !["low", "medium", "high"].includes(priority)) return replyError(interaction, "Invalid ticket priority.");
	const updated = await authorized.db.updateTicket(ticketId, { priority });
	if (!updated) return replyError(interaction, "Ticket not found.");
	await interaction.editReply({ content: `Ticket priority changed to ${priority}.`, components: [] });
}

async function handleCloseTicketModal(interaction) {
	const ticketId = interaction.customId.slice("close_ticket_modal_".length);
	const authorized = await authorizedTicket(interaction, ticketId, true);
	if (!authorized) return;
	const { db, ticket } = authorized;
	const closeReason = interaction.fields.getTextInputValue("close_reason") || "No reason provided";
	if (typeof closeReason !== "string" || closeReason.length > 500) return replyError(interaction, "Invalid closing reason.");
	await interaction.deferReply();
	const updated = await db.updateTicket(ticketId, { status: "closed", closedAt: new Date(), closedBy: interaction.user.id, closeReason });
	if (!updated) return replyError(interaction, "Ticket not found.");
	const closeEmbed = new EmbedBuilder()
		.setColor("#FF0000").setTitle("🔒 Ticket Closed").setDescription("This ticket has been closed.")
		.addFields(
			{ name: "👤 Closed by", value: `${interaction.user}`, inline: true },
			{ name: "📅 Closed at", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
			{ name: "📝 Reason", value: closeReason, inline: false },
		)
		.setFooter({ text: "This channel will be deleted in 30 seconds." }).setTimestamp();
	await interaction.editReply({ embeds: [closeEmbed] });
	const channel = interaction.channel;
	const timer = setTimeout(async () => {
		try {
			// A reopened, moved or deleted record must not lose its channel to an
			// old timer. Never use a different interaction channel as a fallback.
			const current = await db.getTicketById(ticketId);
			if (current?.status === "closed" && current.guildId === ticket.guildId &&
				current.channelId === channel.id && channel.deletable &&
				new Date(current.closedAt).getTime() === new Date(updated.closedAt).getTime()) await channel.delete();
		} catch (error) {
			console.error("Error deleting ticket channel:", error);
		}
	}, 30000);
	timer.unref?.();
}
