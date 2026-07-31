const { test } = require("node:test");
const assert = require("node:assert");
const {
  PermissionResolver,
  TIERS,
  hasAdminPermissions,
  roleIdsOf,
} = require("../core/permission-resolver");

// Minimal fakes ------------------------------------------------------------

function makeMember({ id, admin = false, roleIds = [] }) {
  return {
    id,
    permissions: { bitfield: admin ? 1n << 3n : 0n },
    roles: { cache: new Map(roleIds.map((r) => [r, { id: r }])) },
  };
}

function makeGuild({ ownerId = "owner", members = [] } = {}) {
  const cache = new Map(members.map((m) => [m.id, m]));
  return {
    ownerId,
    members: { cache, fetch: async (uid) => cache.get(uid) || Promise.reject(new Error("unknown")) },
  };
}

function makeResolver({ guild, guildId = "g1", grants = [], owners = "", plugins = [] } = {}) {
  process.env.OWNER_IDS = owners;
  const client = { guilds: { cache: new Map(guild ? [[guildId, guild]] : []) } };
  const db = { getGuildRoleGrants: async () => grants };
  const pluginManager = { plugins: new Map(plugins.map((p) => [p.name, p])) };
  return new PermissionResolver({ client, db, pluginManager, ttlMs: 60000 });
}

// Tiers --------------------------------------------------------------------

test("host owner resolves to HOST_OWNER without guild membership", async () => {
  const r = makeResolver({ guild: null, owners: "999" });
  const res = await r.resolve("999", "g1");
  assert.strictEqual(res.tier, TIERS.HOST_OWNER);
  assert.ok(res.permissions.has("plugins.manage"));
});

test("guild owner resolves to GUILD_ADMIN with all permissions", async () => {
  const guild = makeGuild({ ownerId: "u1", members: [makeMember({ id: "u1" })] });
  const r = makeResolver({ guild });
  const res = await r.resolve("u1", "g1");
  assert.strictEqual(res.tier, TIERS.GUILD_ADMIN);
  assert.ok(res.permissions.has("roles.manage"));
});

test("ADMINISTRATOR member resolves to GUILD_ADMIN", async () => {
  const guild = makeGuild({ ownerId: "owner", members: [makeMember({ id: "u2", admin: true })] });
  const r = makeResolver({ guild });
  const res = await r.resolve("u2", "g1");
  assert.strictEqual(res.tier, TIERS.GUILD_ADMIN);
});

test("plain member gets union of role grants", async () => {
  const guild = makeGuild({
    ownerId: "owner",
    members: [makeMember({ id: "u3", roleIds: ["rA", "rB"] })],
  });
  const grants = [
    { roleId: "rA", permissions: ["guild.view"] },
    { roleId: "rB", permissions: ["plugin.x.view"] },
    { roleId: "rC", permissions: ["roles.manage"] }, // not held
  ];
  const r = makeResolver({ guild, grants });
  const res = await r.resolve("u3", "g1");
  assert.strictEqual(res.tier, TIERS.MEMBER);
  assert.deepStrictEqual([...res.permissions].sort(), ["guild.view", "plugin.x.view"]);
});

test("non-member resolves to NONE", async () => {
  const guild = makeGuild({ ownerId: "owner", members: [] });
  const r = makeResolver({ guild });
  const res = await r.resolve("ghost", "g1");
  assert.strictEqual(res.tier, TIERS.NONE);
});

test("missing guild resolves to NONE", async () => {
  const r = makeResolver({ guild: null });
  const res = await r.resolve("u1", "g1");
  assert.strictEqual(res.tier, TIERS.NONE);
});

// Cache --------------------------------------------------------------------

test("resolve caches until invalidated", async () => {
  let fetches = 0;
  const member = makeMember({ id: "u1", roleIds: ["rA"] });
  const guild = {
    ownerId: "owner",
    members: {
      cache: new Map(),
      fetch: async () => { fetches++; return member; },
    },
  };
  const r = makeResolver({ guild, grants: [{ roleId: "rA", permissions: ["guild.view"] }] });

  await r.resolve("u1", "g1");
  await r.resolve("u1", "g1");
  assert.strictEqual(fetches, 1, "second resolve should hit cache");

  r.invalidate("u1", "g1");
  await r.resolve("u1", "g1");
  assert.strictEqual(fetches, 2, "invalidate should force refetch");
});

test("invalidateGuild clears only that guild", async () => {
  const r = makeResolver({ guild: makeGuild() });
  r.cache.set("u1:g1", { expiresAt: Date.now() + 1e6, result: {} });
  r.cache.set("u1:g2", { expiresAt: Date.now() + 1e6, result: {} });
  r.invalidateGuild("g1");
  assert.ok(!r.cache.has("u1:g1"));
  assert.ok(r.cache.has("u1:g2"));
});

test("check() enforces the requested permission", async () => {
  const guild = makeGuild({
    ownerId: "owner",
    members: [makeMember({ id: "u3", roleIds: ["rA"] })],
  });
  const r = makeResolver({ guild, grants: [{ roleId: "rA", permissions: ["guild.view"] }] });
  assert.strictEqual((await r.check("u3", "g1", "guild.view")).allowed, true);
  assert.strictEqual((await r.check("u3", "g1", "roles.manage")).allowed, false);
});

// Helpers ------------------------------------------------------------------

test("hasAdminPermissions reads raw bitfield and MANAGE_GUILD", () => {
  assert.strictEqual(hasAdminPermissions({ permissions: { bitfield: 1n << 3n } }), true);
  assert.strictEqual(hasAdminPermissions({ permissions: { bitfield: 1n << 5n } }), true);
  assert.strictEqual(hasAdminPermissions({ permissions: { bitfield: 0n } }), false);
  assert.strictEqual(hasAdminPermissions({}), false);
});

test("roleIdsOf tolerates array and discord.js shapes", () => {
  assert.deepStrictEqual(roleIdsOf({ roles: ["a", "b"] }), ["a", "b"]);
  assert.deepStrictEqual(
    roleIdsOf({ roles: { cache: new Map([["a", {}], ["b", {}]]) } }),
    ["a", "b"],
  );
  assert.deepStrictEqual(roleIdsOf({}), []);
});
