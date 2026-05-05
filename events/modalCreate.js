const { Events, EmbedBuilder } = require("discord.js");
const Database = require("../utils/database");

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction, client) {
		// 📝 Handle modal submissions
		if (interaction.isModalSubmit()) {
			if (interaction.customId === "ai_context_modal") {
				await handleAIContextModal(interaction, client);
			}
		}

		// 🎮 Handle button interactions for tickets
		if (interaction.isButton()) {
			if (interaction.customId.startsWith("ticket_")) {
				await handleTicketButtons(interaction, client);
			}
		}
	},
};

// 🤖 Handle AI context modal submission
async function handleAIContextModal(interaction, client) {
	const context = interaction.fields.getTextInputValue("ai_context_input");
	const db = await Database.getInstance();

	try {
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

		await interaction.reply({ embeds: [successEmbed], ephemeral: true });

		console.log(
			`🤖 AI context updated for ${interaction.guild.name} by ${interaction.user.tag}`,
		);
	} catch (error) {
		console.error("❌ AI context update error:", error);

		const errorEmbed = new EmbedBuilder()
			.setColor(client.colors.error)
			.setTitle("❌ Update Failed")
			.setDescription("Failed to update AI context. Please try again.")
			.setFooter({ text: "Contact support if this issue persists." });

		await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
	}
}

// 🎫 Handle ticket button interactions
async function handleTicketButtons(interaction, client) {
	const [action, type, ticketId] = interaction.customId.split("_");
	const db = await Database.getInstance();

	try {
		switch (type) {
			case "claim":
				await handleTicketClaim(interaction, client, db, ticketId);
				break;
			case "close":
				await handleTicketClose(interaction, client, db, ticketId);
				break;
			case "priority":
				await handleTicketPriority(interaction, client, db, ticketId);
				break;
		}
	} catch (error) {
		console.error("❌ Ticket button error:", error);

		const errorEmbed = new EmbedBuilder()
			.setColor(client.colors.error)
			.setTitle("❌ Action Failed")
			.setDescription("Failed to perform the requested action.")
			.setFooter({ text: "Please try again or contact an administrator." });

		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
		} else {
			await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
		}
	}
}

// 🙋 Handle ticket claim
async function handleTicketClaim(interaction, client, db, ticketId) {
	const { isModeratorOrOwner } = require("../utils/moderation");

	if (!isModeratorOrOwner(interaction.member, interaction.guild)) {
		const noPermEmbed = new EmbedBuilder()
			.setColor(client.colors.error)
			.setTitle("🚫 Permission Denied")
			.setDescription("Only moderators can claim tickets.")
			.setFooter({ text: "Contact a server administrator." });

		return interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
	}

	await db.updateTicketStatus(ticketId, "in_progress", interaction.user.id);

	const claimEmbed = new EmbedBuilder()
		.setColor(client.colors.success)
		.setTitle("🙋 Ticket Claimed")
		.setDescription(
			`${interaction.user} has claimed this ticket and will assist you.`,
		)
		.setTimestamp();

	await interaction.reply({ embeds: [claimEmbed] });

	console.log(
		`🎫 Ticket #${ticketId} claimed by ${interaction.user.tag} in ${interaction.guild.name}`,
	);
}

// 🔒 Handle ticket close
async function handleTicketClose(interaction, client, db, ticketId) {
	const { isModeratorOrOwner } = require("../utils/moderation");

	if (!isModeratorOrOwner(interaction.member, interaction.guild)) {
		const noPermEmbed = new EmbedBuilder()
			.setColor(client.colors.error)
			.setTitle("🚫 Permission Denied")
			.setDescription("Only moderators can close tickets.")
			.setFooter({ text: "Contact a server administrator." });

		return interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
	}

	await db.updateTicketStatus(ticketId, "closed", interaction.user.id);

	const closeEmbed = new EmbedBuilder()
		.setColor(client.colors.error)
		.setTitle("🔒 Ticket Closed")
		.setDescription(
			`This ticket has been closed by ${interaction.user}.\n\nThe channel will be deleted in 30 seconds.`,
		)
		.setFooter({ text: "Thank you for using our support system!" })
		.setTimestamp();

	await interaction.reply({ embeds: [closeEmbed] });

	// 🗑️ Delete channel after 30 seconds
	setTimeout(async () => {
		try {
			await interaction.channel.delete("Ticket closed");
		} catch (error) {
			console.error("❌ Error deleting ticket channel:", error);
		}
	}, 30000);

	console.log(
		`🎫 Ticket #${ticketId} closed by ${interaction.user.tag} in ${interaction.guild.name}`,
	);
}

// 📊 Handle ticket priority change
async function handleTicketPriority(interaction, client, db, ticketId) {
	const { isModeratorOrOwner } = require("../utils/moderation");

	if (!isModeratorOrOwner(interaction.member, interaction.guild)) {
		const noPermEmbed = new EmbedBuilder()
			.setColor(client.colors.error)
			.setTitle("🚫 Permission Denied")
			.setDescription("Only moderators can change ticket priority.")
			.setFooter({ text: "Contact a server administrator." });

		return interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
	}

	const priorityEmbed = new EmbedBuilder()
		.setColor(client.colors.primary)
		.setTitle("📊 Priority Change")
		.setDescription(
			"Priority change functionality will be implemented in the next update!",
		)
		.setFooter({ text: "Coming soon!" });

	await interaction.reply({ embeds: [priorityEmbed], ephemeral: true });
}
