const fastifyFactory = require("fastify");
const cookie = require("@fastify/cookie");
const session = require("@fastify/session");
const MongoStore = require("connect-mongo");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { registry } = require("../../core/pluginRegistry");

const ADMIN_PERMISSION = 0x8;
const MANAGE_GUILD_PERMISSION = 0x20;

function parseOwnerIds() {
  const raw = process.env.OWNER_IDS || "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasGuildPermission(guild) {
  if (guild.owner) return true;
  const permissions = Number(guild.permissions || 0);
  return (
    (permissions & ADMIN_PERMISSION) === ADMIN_PERMISSION ||
    (permissions & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION
  );
}

async function load(ctx) {
  const port = ctx.config.env.ADMINISTRATION_PORT || 50000;
  const sessionSecret = ctx.config.env.SESSION_SECRET;
  const botApiUrl =
    ctx.config.env.ADMINISTRATION_BOT_API_URL ||
    `http://localhost:${ctx.config.env.BOT_API_PORT || 3210}`;

  if (!sessionSecret) {
    ctx.logger.warn(
      "Administration panel disabled - missing SESSION_SECRET environment variable"
    );
    return;
  }

  const fastify = fastifyFactory({ logger: false });

  const sessionStore = MongoStore.create({
    mongoUrl: ctx.config.env.MONGODB_URI,
    collectionName: "adb_sessions",
  });

  await fastify.register(cookie);
  await fastify.register(session, {
    secret: sessionSecret,
    cookieName: "adb.sid",
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: ctx.config.env.NODE_ENV === "production" ? "lax" : false,
      secure: ctx.config.env.NODE_ENV === "production",
    },
    store: sessionStore,
    saveUninitialized: false,
  });

  const webDir = path.join(__dirname, "web", "build");
  if (fs.existsSync(webDir)) {
    fastify.register(require("@fastify/static"), {
      root: webDir,
      prefix: "/",
      decorateReply: false,
    });
  }

  fastify.get("/health", async () => ({ status: "ok", plugin: "administration" }));

  fastify.get("/auth/discord", async (request, reply) => {
    return reply.redirect(
      `${botApiUrl}/auth/discord?redirect=http://localhost:${port}`
    );
  });

  fastify.post("/auth/logout", async (request) => {
    request.session.destroy();
    return { ok: true };
  });

  fastify.get("/api/me", async (request, reply) => {
    if (!request.session.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const guildIds = request.session.adminGuildIds || (request.session.guildData ? request.session.guildData.map(g => g.id) : []);
    const botGuilds = ctx.client.guilds.cache;
    const guilds = guildIds
      .filter((id) => botGuilds.has(id))
      .map((id) => {
        const discordGuild = botGuilds.get(id);
        return {
          id: discordGuild.id,
          name: discordGuild.name,
          icon: discordGuild.icon || (discordGuild.iconURL ? discordGuild.iconURL() : null),
        };
      });

    console.log("[DEBUG] /api/me returning guilds:", guilds);

    return {
      user: request.session.user,
      guilds: guilds,
      isOwner:
        request.session.ownerIds?.includes(request.session.user?.id) || false,
    };
  });

  fastify.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api")) return;
    if (request.url === "/api/me") return;
    if (!request.session.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  const requireGuildAccess = (request, reply) => {
    const guildId = request.params.guildId;
    const ownerIds = request.session.ownerIds || [];

    if (ownerIds.includes(request.session.user?.id)) {
      return true;
    }

    const allowed = request.session.adminGuildIds || (request.session.guildData ? request.session.guildData.map(g => g.id) : []);
    if (!allowed.includes(guildId)) {
      reply.code(403).send({ error: "forbidden" });
      return false;
    }

    return true;
  };

  fastify.get("/api/guilds", async (request) => {
    const guildIds = request.session.adminGuildIds || (request.session.guildData ? request.session.guildData.map(g => g.id) : []);
    const botGuilds = ctx.client.guilds.cache;

    const guilds = guildIds
      .filter((id) => botGuilds.has(id))
      .map((id) => {
        const discordGuild = botGuilds.get(id);
        return {
          id: discordGuild.id,
          name: discordGuild.name,
          icon: discordGuild.icon || (discordGuild.iconURL ? discordGuild.iconURL() : null),
          memberCount: discordGuild?.memberCount || 0,
          online:
            discordGuild?.members.cache.filter(
              (m) => m.presence?.status !== "offline"
            ).size || 0,
        };
      });

    return { guilds };
  });

  fastify.get("/api/guild/:guildId", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    const guild = ctx.client.guilds.cache.get(request.params.guildId);
    if (!guild) {
      return reply.code(404).send({ error: "Guild not found" });
    }

    await ctx.db.ensureConnection();

    const serverConfig = await ctx.db.getServerConfig(request.params.guildId);
    const economySettings = await ctx.db.getGuildEconomy(request.params.guildId);
    let antiRaid = await ctx.db.AntiRaid.findOne({
      guildId: request.params.guildId,
    });

    if (!antiRaid) {
      antiRaid = {
        enabled: false,
        joinThreshold: 5,
        timeWindow: 10,
        action: "kick",
        alertChannel: null,
      };
    }

    const channels = guild.channels.cache
      .filter((c) => c.type === 0)
      .map((c) => ({ id: c.id, name: c.name }));
    const categories = guild.channels.cache
      .filter((c) => c.type === 4)
      .map((c) => ({ id: c.id, name: c.name }));
    const roles = guild.roles.cache
      .filter((r) => !r.managed && r.name !== "@everyone")
      .map((r) => ({ id: r.id, name: r.name, color: r.color }))
      .sort((a, b) => b.position - a.position);

    return {
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        memberCount: guild.memberCount,
      },
      config: {
        ...serverConfig.toObject(),
        economy: economySettings,
        antiRaid,
      },
      channels,
      categories,
      roles,
    };
  });

  fastify.get("/api/guild/:guildId/stats", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    await ctx.db.ensureConnection();

    const guild = ctx.client.guilds.cache.get(request.params.guildId);
    const tickets = await ctx.db.getTickets(request.params.guildId);

    const userCount = await ctx.db.UserProfile.countDocuments({
      guildId: request.params.guildId,
    });

    const xpData = await ctx.db.UserProfile.aggregate([
      { $match: { guildId: request.params.guildId } },
      {
        $group: {
          _id: null,
          totalXp: { $sum: "$totalXp" },
          totalMessages: { $sum: "$messageCount" },
          totalVoiceMinutes: { $sum: "$voiceMinutes" },
        },
      },
    ]);

    const stats = xpData[0] || {
      totalXp: 0,
      totalMessages: 0,
      totalVoiceMinutes: 0,
    };

    return {
      members: guild?.memberCount || 0,
      activeUsers: userCount,
      totalXp: stats.totalXp,
      totalMessages: stats.totalMessages,
      totalVoiceMinutes: stats.totalVoiceMinutes,
      tickets: {
        total: tickets.length,
        open: tickets.filter((t) => t.status === "open").length,
        inProgress: tickets.filter((t) => t.status === "in_progress").length,
        closed: tickets.filter((t) => t.status === "closed").length,
      },
    };
  });

  fastify.get("/api/guild/:guildId/leaderboard", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    await ctx.db.ensureConnection();

    const limit = Number(request.query.limit) || 10;
    const users = await ctx.db.getTopUsers(request.params.guildId, limit);

    return { users };
  });

  fastify.get("/api/guild/:guildId/tickets", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    await ctx.db.ensureConnection();

    const status = request.query.status || null;
    const tickets = await ctx.db.getTickets(request.params.guildId, status);

    return { tickets };
  });

  fastify.put("/api/guild/:guildId/config", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    await ctx.db.ensureConnection();

    const { serverConfig, antiRaid, economy } = request.body || {};

    let updatedServer = null;
    if (serverConfig) {
      const allowedFields = [
        "aiEnabled",
        "aiContext",
        "aiChannels",
        "aiMode",
        "xpEnabled",
        "xpPerMessage",
        "xpPerVoiceMinute",
        "roleAutomation",
        "roleRewards",
        "trackingChannels",
        "excludeChannels",
        "ticketCategoryId",
        "ticketLogChannelId",
        "birthdayEnabled",
        "birthdayChannelId",
        "birthdayRoleId",
      ];

      const filtered = {};
      for (const key of allowedFields) {
        if (serverConfig[key] !== undefined) {
          filtered[key] = serverConfig[key];
        }
      }

      updatedServer = await ctx.db.updateServerConfig(
        request.params.guildId,
        filtered
      );
    }

    if (antiRaid) {
      await ctx.db.AntiRaid.findOneAndUpdate(
        { guildId: request.params.guildId },
        { $set: antiRaid },
        { upsert: true, new: true }
      );
    }

    if (economy) {
      await ctx.db.GuildEconomy.findOneAndUpdate(
        { guildId: request.params.guildId },
        { $set: economy },
        { upsert: true, new: true }
      );
    }

    return { ok: true, serverConfig: updatedServer };
  });

  fastify.get("/api/guild/:guildId/activity", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    await ctx.db.ensureConnection();

    const days = Number(request.query.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const transactions = await ctx.db.XPTransaction.find({
      guildId: request.params.guildId,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(100);

    return { transactions };
  });

  fastify.get("/api/guild/:guildId/shop", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    await ctx.db.ensureConnection();

    const items = await ctx.db.ShopItem.find({
      guildId: request.params.guildId,
    });

    return { items };
  });

  fastify.post("/api/guild/:guildId/shop", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;

    await ctx.db.ensureConnection();

    const item = await ctx.db.ShopItem.create({
      guildId: request.params.guildId,
      ...request.body,
    });

    return { item };
  });

  fastify.delete(
    "/api/guild/:guildId/shop/:itemId",
    async (request, reply) => {
      if (!requireGuildAccess(request, reply)) return;

      await ctx.db.ensureConnection();

      await ctx.db.ShopItem.findByIdAndDelete(request.params.itemId);

      return { ok: true };
    }
  );

  fastify.get("/api/plugins", async () => {
    return { plugins: ctx.pluginManager.getPluginList() };
  });

  fastify.get("/api/plugins/marketplace", async (request) => {
    const { q, category } = request.query;
    const plugins = await registry.searchPlugins(q, category);
    const installed = ctx.pluginManager.getPluginList();
    const installedNames = new Set(installed.map((p) => p.name));

    return {
      plugins: plugins.map((p) => ({
        ...p,
        installed: installedNames.has(p.npmPackage) || installedNames.has(p.name),
      })),
    };
  });

  fastify.get("/api/plugins/categories", async () => {
    return { categories: registry.getCategories() };
  });

  fastify.post("/api/plugins/install", async (request, reply) => {
    const { packageName } = request.body || {};
    if (!packageName) {
      return reply.code(400).send({ error: "Package name required" });
    }

    return new Promise((resolve) => {
      const child = spawn("npm", ["install", packageName], {
        cwd: process.cwd(),
        shell: true,
      });

      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
      });
      child.stderr.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", async (code) => {
        if (code === 0) {
          try {
            await ctx.pluginManager.loadAll();
            resolve({ ok: true });
          } catch (err) {
            resolve({ ok: false, error: "Failed to load plugins" });
          }
        } else {
          resolve({ ok: false, error: `npm install failed: ${output}` });
        }
      });
    });
  });

  fastify.post("/api/plugins/uninstall", async (request, reply) => {
    const { packageName } = request.body || {};
    if (!packageName) {
      return reply.code(400).send({ error: "Package name required" });
    }

    return new Promise((resolve) => {
      const child = spawn("npm", ["uninstall", packageName], {
        cwd: process.cwd(),
        shell: true,
      });

      child.on("close", async (code) => {
        if (code === 0) {
          try {
            await ctx.pluginManager.loadAll();
            resolve({ ok: true });
          } catch (err) {
            resolve({ ok: false, error: "Failed to reload plugins" });
          }
        } else {
          resolve({ ok: false, error: "npm uninstall failed" });
        }
      });
    });
  });

  fastify.post("/api/plugins/unload/:name", async (request, reply) => {
    const ok = await ctx.pluginManager.unloadPlugin(request.params.name, "api");
    if (!ok) {
      return reply.code(404).send({ error: "Plugin not unloaded" });
    }
    return { ok: true };
  });

  fastify.post("/api/plugins/reload/:name", async (request, reply) => {
    const ok = await ctx.pluginManager.reloadPlugin(request.params.name);
    if (!ok) {
      return reply.code(409).send({ error: "Plugin not reloadable" });
    }
    return { ok: true };
  });

  fastify.post("/api/plugins/submit", async (request, reply) => {
    const { packageName, description, author, category } = request.body || {};
    if (!packageName || !description || !author) {
      return reply.code(400).send({ error: "Missing required fields" });
    }
    if (!packageName.startsWith("adb-plugin-")) {
      return reply.code(400).send({ error: "Package name must start with 'adb-plugin-'" });
    }
    return registry.submitPlugin({ packageName, description, author, category });
  });

  fastify.post("/api/plugins/restart", async (request, reply) => {
    const ownerIds = parseOwnerIds();
    const isOwner = ownerIds.includes(request.session.user?.id);
    if (!isOwner) {
      return reply.code(403).send({ error: "Only bot owners can restart" });
    }

    ctx.logger.info("Scheduling bot restart...");
    setTimeout(() => {
      const restartScript = path.join(__dirname, "..", "..", "core", "api", "restart-bot.js");
      spawn("node", [restartScript], {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
      });
      process.exit(0);
    }, 1000);

    return { ok: true, message: "Restarting bot..." };
  });

  fastify.get("/api/plugins/config/:pluginName", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;
    await ctx.db.ensureConnection();
    const config = await ctx.db.getPluginConfig(request.params.guildId, request.params.pluginName);
    return { config: config?.data || {} };
  });

  fastify.put("/api/plugins/config/:pluginName", async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;
    await ctx.db.ensureConnection();
    const updated = await ctx.db.updatePluginConfig(
      request.params.guildId,
      request.params.pluginName,
      request.body || {},
    );
    return { config: updated?.data || {} };
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    const indexPath = path.join(webDir, "index.html");
    if (fs.existsSync(indexPath)) {
      return reply.code(200).type("text/html").send(fs.readFileSync(indexPath));
    }
    return reply.code(404).send({ error: "Not found" });
  });

  await fastify.listen({ port, host: "0.0.0.0" });
  ctx.logger.info(`Administration panel running at http://localhost:${port}`);

  ctx.hooks.on("onPluginUnload", async ({ pluginName }) => {
    if (pluginName === "administration") {
      await fastify.close();
      ctx.logger.info("Administration panel stopped");
    }
  });
}

module.exports = { load };
