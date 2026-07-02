const { Events } = require("discord.js");

module.exports = {
  name: Events.GuildCreate,
  execute(guild, client) {
    console.log(`📥 Bot has joined a new guild: ${guild.name} (${guild.id})`);
    console.log(`📊 Current server count: ${client.guilds.cache.size}`);
  },
};
