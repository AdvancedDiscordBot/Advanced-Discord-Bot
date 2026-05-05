const {
	SlashCommandBuilder,
	EmbedBuilder,
	PermissionFlagsBits,
} = require("discord.js");
const { isModeratorOrOwner } = require("../../utils/moderation");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("purge")
		.setDescription("🗑️ Bulk delete messages from the current channel")
		.addIntegerOption((option) =>
			option
				.setName("amount")
				.setDescription("Number of messages to delete (1-100)")
				.setRequired(true)
				.setMinValue(1)
				.setMaxValue(100),
		)
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("Only delete messages from this user")
				.setRequired(false),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
	cooldown: 5,
	async execute(interaction, client) {
		// 🛡️ Enhanced moderator check
		if (!isModeratorOrOwner(interaction.member, interaction.guild)) {
			const noModPermEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("🚫 Moderator Access Required")
				.setDescription(
					"This command is restricted to server moderators and administrators only.",
				)
				.addFields({
					name: "🔐 Required Permissions",
					value:
						"You need one of the following:\n• Administrator permission\n• Moderate Members permission\n• Manage Messages permission\n• A moderator role",
					inline: false,
				})
				.setFooter({
					text: "Contact a server administrator if you believe this is an error.",
				});

			return interaction.reply({ embeds: [noModPermEmbed], ephemeral: true });
		}

		const amount = interaction.options.getInteger("amount");
		const targetUser = interaction.options.getUser("user");

		// 🛡️ Permission checks
		if (
			!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)
		) {
			const noPermEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("❌ Permission Denied")
				.setDescription(
					"You need the `Manage Messages` permission to use this command.",
				)
				.setFooter({
					text: "Contact an administrator if you believe this is an error.",
				});

			return interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
		}

		if (
			!interaction.guild.members.me.permissions.has(
				PermissionFlagsBits.ManageMessages,
			)
		) {
			const botNoPermEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("❌ Bot Permission Missing")
				.setDescription(
					"I need the `Manage Messages` permission to execute this command.",
				)
				.setFooter({
					text: "Please contact an administrator to grant the required permissions.",
				});

			return interaction.reply({ embeds: [botNoPermEmbed], ephemeral: true });
		}

		// ⏳ Defer reply for processing time
		await interaction.deferReply({ ephemeral: true });

		try {
			// 📥 Fetch messages
			let messages;

			if (targetUser) {
				// 🎯 Fetch more messages to filter by user
				const fetchedMessages = await interaction.channel.messages.fetch({
					limit: 100,
				});
				messages = fetchedMessages
					.filter((msg) => msg.author.id === targetUser.id)
					.first(amount);
			} else {
				// 📋 Fetch specified amount
				messages = await interaction.channel.messages.fetch({ limit: amount });
			}

			if (messages.size === 0) {
				const noMessagesEmbed = new EmbedBuilder()
					.setColor(client.colors.warning)
					.setTitle("⚠️ No Messages Found")
					.setDescription(
						targetUser
							? `No recent messages from ${targetUser.tag} found.`
							: "No messages found to delete.",
					)
					.setFooter({
						text: "Try a different user or check if there are messages in this channel.",
					});

				return interaction.editReply({ embeds: [noMessagesEmbed] });
			}

			// ⏰ Filter out messages older than 14 days (Discord limitation)
			const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
			const deletableMessages = messages.filter(
				(msg) => msg.createdTimestamp > twoWeeksAgo,
			);
			const oldMessages = messages.size - deletableMessages.size;

			if (deletableMessages.size === 0) {
				const tooOldEmbed = new EmbedBuilder()
					.setColor(client.colors.warning)
					.setTitle("⚠️ Messages Too Old")
					.setDescription(
						"All found messages are older than 14 days and cannot be bulk deleted.",
					)
					.addFields({
						name: "📅 Discord Limitation",
						value: "Messages older than 14 days must be deleted individually.",
						inline: false,
					})
					.setFooter({
						text: "This is a Discord API limitation, not a bot issue.",
					});

				return interaction.editReply({ embeds: [tooOldEmbed] });
			}

			// 🗑️ Perform bulk delete
			const deletedMessages = await interaction.channel.bulkDelete(
				deletableMessages,
				true,
			);

			// 📊 Success confirmation
			const successEmbed = new EmbedBuilder()
				.setColor(client.colors.success)
				.setTitle("🗑️ Messages Deleted Successfully")
				.setDescription(
					`Successfully deleted **${deletedMessages.size}** message${
						deletedMessages.size === 1 ? "" : "s"
					}.`,
				)
				.addFields(
					{
						name: "📊 Details",
						value: targetUser
							? `🎯 **Target:** ${targetUser.tag}\n📝 **Deleted:** ${deletedMessages.size} messages\n🔍 **Searched:** 100 messages`
							: `📝 **Deleted:** ${deletedMessages.size} messages\n📋 **Requested:** ${amount} messages`,
						inline: false,
					},
					{
						name: "👮 Moderator",
						value: `${interaction.user.tag}`,
						inline: true,
					},
					{
						name: "📍 Channel",
						value: `${interaction.channel}`,
						inline: true,
					},
				);

			// ⚠️ Add warning about old messages if any
			if (oldMessages > 0) {
				successEmbed.addFields({
					name: "⚠️ Notice",
					value: `${oldMessages} message${
						oldMessages === 1 ? " was" : "s were"
					} older than 14 days and could not be deleted.`,
					inline: false,
				});
			}

			successEmbed
				.setFooter({
					text: `Action performed by ${interaction.user.tag}`,
					iconURL: interaction.user.displayAvatarURL(),
				})
				.setTimestamp();

			await interaction.editReply({ embeds: [successEmbed] });

			// 📊 Log the action
			console.log(
				`🗑️ ${deletedMessages.size} messages deleted from ${
					interaction.channel.name
				} in ${interaction.guild.name} by ${interaction.user.tag}${
					targetUser ? ` (target: ${targetUser.tag})` : ""
				}`,
			);

			// 🎉 Auto-delete confirmation after 10 seconds
			setTimeout(async () => {
				try {
					await interaction.deleteReply();
				} catch (error) {
					// Ignore errors when deleting (message might already be gone)
				}
			}, 10000);
		} catch (error) {
			console.error("❌ Error during purge:", error);

			const errorEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("❌ Purge Failed")
				.setDescription("An error occurred while trying to delete messages.")
				.addFields({
					name: "🔧 Possible Issues",
					value:
						"• Missing permissions\n• Messages too old (>14 days)\n• Channel restrictions\n• Bot malfunction",
					inline: false,
				})
				.setFooter({ text: "Please try again or contact an administrator." });

			await interaction.editReply({ embeds: [errorEmbed] });
		}
	},
};
