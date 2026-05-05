const {
	SlashCommandBuilder,
	EmbedBuilder,
	PermissionFlagsBits,
} = require("discord.js");
const { isModeratorOrOwner } = require("../../utils/moderation");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("kick")
		.setDescription("👢 Kick a user from the server with optional reason")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user to kick")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("reason")
				.setDescription("Reason for the kick")
				.setRequired(false),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
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
						"You need one of the following:\n• Administrator permission\n• Moderate Members permission\n• Kick Members permission\n• A moderator role",
					inline: false,
				})
				.setFooter({
					text: "Contact a server administrator if you believe this is an error.",
				});

			return interaction.reply({ embeds: [noModPermEmbed], ephemeral: true });
		}

		const targetUser = interaction.options.getUser("user");
		const reason =
			interaction.options.getString("reason") || "No reason provided";
		const targetMember = interaction.guild.members.cache.get(targetUser.id);

		// 🛡️ Permission checks
		if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
			const noPermEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("❌ Permission Denied")
				.setDescription(
					"You need the `Kick Members` permission to use this command.",
				)
				.setFooter({
					text: "Contact an administrator if you believe this is an error.",
				});

			return interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
		}

		if (
			!interaction.guild.members.me.permissions.has(
				PermissionFlagsBits.KickMembers,
			)
		) {
			const botNoPermEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("❌ Bot Permission Missing")
				.setDescription(
					"I need the `Kick Members` permission to execute this command.",
				)
				.setFooter({
					text: "Please contact an administrator to grant the required permissions.",
				});

			return interaction.reply({ embeds: [botNoPermEmbed], ephemeral: true });
		}

		// 🎯 Target validation
		if (!targetMember) {
			const notFoundEmbed = new EmbedBuilder()
				.setColor(client.colors.warning)
				.setTitle("⚠️ User Not Found")
				.setDescription("This user is not a member of this server.")
				.setFooter({ text: "They might have already left the server." });

			return interaction.reply({ embeds: [notFoundEmbed], ephemeral: true });
		}

		// 🚫 Self-kick protection
		if (targetUser.id === interaction.user.id) {
			const selfKickEmbed = new EmbedBuilder()
				.setColor(client.colors.warning)
				.setTitle("🤔 Hold Up!")
				.setDescription(
					"You can't kick yourself! If you want to leave, use the leave server option.",
				)
				.setFooter({ text: "Nice try though! 😄" });

			return interaction.reply({ embeds: [selfKickEmbed], ephemeral: true });
		}

		// 🤖 Bot protection
		if (targetUser.id === client.user.id) {
			const botKickEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("😢 You Want to Kick Me?")
				.setDescription(
					"I can't kick myself! If you really want me gone, you'll have to do it manually.",
				)
				.setFooter({ text: "But I thought we were friends... 💔" });

			return interaction.reply({ embeds: [botKickEmbed], ephemeral: true });
		}

		// 🏆 Role hierarchy check
		const executorHighestRole = interaction.member.roles.highest;
		const targetHighestRole = targetMember.roles.highest;
		const botHighestRole = interaction.guild.members.me.roles.highest;

		if (targetHighestRole.position >= executorHighestRole.position) {
			const hierarchyEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("⚡ Role Hierarchy Error")
				.setDescription(
					"You cannot kick someone with a role equal to or higher than yours.",
				)
				.addFields({
					name: "🏆 Role Comparison",
					value: `Your highest role: **${executorHighestRole.name}** (Position: ${executorHighestRole.position})\nTarget's highest role: **${targetHighestRole.name}** (Position: ${targetHighestRole.position})`,
					inline: false,
				})
				.setFooter({ text: "Role hierarchy prevents this action." });

			return interaction.reply({ embeds: [hierarchyEmbed], ephemeral: true });
		}

		if (targetHighestRole.position >= botHighestRole.position) {
			const botHierarchyEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("⚡ Bot Role Hierarchy Error")
				.setDescription(
					"I cannot kick someone with a role equal to or higher than my highest role.",
				)
				.addFields({
					name: "🤖 Role Comparison",
					value: `My highest role: **${botHighestRole.name}** (Position: ${botHighestRole.position})\nTarget's highest role: **${targetHighestRole.name}** (Position: ${targetHighestRole.position})`,
					inline: false,
				})
				.setFooter({
					text: "Please move my role higher or lower the target's role.",
				});

			return interaction.reply({
				embeds: [botHierarchyEmbed],
				ephemeral: true,
			});
		}

		// 👢 Execute the kick
		try {
			// 📬 Try to DM the user before kicking
			try {
				const dmEmbed = new EmbedBuilder()
					.setColor(client.colors.warning)
					.setTitle(`👢 You've been kicked from ${interaction.guild.name}`)
					.setDescription(
						`You have been removed from **${interaction.guild.name}**.`,
					)
					.addFields(
						{ name: "📝 Reason", value: reason, inline: false },
						{ name: "👤 Kicked by", value: interaction.user.tag, inline: true },
						{
							name: "📅 Date",
							value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
							inline: true,
						},
					)
					.setFooter({ text: "You can rejoin if you have an invite link." })
					.setTimestamp();

				await targetUser.send({ embeds: [dmEmbed] });
			} catch (dmError) {
				console.log(`📬 Could not DM ${targetUser.tag} about their kick.`);
			}

			// 👢 Perform the kick
			await targetMember.kick(reason);

			// ✅ Success confirmation
			const successEmbed = new EmbedBuilder()
				.setColor(client.colors.success)
				.setTitle("✅ User Kicked Successfully")
				.setDescription(
					`**${targetUser.tag}** has been kicked from the server.`,
				)
				.addFields(
					{
						name: "👤 Kicked User",
						value: `${targetUser.tag} (${targetUser.id})`,
						inline: true,
					},
					{
						name: "👮 Moderator",
						value: `${interaction.user.tag}`,
						inline: true,
					},
					{ name: "📝 Reason", value: reason, inline: false },
				)
				.setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
				.setFooter({
					text: `Action performed by ${interaction.user.tag}`,
					iconURL: interaction.user.displayAvatarURL(),
				})
				.setTimestamp();

			await interaction.reply({ embeds: [successEmbed] });

			// 📊 Log the action
			console.log(
				`👢 ${targetUser.tag} was kicked from ${interaction.guild.name} by ${interaction.user.tag}. Reason: ${reason}`,
			);
		} catch (error) {
			console.error("❌ Error kicking user:", error);

			const errorEmbed = new EmbedBuilder()
				.setColor(client.colors.error)
				.setTitle("❌ Kick Failed")
				.setDescription("An error occurred while trying to kick the user.")
				.addFields({
					name: "🔧 Possible Issues",
					value:
						"• Missing permissions\n• Role hierarchy conflicts\n• User already left\n• Bot malfunction",
					inline: false,
				})
				.setFooter({ text: "Please try again or contact an administrator." });

			await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
		}
	},
};
