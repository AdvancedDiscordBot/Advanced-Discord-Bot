const cron = require("node-cron");
const Database = require("./database");

class TaskScheduler {
  constructor(client) {
    this.client = client;
    this.setupTasks();
  }

  setupTasks() {
    // Daily reset at midnight UTC
    cron.schedule("0 0 * * *", async () => {
      console.log("🕛 Running daily reset task...");
      await this.runDailyReset();
    });

    // Weekly reset on Monday at midnight UTC
    cron.schedule("0 0 * * 1", async () => {
      console.log("🗓️ Running weekly reset task...");
      await this.runWeeklyReset();
    });

    // Update leaderboards every hour
    cron.schedule("0 * * * *", async () => {
      console.log("🏆 Updating leaderboards...");
      await this.updateLeaderboards();
    });

    // Role check every 30 minutes
    cron.schedule("*/30 * * * *", async () => {
      console.log("🎭 Running role checks...");
      await this.checkAllRoleRewards();
    });

    // Birthday check daily at 8 AM UTC
    cron.schedule("0 8 * * *", async () => {
      console.log("🎂 Checking birthdays...");
      await this.checkBirthdays();
    });

    // Trial reset every 5 hours (only when TRIAL_MODE is enabled)
    if (process.env.TRIAL_MODE === "true") {
      cron.schedule("0 */5 * * *", async () => {
        console.log("🔄 Running trial reset task (every 5 hours)...");
        await this.runTrialReset();
      });
      console.log("⚖️ Trial mode scheduler active: will reset every 5 hours");
    }

    console.log("⏰ Task scheduler initialized");
  }

  async runDailyReset() {
    try {
      const db = await Database.getInstance();
      for (const guild of this.client.guilds.cache.values()) {
        await db.resetDailyStats(guild.id);
        console.log(`📅 Reset daily stats for ${guild.name}`);
      }
    } catch (error) {
      console.error("Error in daily reset:", error);
    }
  }

  async runWeeklyReset() {
    try {
      const db = await Database.getInstance();
      for (const guild of this.client.guilds.cache.values()) {
        await db.resetWeeklyStats(guild.id);
        console.log(`🗓️ Reset weekly stats for ${guild.name}`);
      }
    } catch (error) {
      console.error("Error in weekly reset:", error);
    }
  }

  async updateLeaderboards() {
    try {
      const db = await Database.getInstance();
      for (const guild of this.client.guilds.cache.values()) {
        const topUsers = await db.getTopUsers(guild.id, 50);

        // Update cached leaderboard
        await db.updateServerConfig(guild.id, {
          lastLeaderboardUpdate: new Date(),
        });

        console.log(
          `🏆 Updated leaderboard for ${guild.name} (${topUsers.length} users)`
        );
      }
    } catch (error) {
      console.error("Error updating leaderboards:", error);
    }
  }

  async checkAllRoleRewards() {
    try {
      const db = await Database.getInstance();
      for (const guild of this.client.guilds.cache.values()) {
        const config = await db.getServerConfig(guild.id);

        if (
          !config.roleAutomation ||
          !config.roleRewards ||
          config.roleRewards.length === 0
        ) {
          continue;
        }

        // Get all users who might be eligible for new roles
        const topUsers = await db.getTopUsers(guild.id, 100);

        for (const userData of topUsers) {
          try {
            const member = await guild.members
              .fetch(userData.userId)
              .catch(() => null);
            if (!member) continue;

            await this.checkAndAssignRoles(member, guild.id);
          } catch (error) {
            console.error(
              `Error checking roles for user ${userData.userId}:`,
              error
            );
          }
        }

        console.log(`🎭 Checked role rewards for ${guild.name}`);
      }
    } catch (error) {
      console.error("Error in role check task:", error);
    }
  }

