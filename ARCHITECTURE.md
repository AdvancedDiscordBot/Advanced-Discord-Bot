# Architecture

This file summarizes the runtime architecture and data model of the bot **as
implemented in the repository**. It is derived directly from the code
(`index.js`, `core/`, `events/`, `utils/`, `models/`). When code and this doc
disagree, the code wins — please update this file in the same change.

The project has two layers:

1. **The Discord bot** — the classic command/event/scheduler runtime.
2. **The plugin platform** — process isolation, a capability broker, an HTTP
   API, a React admin dashboard, and a multi-tenant RBAC system layered on top.

---

## High-level components

### Bot runtime
- **`index.js`** — entry point (`npm start`). Constructs the discord.js
  `Client`, initializes the `Database` singleton, `TaskScheduler`, `HookBus`,
  and `PluginManager`, optionally starts the API server, loads plugins, then
  logs in. See **Startup sequence** below.
- **Command loader / `deploy-commands.js`** — registers slash commands with the
  Discord REST API. `npm run deploy` runs `scripts/build-plugins.js` first
  (rebuilds plugin dashboards) then `deploy-commands.js`.
- **Events (`events/`)** — `interactionCreate.js` (slash/button/modal/select
  dispatch, cooldowns, per-guild plugin gate), `messageCreate.js` (XP, AI
  auto-response), plus `ready.js`, `guildMemberAdd.js`, etc.
- **Database layer (`utils/database.js` + `models/schemas.js`)** — a singleton
  wrapping Mongoose models. See **Data models**.
- **Scheduler (`utils/scheduler.js`)** — `node-cron` jobs: daily/weekly resets,
  hourly leaderboard, role checks, birthday checks.

### Plugin platform (`core/`)
- **`PluginManager.js`** — discovers, load-orders (topological), loads, and
  hot-reloads plugins. Owns the **per-guild enable index** (see RBAC below).
- **`PluginContext.js`** — the frozen, namespaced `ctx` handed to each plugin
  (`db`, `scheduler`, `hooks`, `logger`, `registerCommand/Event`,
  `defineModel`). Wraps `hooks` so handlers are guild-gated.
- **`HookBus.js`** — inter-plugin pub/sub (`onLevelUp`, `onPluginUnload`, …).
- **Isolation / RPC (`core/rpc/`)** — untrusted plugins run in
  `worker_threads`; `broker.js` is the **CapabilityBroker** that mediates every
  privileged call over an RPC protocol (`protocol.js`, `worker-manager.js`,
  `worker-client.js`, `process-router.js`). `capabilities.js` +
  `manifest-schema.js` define and validate what a plugin may request.
- **API server (`core/api/server.js`)** — Fastify app exposing the dashboard
  REST API. `adminPlugin.js` registers the guild/admin routes. Auth is Discord
  OAuth + session cookie.
- **RBAC (`core/permission-resolver.js` + `core/dashboard-permissions.js`)** —
  derives who-can-do-what per request. See **Multi-tenant RBAC**.
- **Watchdog (`core/adb-watchdog.js`)** — independent supervisor process +
  reverse proxy. Restarts the bot on the dashboard "Restart & Deploy" action and
  proxies `/dashboard` and plugin UIs. Runs as its own process (not started by
  `index.js`).

---

## Startup sequence (`startADB` in `index.js`)

1. `initializeDatabase()` — connect Mongo (`MONGODB_URI`).
2. Construct `TaskScheduler`, `HookBus`, `PluginManager` (wired to
   `client`, `db`, `scheduler`, `hooks`).
3. Unless `PLUGIN_ISOLATION=false`, call `pluginManager.enableIsolation()` so
   package plugins load in workers.
4. If `BOT_API_ENABLED=true`, `startApiServer(...)` with `startListening: false`
   (built now, bound later).
5. `pluginManager.loadAll()` — loads plugins and warms the per-guild enable
   index.
6. `apiServer.listen()` — bind the API port now that plugins are registered.
7. `client.login(DISCORD_TOKEN)`.

---

## Plugin model: core vs. installable, isolated vs. raw

A plugin's `source` determines how it loads and whether it is gateable:

| Source | Where | Loads in | Gateable per-guild? |
|---|---|---|---|
| `core` / builtin | `plugins/*` in-repo | main process | No — always on |
| `local` | local dev dirs | main process | No — always on |
| `package` (isolated) | `node_modules/adb-plugin-*` | **worker thread** | **Yes** |
| `package` + `raw-client` | declares `system: ["raw-client"]` | main process (real `client`) | No — always on, **API rejects toggling** |

