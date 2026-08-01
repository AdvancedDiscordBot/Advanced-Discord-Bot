const path = require('path');
const fs = require('fs');

const { TIERS } = require('./permission-resolver');

async function register(fastify, { client, db, permissions }) {
  const webDir = path.join(__dirname, '..', 'plugins', 'administration', 'web', 'build');

  if (fs.existsSync(webDir)) {
    fastify.register(require('@fastify/static'), {
      root: webDir,
      prefix: '/dashboard/',
      decorateReply: false,
    });
  }

  // Guild access is resolved live from Discord state (see permission-resolver),
  // never from a snapshot taken at login: a user who loses ADMINISTRATOR in
  // Discord must lose dashboard access without having to log out.
  const requireGuildAccess = async (request, reply, permission = null) => {
    const userId = request.session.user?.id;
    const guildId = request.params.guildId;
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    const access = await permissions.resolve(userId, guildId);
    if (access.tier === TIERS.NONE) {
      reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    if (permission && !access.permissions.has(permission)) {
      reply.code(403).send({ error: 'forbidden', missingPermission: permission });
      return null;
    }
    return access;
  };

  fastify.get('/api/guilds', async (request) => {
    const userId = request.session.user?.id;
    const botGuilds = client.guilds.cache;
    const isOwner = permissions.isHostOwner(userId);
    const candidates = isOwner
      ? Array.from(botGuilds.keys())
      : (request.session.candidateGuildIds || []).filter((id) => botGuilds.has(id));

    const resolved = await Promise.all(
      candidates.map(async (id) => {
        const access = await permissions.resolve(userId, id);
        if (access.tier === TIERS.NONE) return null;
        const g = botGuilds.get(id);
        return {
          id: g.id,
          name: g.name,
          icon: g.icon,
          memberCount: g.memberCount,
          tier: access.tier,
        };
      }),
    );

    return { guilds: resolved.filter(Boolean) };
  });

  fastify.get('/api/guild/:guildId', async (request, reply) => {
    const access = await requireGuildAccess(request, reply, 'guild.view');
    if (!access) return;
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
      // The caller's live access for THIS guild, so the dashboard can gate its
      // own nav and controls to what the server will actually authorize.
      access: { tier: access.tier, permissions: Array.from(access.permissions) },
    };
  });

  fastify.get('/api/guild/:guildId/leaderboard', async (request, reply) => {
    if (!(await requireGuildAccess(request, reply, 'guild.view'))) return;
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