  async checkAndAssignRoles(member, guildId) {
    try {
      const db = await Database.getInstance();
      const roleCheck = await db.checkRoleRewards(member.id, guildId);
      const currentRoleIds = member.roles.cache.map((role) => role.id);

      // Check if bot has permission to manage roles
      if (!member.guild.members.me.permissions.has("ManageRoles")) {
        console.log(
          `⚠️ Bot lacks ManageRoles permission in ${member.guild.name}`
        );
        return;
      }

      // Get eligible role IDs
      const eligibleRoleIds = roleCheck.eligibleRoles.map((r) => r.roleId);

      // Roles to add
      const rolesToAdd = eligibleRoleIds.filter(
        (roleId) =>
          !currentRoleIds.includes(roleId) &&
          member.guild.roles.cache.has(roleId)
      );

      // Roles to remove (if user no longer qualifies)
      const currentRewardRoleIds = (roleCheck.currentRoles || []).map(
        (r) => r.roleId
      );
      const rolesToRemove = currentRewardRoleIds.filter(
        (roleId) =>
          !eligibleRoleIds.includes(roleId) && currentRoleIds.includes(roleId)
      );

      // Add new roles
      for (const roleId of rolesToAdd) {
        try {
          const role = member.guild.roles.cache.get(roleId);
          if (!role) {
            console.log(`⚠️ Role ${roleId} not found in ${member.guild.name}`);
            continue;
          }

          // Check if bot's role is higher than the role to manage
          if (role.position >= member.guild.members.me.roles.highest.position) {
            console.log(
              `⚠️ Cannot manage role ${role.name} - Bot's highest role must be above reward role`
            );
            continue;
          }

          // Check if role is manageable
          if (!role.editable) {
            console.log(`⚠️ Role ${role.name} is not editable by the bot`);
            continue;
          }

          await member.roles.add(role, "XP Reward - Automatic role assignment");
          console.log(
            `✅ Auto-added role ${role.name} to ${member.user.username}`
          );
        } catch (error) {
          console.error(`❌ Error adding role ${roleId}:`, error.message);
        }
      }

      // Remove old roles (for top rank rewards)
      for (const roleId of rolesToRemove) {
        try {
          const role = member.guild.roles.cache.get(roleId);
          if (!role) continue;

          // Check if bot can manage this role
          if (role.position >= member.guild.members.me.roles.highest.position) {
            console.log(
              `⚠️ Cannot manage role ${role.name} - Bot's highest role must be above reward role`
            );
            continue;
          }

          if (!role.editable) {
            console.log(`⚠️ Role ${role.name} is not editable by the bot`);
            continue;
          }

          await member.roles.remove(role, "XP Reward - Automatic role removal");
          console.log(
            `➖ Auto-removed role ${role.name} from ${member.user.username}`
          );
        } catch (error) {
          console.error(`❌ Error removing role ${roleId}:`, error.message);
        }
      }

      // Update database with current roles
      if (rolesToAdd.length > 0 || rolesToRemove.length > 0) {
        const newRoles = roleCheck.eligibleRoles.filter((r) =>
          eligibleRoleIds.includes(r.roleId)
        );
        await db.updateUserRoles(member.id, guildId, newRoles);
      }
    } catch (error) {
      console.error("Error checking/assigning roles:", error);
    }
  }

