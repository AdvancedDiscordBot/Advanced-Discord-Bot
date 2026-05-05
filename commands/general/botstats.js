const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const {
	formatUptime,
	formatBytes,
	generateProgressBar,
} = require("../../utils/helpers");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("botstats")
		.setDescription("📊 View detailed bot performance statistics and metrics"),
	cooldown: 5,
	async execute(interaction, client) {
		// 📊 Memory usage
		const memUsage = process.memoryUsage();
		const totalMem = require("os").totalmem();
		const usedMem = memUsage.heapUsed;

		// 🕒 Uptime calculation
		const uptime = process.uptime() * 1000;

		// 📈 Performance metrics
		const guilds = client.guilds.cache.size;
		const users = client.users.cache.size;
		const channels = client.channels.cache.size;
		const commands = client.commands.size;

		// 🎯 CPU usage approximation
		const cpuUsage = process.cpuUsage();
		const cpuPercent =
			Math.round(((cpuUsage.user + cpuUsage.system) / 1000000) * 100) / 100;

		const statsEmbed = new EmbedBuilder()
			.setColor(client.colors.success)
			.setTitle("📊 NovaBot Performance Dashboard")
			.setDescription("Real-time bot statistics and performance metrics")
			.setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
			.addFields(
				{
					name: "⏱️ Uptime",
					value: `\`${formatUptime(uptime)}\``,
					inline: true,
				},
				{
					name: "🏓 Latency",
					value: `\`${client.ws.ping}ms\``,
					inline: true,
				},
				{
					name: "🎯 Commands",
					value: `\`${commands}\``,
					inline: true,
				},
				{
					name: "🏰 Servers",
					value: `\`${guilds.toLocaleString()}\``,
					inline: true,
				},
				{
					name: "👥 Users",
					value: `\`${users.toLocaleString()}\``,
					inline: true,
				},
				{
					name: "📢 Channels",
					value: `\`${channels.toLocaleString()}\``,
					inline: true,
				},
				{
					name: "💾 Memory Usage",
					value: `\`${formatBytes(usedMem)}\` / \`${formatBytes(
						totalMem,
					)}\`\n${generateProgressBar(usedMem, totalMem)} ${Math.round(
						(usedMem / totalMem) * 100,
					)}%`,
					inline: false,
				},
				{
					name: "🖥️ System Info",
					value: `**Platform:** ${process.platform}\n**Node.js:** ${
						process.version
					}\n**Discord.js:** v${require("discord.js").version}`,
					inline: true,
				},
				{
					name: "⚡ Performance",
					value: `**CPU Usage:** ~${cpuPercent}%\n**Heap Used:** ${formatBytes(
						memUsage.heapUsed,
					)}\n**Heap Total:** ${formatBytes(memUsage.heapTotal)}`,
					inline: true,
				},
			)
			.setFooter({
				text: `Requested by ${interaction.user.tag} • Bot ID: ${client.user.id}`,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTimestamp();

		await interaction.reply({
			embeds: [statsEmbed],
			flags: 64, // MessageFlags.Ephemeral
		});
	},
};