**Gateable = `source === "package"` and NOT `raw-client`.** Isolated package
plugins go through the broker, so the platform can gate them. `raw-client`
plugins bypass the broker (they hold the real bot token), so a per-guild gate on
them would be unenforceable — the API returns `not_toggleable` instead of
pretending.

---

## Multi-tenant RBAC (Spec 1)

The dashboard is multi-tenant: one bot instance serves many guilds, and access
is resolved **live per request** from the bot's member cache (60s TTL), never
from a login-time snapshot — a user demoted in Discord loses dashboard access
without re-logging in.

### Tiers (`core/permission-resolver.js`)
| Tier | Who | Powers |
|---|---|---|
| `HOST_OWNER` | listed in `OWNER_IDS` | The operator. **Sole** authority to install/uninstall plugins. Holds every permission in every guild, even guilds it hasn't joined. |
| `GUILD_ADMIN` | guild owner, or `ADMINISTRATOR` / `MANAGE_GUILD` in that guild | Every permission **for that guild**, including enabling/disabling installed plugins — but never install/uninstall. |
| `MEMBER` | in the guild | Union of permissions granted to their Discord roles via `GuildRoleGrant`. Usually empty. |
| `NONE` | not in the guild (or bot isn't) | 403. |

`resolve(userId, guildId)` is cached per `(userId, guildId)` for `DEFAULT_TTL_MS`
(60s) and invalidated eagerly on `guildMemberUpdate/Remove`, `roleUpdate/Delete`,
and on any grant edit (`invalidateGuild`).

### Permission catalog (`core/dashboard-permissions.js`)
- **Core permissions** (platform-level, plugin `null`): `guild.view`,
  `guild.configure`, `plugins.manage`, `roles.manage`.
- **Per-plugin**, auto-derived for every loaded plugin: `plugin.<name>.view`,
  `plugin.<name>.configure`. A plugin may declare its own keys in
  `manifest.dashboard.permissions[]`; those are **always re-namespaced** under
  `plugin.<name>.` so a plugin cannot mint a permission outside its namespace
  (e.g. claim `plugins.manage`).
- Guild admins map Discord roles → sets of these keys (`GuildRoleGrant`); the
  resolver turns a member's roles into the union of granted keys.

### Per-guild plugin enable gate (`core/PluginManager.js`)
- Installed gateable plugins are **off by default per guild**; a guild admin
  opts in from the dashboard.
- Enforced synchronously on hot paths via a pre-warmed **enable index** — a Set
  of `"guildId:pluginName"` rebuilt from one query (`getAllEnabledPluginRows`)
  on a 60s TTL, plus eager `setEnabledForGuild` on toggle. On a DB error the
  last good snapshot is kept.
- Chokepoints that consult the gate: Discord **event forwarding** to workers
  (`worker-manager.broadcastEvent` filter), the **HookBus facade** in
  `PluginContext`, and **command dispatch** in `events/interactionCreate.js`.
  (In normal isolated operation the broker boundary is the real gate; the
  in-process hook/event checks are defense-in-depth and cover
  `PLUGIN_ISOLATION=false`.)

---

## Dashboard API surface (selected)

Served by `core/api/server.js` (+ `core/adminPlugin.js`), all guild routes
guarded by `requireGuildAccess(request, reply, <permission>)`:

- `GET /api/guild/:guildId` — guild summary; returns caller `access: { tier, permissions }`.
- `GET /api/guild/:guildId/plugins` — installed plugins annotated with
  `gateable` and `enabledForGuild`.
- `PUT /api/guild/:guildId/plugins/:name/enabled` — toggle a gateable plugin for
  the guild (`400 not_toggleable` for non-gateable). Gated `plugins.manage`.
- `GET /api/guild/:guildId/permissions/catalog` — full permission catalog. Gated `roles.manage`.
- `GET /api/guild/:guildId/roles/grants` — guild roles + current grants. Gated `roles.manage`.
- `PUT|DELETE /api/guild/:guildId/roles/grants/:roleId` — set/clear a role's
  granted permissions (validated against the catalog). Gated `roles.manage`.
- Host-owner-only: `/api/plugins/*` (install, uninstall, update, marketplace,
  restart).

The React admin dashboard lives in `plugins/administration/web` (CRA, built to
`/dashboard`). Its Sidebar and pages are permission-filtered from the `access`
payload; the **Access** page (`Roles.jsx`) is the role→permission editor.

---

## Data models (high-level)

Defined in `models/schemas.js`, exposed via `utils/database.js`:

- **ServerConfig** — per-guild config (AI, tickets, XP/role automation, birthdays…).
- **UserProfile** — per-user-per-guild (`wallet`, `bank`, `totalXp`, `level`, …).
- **PluginConfig** — per-guild-per-plugin config **and the `enabled` flag** that
  drives the per-guild enable gate.
- **GuildRoleGrant** — the only RBAC table: `(guildId, roleId) → permissions[]`.
- **Ticket, AIRateLimit, XPTransaction, Leaderboard, Birthday, GuildEconomy,
  ShopItem, TruthOrDareConfig, AntiRaid** — feature-specific schemas.

(See `models/schemas.js` for full field lists and indexes.)

---

## External integrations

- Discord (**discord.js v14**) — runtime + components + OAuth
- **MongoDB** (Mongoose 8) — persistence and sessions
- **Fastify 4** — dashboard API (cors, cookie, session, static)
- Google Gemini (`@google/genai`) — AI features (`GEMINI_API_KEY`)
- `node-cron` — scheduling
- `worker_threads` — plugin isolation

---

## Environment variables

Core bot:
- `DISCORD_TOKEN` (required) — bot token
- `CLIENT_ID` (for `deploy-commands.js`) — application id
- `GUILD_ID` (optional) — guild-scoped command deploy
- `MONGODB_URI` (required) — Mongo connection string
- `GEMINI_API_KEY` (optional) — Google Gemini

Platform / dashboard:
- `BOT_API_ENABLED` — `true` to start the Fastify API
- `BOT_API_PORT`, `BOT_API_BASE_URL` — API bind/base
- `OWNER_IDS` — comma-separated host-owner user IDs (**the HOST_OWNER tier**)
- `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`,
  `DISCORD_OAUTH_REDIRECT_URI` — dashboard login
- `SESSION_SECRET`, `DASHBOARD_REDIRECT_URL`, `CORS_ORIGIN` — session/redirect/CORS
- `PLUGIN_ISOLATION` — `false` to disable worker isolation (not for production)
- `PLUGIN_REGISTRY_URL` — plugin marketplace source
- `WATCHDOG_PORT` — watchdog reverse-proxy port
- `INVITE_FORCE_ADMIN`, `TRIAL_MODE`, `DEBUG`, `PORT` — misc/optional

---

## Permissions & Intents

- Intents (`index.js`): `Guilds`, `GuildMembers`, `GuildMessages`,
  `MessageContent`, `GuildMessageReactions`, `GuildVoiceStates`,
  `GuildPresences`. The privileged ones (Message Content, Guild Members,
  Presences) must be enabled in the Developer Portal.
- The **invite permission integer** is computed from enabled plugins'
  `discordPermissions` (`core/permissions.js`), not hardcoded.

---

## Scaling & operational notes

- Scheduler and the enable index are in-process; running multiple bot instances
  duplicates scheduled jobs and each keeps its own index — coordinate (single
  scheduler process / leader election) if you scale out.
- The watchdog is a separate process; the dashboard "Restart & Deploy" goes
  through it.
- RBAC resolution and the enable index both fail closed (empty index = gateable
  plugins off; DB error on grants = no permissions granted).

---

## Extending the bot

- **New command:** add a file under `commands/<category>/` exporting `data` +
  `execute`; run `npm run deploy`.
- **New event:** add a file in `events/` exporting `{ name, execute, once? }`.
- **New plugin:** see `CREATE-PLUGIN.md`. Declare capabilities and
  `discordPermissions` in the manifest; optionally declare
  `dashboard.permissions[]`.
- **New DB model:** update `models/schemas.js` and expose via
  `utils/database.js`.
- **New dashboard permission:** it is auto-derived from the plugin name; only
  declare `dashboard.permissions[]` when you need finer-grained keys.

---

## Roadmap

- **Spec 1 — Multi-tenant RBAC:** ✅ implemented (this document).
- **Spec 2 — Member portal:** 🚧 platform foundation shipped. A separate
  `/me/*` self-service surface where members see their own data (rank,
  reminders, tickets). Landed: the `webUi.memberPages` manifest field
  (normalize + validate), `PluginManager.getMemberPages(guildId)` (gated by the
  per-guild enable flag), the `GET /api/me/guild/:guildId/pages` API (any tier
  above NONE), and the `/me` route tree in the dashboard SPA (guild picker →
  guild pages → embedded plugin page). Remaining: individual plugins declare
  their `memberPages` and serve the corresponding member routes — propagated to
  the ~18 plugin repos incrementally.
