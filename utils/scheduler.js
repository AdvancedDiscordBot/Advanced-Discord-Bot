const cron = require("node-cron");
const Database = require("./database");

class TaskScheduler {
	constructor(client, { env = process.env, timers = globalThis } = {}) {
		this.client = client;
		this.env = env;
		this.timers = timers;
		this.pluginTasks = new Map();
		this._running = new Map();
		this._timeouts = new Set();
		this._stopping = false;
		try {
			this.setupTasks();
		} catch (error) {
			for (const task of this.pluginTasks.values()) task.stop();
			this.pluginTasks.clear();
			throw error;
		}
	}

	// Keep the shipped direct-plugin signature and return the underlying cron task.
	schedule(name, cronExpression, fn) {
		if (this._stopping) throw new Error("TaskScheduler is shut down");
		if (typeof fn !== "function") throw new TypeError("Scheduled task callback must be a function");
		const task = cron.schedule(cronExpression, () => {
			if (this._stopping || this.pluginTasks.get(name) !== task || this._running.has(name)) return Promise.resolve();
			const running = Promise.resolve().then(() => {
				if (!this._stopping && this.pluginTasks.get(name) === task) return fn();
			}).catch((error) => {
				console.error(`Error in scheduled task "${name}":`, error);
			}).finally(() => this._running.delete(name));
			this._running.set(name, running);
			return running;
		}, { scheduled: false, timezone: "UTC" });
		this.unschedule(name);
		this.pluginTasks.set(name, task);
		task.start();
		return task;
	}

	unschedule(name) {
		const task = this.pluginTasks.get(name);
		if (!task) return false;
		task.stop();
		this.pluginTasks.delete(name);
		return true;
	}

	setupTasks() {
		for (const [name, expression, method] of [
			["daily-reset", "0 0 * * *", "runDailyReset"],
			["weekly-reset", "0 0 * * 1", "runWeeklyReset"],
			["leaderboards", "0 * * * *", "updateLeaderboards"],
			["role-rewards", "*/30 * * * *", "checkAllRoleRewards"],
			["birthdays", "0 8 * * *", "checkBirthdays"],
		]) {
			this.schedule(`core:${name}`, expression, () => this[method]());
		}
		if (this.env.TRIAL_MODE === "true") {
			this.schedule("core:trial-reset", "0 */5 * * *", () => this.runTrialReset());
		}
	}

	shutdown() {
		if (this._shutdownPromise) return this._shutdownPromise;
		this._stopping = true;
		const errors = [];
		for (const task of this.pluginTasks.values()) {
			try { task.stop(); } catch (error) { errors.push(error); }
		}
		this.pluginTasks.clear();
		for (const timer of this._timeouts) this.timers.clearTimeout(timer);
		this._timeouts.clear();
		this._shutdownPromise = Promise.allSettled([...this._running.values(), this._birthdayWork]).then(() => {
			if (errors.length) throw new AggregateError(errors, "Scheduled task shutdown failed");
		});
		return this._shutdownPromise;
	}

  async runDailyReset() {
    try {
      const db = this.client.db || await Database.getInstance();
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
      const db = this.client.db || await Database.getInstance();
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
      const db = this.client.db || await Database.getInstance();
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
      const db = this.client.db || await Database.getInstance();
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
      const db = this.client.db || await Database.getInstance();
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

	checkBirthdays(member) {
		// Join-triggered and daily checks share a queue so they cannot announce
		// the same birthday from two stale lastCelebrated snapshots.
		this._birthdayWork = (this._birthdayWork || Promise.resolve()).then(() => {
			if (!this._stopping) return this._checkBirthdays(member);
		}).catch((error) => console.error("Error checking birthdays:", error));
		return this._birthdayWork;
	}

  async _checkBirthdays(joiningMember) {
    try {
      const db = this.client.db || await Database.getInstance();
      const today = new Date();

      const guilds = joiningMember ? [joiningMember.guild] : this.client.guilds.cache.values();
      for (const guild of guilds) {
        if (this._stopping) break;
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
            ...(joiningMember ? { userId: joiningMember.id } : {}),
          });

          const todaysBirthdays = birthdays.filter((birthday) => {
            const birthDate = new Date(birthday.birthdayDate);
            const lastCelebrated = birthday.lastCelebrated
              ? new Date(birthday.lastCelebrated)
              : null;

            // Check if it's their birthday today and hasn't been celebrated today
            const isBirthdayToday =
              birthDate.getUTCMonth() === today.getUTCMonth() &&
              birthDate.getUTCDate() === today.getUTCDate();

            const notCelebratedToday =
              !lastCelebrated ||
              lastCelebrated.toISOString().slice(0, 10) !== today.toISOString().slice(0, 10);

            return isBirthdayToday && notCelebratedToday;
          });

          for (const birthday of todaysBirthdays) {
            if (this._stopping) break;
            try {
              const member = joiningMember || await guild.members
                .fetch(birthday.userId)
                .catch(() => null);
              if (!member) continue;

              // Calculate age if birth year is available
              let ageText = "";
              const birthYear = new Date(birthday.birthdayDate).getUTCFullYear();
              if (birthYear > 1900) {
                // If a real year was provided
                const age = today.getUTCFullYear() - birthYear;
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
					if (!this._stopping) {
						const timer = this.timers.setTimeout(() => {
							this._timeouts.delete(timer);
							if (this._stopping) return;
							const removal = Promise.resolve().then(async () => {
								if (member.roles.cache.has(birthdayRole.id)) {
									await member.roles.remove(birthdayRole, "Birthday celebration ended");
								}
							}).catch((error) => console.error("Error removing birthday role:", error))
								.finally(() => this._running.delete(timer));
							this._running.set(timer, removal);
						}, 24 * 60 * 60 * 1000);
						this._timeouts.add(timer);
					}
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
