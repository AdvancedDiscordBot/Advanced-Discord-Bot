const path = require("path");
const fs = require("fs");

async function load(ctx) {
  const fastify = ctx.client.fastify;
  if (!fastify) {
    ctx.logger.warn(
      "Administration panel plugin loaded, but the API server (fastify) is not initialized/enabled."
    );
    return;
  }

  const webDir = path.join(__dirname, "web", "build");
  if (fs.existsSync(webDir)) {
    fastify.register(require("@fastify/static"), {
      root: webDir,
      prefix: "/dashboard/",
      decorateReply: false,
    });
    ctx.logger.info(`Serving administration dashboard from ${webDir} at /dashboard/`);
  } else {
    ctx.logger.warn(`Administration dashboard build directory not found at ${webDir}. Run 'npm run deploy' to build it.`);
  }

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

  // Administration-specific API endpoints
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
}

module.exports = { load };
