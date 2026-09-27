const { Events } = require("discord.js");

module.exports = {
	name: Events.GuildMemberAdd,
	async execute(member, client) {
		if (member.user.bot || client.shuttingDown) return;
		// Welcomes belong to the configured welcome plugin. Only explicitly
		// configured legacy birthdays remain here, scoped to the joining member.
		await client.scheduler?.checkBirthdays(member);
	},
};
