const { Events, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const Database = require("../utils/database");
const { checkRaidDetection } = require("../commands/antimodules/antiraid");

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member, client) {
    // 🛡️ Check for anti-raid detection first
    try {
      const db = await Database.getInstance();
      const raidDetected = await checkRaidDetection(member.guild, member, db);

      if (raidDetected) {
        console.log(
          `🚨 Raid detected in ${member.guild.name} - ${member.user.tag} was part of rapid joining`
        );
        return; // Don't send welcome message if user was kicked/banned for raiding
      }
    } catch (error) {
      console.error("❌ Error checking anti-raid:", error);
    }

    // 🎂 Check for birthday today
    try {
      const db = await Database.getInstance();
      const today = new Date();
      const birthdayUsers = await db.Birthday.find({
        guildId: member.guild.id,
        isPrivate: false,
      });

      const todaysBirthdays = birthdayUsers.filter((birthday) => {
        const birthDate = new Date(birthday.birthdayDate);
        return (
          birthDate.getMonth() === today.getMonth() &&
          birthDate.getDate() === today.getDate()
        );
      });

      if (todaysBirthdays.length > 0) {
        // Check if birthday announcements are enabled
        const config = await db.ServerConfig.findOne({
          guildId: member.guild.id,
        });
        if (config?.birthdayEnabled && config?.birthdayChannelId) {
          const birthdayChannel = member.guild.channels.cache.get(
            config.birthdayChannelId
          );
          if (birthdayChannel) {
            for (const birthday of todaysBirthdays) {
              const birthdayUser = member.guild.members.cache.get(
                birthday.userId
              );
              if (birthdayUser) {
                const birthdayEmbed = new EmbedBuilder()
                  .setColor("#ffb3ff")
                  .setTitle("🎂 Happy Birthday!")
                  .setDescription(
                    `It's ${birthdayUser.displayName}'s birthday today! 🎉`
                  )
                  .setThumbnail(birthdayUser.user.displayAvatarURL())
                  .setTimestamp();

                await birthdayChannel.send({ embeds: [birthdayEmbed] });

                // Give birthday role if configured
                if (config.birthdayRoleId) {
                  const birthdayRole = member.guild.roles.cache.get(
                    config.birthdayRoleId
                  );
                  if (birthdayRole && birthdayUser.manageable) {
                    try {
                      await birthdayUser.roles.add(
                        birthdayRole,
                        "Birthday celebration"
                      );
                    } catch (error) {
                      console.error("❌ Failed to give birthday role:", error);
                    }
                  }
                }

                // Update celebration count
                await db.Birthday.findOneAndUpdate(
                  { userId: birthday.userId, guildId: member.guild.id },
                  {
                    lastCelebrated: new Date(),
                    $inc: { celebrationCount: 1 },
                  }
                );
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Error checking birthdays:", error);
    }
    // 🎉 Create a beautiful welcome message
    const welcomeEmbed = new EmbedBuilder()
      .setColor(client.colors.success)
      .setTitle(`🎉 Welcome to ${member.guild.name}!`)
      .setDescription(
        `Hey ${member}, we're excited to have you here! 🚀\n\n• Check out the rules and get started\n• Introduce yourself to the community\n• Feel free to ask questions anytime!`
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .addFields(
        {
          name: "👤 Member Count",
          value: `You're member #${member.guild.memberCount}!`,
          inline: true,
        },
        {
          name: "📅 Account Created",
          value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
          inline: true,
        }
      )
      .setFooter({
        text: `User ID: ${member.id}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    // 🔍 Try to find a welcome channel
    const welcomeChannels = ["welcome", "general", "chat", "lobby"];
    let welcomeChannel = null;

    for (const channelName of welcomeChannels) {
      welcomeChannel = member.guild.channels.cache.find(
        (channel) =>
          channel.name.toLowerCase().includes(channelName) &&
          channel.type === 0 && // Text channel
          channel
            .permissionsFor(client.user)
            .has(["SendMessages", "EmbedLinks"])
      );
      if (welcomeChannel) break;
    }

    // 📤 Send welcome message if channel found
    if (welcomeChannel) {
      try {
        await welcomeChannel.send({ embeds: [welcomeEmbed] });
        console.log(
          `🎉 Sent welcome message for ${member.user.tag} in ${member.guild.name}`
        );
      } catch (error) {
        console.error("❌ Failed to send welcome message:", error);
      }
    }

    // 📊 Log member join
    console.log(
      `👋 ${member.user.tag} joined ${member.guild.name} (${member.guild.memberCount} members)`
    );
  },
};
