const path = require('path');
const fs = require('fs');

async function register(fastify, { client, db }) {
  const webDir = path.join(__dirname, '..', 'plugins', 'administration', 'web', 'build');

  if (fs.existsSync(webDir)) {
    fastify.register(require('@fastify/static'), {
      root: webDir,
      prefix: '/dashboard/',
      decorateReply: false,
    });
  }

  const requireGuildAccess = (request, reply) => {
    const guildId = request.params.guildId;
    const ownerIds = request.session.ownerIds || [];
    if (ownerIds.includes(request.session.user?.id)) return true;
    const allowed = request.session.adminGuildIds || [];
    if (!allowed.includes(guildId)) {
      reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  fastify.get('/api/guilds', async (request) => {
    const guildIds = request.session.adminGuildIds || [];
    const botGuilds = client.guilds.cache;
    const guilds = guildIds
      .filter((id) => botGuilds.has(id))
      .map((id) => {
        const g = botGuilds.get(id);
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          memberCount: g.memberCount,
        };
      });
    return { guilds };
  });

  fastify.get('/api/guild/:guildId', async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;
    const guild = client.guilds.cache.get(request.params.guildId);
    if (!guild) return reply.code(404).send({ error: 'Guild not found' });
    await db.ensureConnection();
    const serverConfig = await db.getServerConfig(request.params.guildId);
    const channels = guild.channels.cache
      .filter((c) => c.type === 0)
      .map((c) => ({ id: c.id, name: c.name }));
    const roles = guild.roles.cache
      .filter((r) => !r.managed && r.name !== '@everyone')
      .map((r) => ({ id: r.id, name: r.name, color: r.color }))
      .sort((a, b) => b.position - a.position);
    return {
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        memberCount: guild.memberCount,
      },
      config: serverConfig.toObject(),
      channels,
      roles,
    };
  });

  fastify.get('/api/guild/:guildId/leaderboard', async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;
    await db.ensureConnection();
    const limit = Number(request.query.limit) || 10;
    const users = await db.getTopUsers(request.params.guildId, limit);
    return { users };
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const indexPath = path.join(webDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      return reply.code(200).type('text/html').send(fs.readFileSync(indexPath));
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}

module.exports = { register };