  async checkBirthdays() {
    try {
      const db = await Database.getInstance();
      const today = new Date();

      for (const guild of this.client.guilds.cache.values()) {
        try {
          // Get server config for birthday settings
          const config = await db.getServerConfig(guild.id);

          if (!config.birthdayEnabled || !config.birthdayChannelId) {
            continue; // Skip if birthdays not enabled or no channel set
          }

          const birthdayChannel = guild.channels.cache.get(
            config.birthdayChannelId
          );
          if (!birthdayChannel) {
            continue; // Skip if channel doesn't exist
          }

          // Find today's birthdays
          const birthdays = await db.Birthday.find({
            guildId: guild.id,
            isPrivate: false,
          });

          const todaysBirthdays = birthdays.filter((birthday) => {
            const birthDate = new Date(birthday.birthdayDate);
            const lastCelebrated = birthday.lastCelebrated
              ? new Date(birthday.lastCelebrated)
              : null;

            // Check if it's their birthday today and hasn't been celebrated today
            const isBirthdayToday =
              birthDate.getMonth() === today.getMonth() &&
              birthDate.getDate() === today.getDate();

            const notCelebratedToday =
              !lastCelebrated ||
              lastCelebrated.toDateString() !== today.toDateString();

            return isBirthdayToday && notCelebratedToday;
          });

          for (const birthday of todaysBirthdays) {
            try {
              const member = await guild.members
                .fetch(birthday.userId)
                .catch(() => null);
              if (!member) continue;

              // Calculate age if birth year is available
              let ageText = "";
              const birthYear = birthday.birthdayDate.getFullYear();
              if (birthYear > 1900) {
                // If a real year was provided
                const age = today.getFullYear() - birthYear;
                ageText = ` (turning ${age})`;
              }

              const birthdayEmbed = new (require("discord.js").EmbedBuilder)()
                .setColor("#ffb3ff")
                .setTitle("🎂 Happy Birthday!")
                .setDescription(
                  `🎉 It's ${member.displayName}'s birthday today${ageText}! 🎉\n\n` +
                    `Let's all wish them a wonderful day! 🎈🎊`
                )
                .setThumbnail(member.user.displayAvatarURL())
                .addFields({
                  name: "🎁 Birthday Wishes",
                  value: "React with 🎂 to wish them a happy birthday!",
                  inline: false,
                })
                .setFooter({
                  text: `Celebration #${birthday.celebrationCount + 1}`,
                })
                .setTimestamp();

              const message = await birthdayChannel.send({
                content: `🎂 <@${member.id}>`,
                embeds: [birthdayEmbed],
              });

              // Add birthday cake reaction
              await message.react("🎂").catch(() => {});

              // Give birthday role if configured
              if (config.birthdayRoleId) {
                const birthdayRole = guild.roles.cache.get(
                  config.birthdayRoleId
                );
                if (
                  birthdayRole &&
                  member.manageable &&
                  birthdayRole.editable
                ) {
                  try {
                    await member.roles.add(
                      birthdayRole,
                      "Birthday celebration"
                    );
                    console.log(
                      `🎂 Gave birthday role to ${member.user.username}`
                    );

                    // Schedule role removal after 24 hours
                    setTimeout(async () => {
                      try {
                        if (member.roles.cache.has(birthdayRole.id)) {
                          await member.roles.remove(
                            birthdayRole,
                            "Birthday celebration ended"
                          );
                          console.log(
                            `🎂 Removed birthday role from ${member.user.username}`
                          );
                        }
                      } catch (error) {
                        console.error("Error removing birthday role:", error);
                      }
                    }, 24 * 60 * 60 * 1000); // 24 hours
                  } catch (error) {
                    console.error("Error giving birthday role:", error);
                  }
                }
              }

              // Update birthday record
              await db.Birthday.findOneAndUpdate(
                { userId: birthday.userId, guildId: guild.id },
                {
                  lastCelebrated: today,
                  $inc: { celebrationCount: 1 },
                }
              );

              console.log(
                `🎂 Celebrated birthday for ${member.user.username} in ${guild.name}`
              );
            } catch (error) {
              console.error(
                `Error celebrating birthday for user ${birthday.userId}:`,
                error
              );
            }
          }

          if (todaysBirthdays.length > 0) {
            console.log(
              `🎂 Processed ${todaysBirthdays.length} birthdays in ${guild.name}`
            );
          }
        } catch (error) {
          console.error(
            `Error checking birthdays for guild ${guild.name}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error("Error in birthday check task:", error);
    }
  }

  // Manual trigger methods for testing
  async triggerDailyReset() {
    await this.runDailyReset();
  }

  async triggerWeeklyReset() {
    await this.runWeeklyReset();
  }

  async triggerLeaderboardUpdate() {
    await this.updateLeaderboards();
  }

  async triggerRoleCheck() {
    await this.checkAllRoleRewards();
  }

  async runTrialReset() {
    try {
      console.log("🔄 Starting trial reset...");

      // 1. Leave all guilds
      console.log(`Leaving all guilds... current count: ${this.client.guilds.cache.size}`);
      for (const [id, guild] of this.client.guilds.cache) {
        try {
          await guild.leave();
          console.log(`Successfully left guild: ${guild.name} (${id})`);
        } catch (err) {
          console.error(`Failed to leave guild ${guild.name} (${id}):`, err);
        }
      }

      // 2. Drop the MongoDB database
      const mongoose = require("mongoose");
      if (mongoose.connection && mongoose.connection.db) {
        console.log("Dropping MongoDB database...");
        await mongoose.connection.db.dropDatabase();
        console.log("MongoDB database dropped successfully.");
      } else {
        console.warn("Mongoose connection DB is not active. Database drop skipped.");
      }

      // 3. Pull new commits
      const { execSync } = require("child_process");
      try {
        console.log("Checking git remote URL...");
        let remoteUrl = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
        if (remoteUrl.startsWith("git@github.com:")) {
          const httpsUrl = remoteUrl.replace("git@github.com:", "https://github.com/").replace(/\.git$/, "");
          console.log(`Converting remote URL from SSH to HTTPS: ${httpsUrl}`);
          execSync(`git remote set-url origin ${httpsUrl}`, { stdio: "inherit" });
        }
        console.log("Executing git pull...");
        execSync("git pull", { stdio: "inherit" });
        console.log("Git pull complete.");
      } catch (gitErr) {
        console.error("Error executing git pull:", gitErr);
      }

      // 4. Install dependencies and rebuild plugins
      try {
        console.log("Running npm install...");
        execSync("npm install", { stdio: "inherit" });
        console.log("Running npm run deploy (rebuild plugins)...");
        execSync("npm run deploy", { stdio: "inherit" });
        console.log("Rebuild complete.");
      } catch (buildErr) {
        console.error("Error rebuilding assets:", buildErr);
      }

      // 5. Restart process
      console.log("Trial reset complete. Exiting process to let Docker restart...");
      process.exit(0);

    } catch (error) {
      console.error("Critical error in trial reset:", error);
    }
  }
}

module.exports = TaskScheduler;
