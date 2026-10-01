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
  (rebuilds plugin dashboards) then `deploy-commands.js`. It refuses an empty
  overwrite unless `--allow-empty` is passed, and never performs a global
  (non-guild) command overwrite.
- **Core events (`events/`)** — `interactionCreate.js` (slash/button/modal/select
  dispatch, cooldowns, per-guild plugin gate), `messageCreate.js` (hook
  emission + XP tracking), plus `ready.js`, `guildMemberAdd.js`,
  `guildCreate.js`, `voiceStateUpdate.js`. These are **not** loaded by
  `index.js`; `PluginManager.loadCore()` loads them as an internal plugin named
  `core` with `source: "builtin"` (see **Load order and discovery**).
  `helpInteraction.js` and `modalCreate.js` are excluded from that directory
  load and are not required anywhere else — they are currently dead files.
  There is no `commands/` directory, so `loadCommandsFromDir` is a no-op: the
  core ships **zero** slash commands. See `DOCUMENTATION.md`.
- **Database layer (`utils/database.js` + `models/schemas.js`)** — a singleton
  wrapping Mongoose models. See **Data models**.
- **Scheduler (`utils/scheduler.js`)** — `node-cron` jobs, all scheduled in
  `core:<name>` and evaluated in **UTC**. Set up in `setupTasks()`:

  | Task | Cron | Method |
  |---|---|---|
  | `core:daily-reset` | `0 0 * * *` | `runDailyReset` |
  | `core:weekly-reset` | `0 0 * * 1` | `runWeeklyReset` |
  | `core:leaderboards` | `0 * * * *` | `updateLeaderboards` |
  | `core:role-rewards` | `*/30 * * * *` | `checkAllRoleRewards` |
  | `core:birthdays` | `0 8 * * *` | `checkBirthdays` |
  | `core:trial-reset` | `0 */5 * * *` | `runTrialReset` — only when `TRIAL_MODE=true` |

  Re-scheduling a name replaces the previous task (`schedule` calls
  `unschedule` first). A task that throws is logged and does not kill the
  scheduler; an already-running task is not re-entered. `shutdown()` stops every
  task and waits for in-flight work.

### Plugin platform (`core/`)
- **`PluginManager.js`** — discovers plugins, orders them topologically, loads
  and hot-reloads them, and owns the **per-guild enable index** (see RBAC
  below). Also loads the internal `core` plugin.
- **`PluginContext.js`** — builds the `ctx` handed to each plugin. Surface:
  `client`, `db`, `scheduler`, `commands`, `registerCommand`, `overrideCommand`,
  `registerEvent`, `defineModel`, `models`, `hooks`, `config`, `logger`. `ctx` is
  non-extensible with every property read-only **except `models`**, which is
  writable so a plugin can assign `ctx.models = {...}`. `ctx.client` and
  `ctx.db` are wrapped in Proxies that log a deprecation warning on every
  property access. `hooks` is a facade that gates handlers by the per-guild
  enable flag and returns an unsubscribe function from `on`/`onAny`.
  Isolated plugins get a **different** `ctx` built in
  `core/rpc/worker-bootstrap.js` (see **Two contexts** below).
- **`HookBus.js`** — inter-plugin pub/sub (`onLevelUp`, `onPluginUnload`, …).
- **Isolation / RPC (`core/rpc/`)** — untrusted plugins run in
  `worker_threads`; `core/rpc/broker.js` is the **CapabilityBroker** that
  mediates every privileged call over an RPC protocol (`protocol.js`,
  `worker-manager.js`, `worker-client.js`, `worker-bootstrap.js`,
  `process-router.js`, `resource-limits.js`, `violations.js`, `metrics.js`,
  `schema-serialize.js`). `core/capabilities.js` + `core/manifest-schema.js`
  define and validate what a plugin may request, and
  `core/manifest-crossvalidate.js` checks the source against the manifest at
  install time. Note that `process-router.js` and `resource-limits.js` are not
  wired into the spawn path — see **Scaling & operational notes**.
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

## Startup sequence (`createADB()` → `initialize()` in `index.js`)

`createADB(options)` builds a runtime object and allocates **no** resources; the
work happens in `initialize()`, triggered by `runtime.start()`. `startADB()` is
just `createADB()` + `start()` and is what `require.main === module` calls.
Every collaborator is injectable (`createClient`, `getDatabase`,
`createScheduler`, `createPluginManager`, `startApiServer`, `process`, `timers`,
`logger`), which is what makes the runtime testable.

1. Assert `DISCORD_TOKEN` is a non-empty string, else throw.
2. Register process handlers for `SIGINT`, `SIGTERM`, `uncaughtException`,
   `unhandledRejection`. Each one triggers `shutdown()`; the two exception
   handlers also set `exitCode = 1`.
3. `createClient(...)` with 9 gateway intents (see **Permissions & Intents**) and
   the `Message`/`Channel`/`Reaction`/`User`/`GuildMember` partials. Then attach
   `client.commands`, `client.cooldowns`, `client.colors`, `client.profile`.
4. `getDatabase()` — connect Mongo (`MONGODB_URI`); exposed as `client.db`.
5. `createScheduler(client)` → `client.scheduler`;
   `new HookBus(...)` → `client.hooks`;
   `createPluginManager({ client, db, scheduler, hooks })` → `client.pluginManager`.
6. Unless `PLUGIN_ISOLATION === "false"`, call `pluginManager.enableIsolation()`
   so npm plugins load in workers.
7. If `BOT_API_ENABLED === "true"`, `startApiServer({ …, startListening: false })`.
   The Fastify instance is also mirrored onto `client.fastify`.
8. `reconcileInstalledPlugins()` (`core/plugin-persistence.js`) — re-installs
   plugins the dashboard had installed before a container rebuild. Failures are
   logged, not fatal.
9. `pluginManager.loadAll()` — loads plugins and warms the per-guild enable
   index.
10. `apiServer.listen()` — bind the API port only now that plugins are
    registered.
11. Register `Events.ClientReady` and `Events.GuildCreate` handlers, then
    `client.login(DISCORD_TOKEN)`.

Between each step `checkRunning()` throws `ADB_STARTUP_CANCELLED` if shutdown
started, and `interruptible()` races the remaining steps against the shutdown
signal. `onReady` refreshes profile stats, starts a 30s presence updater, and
runs `syncAllGuilds`; `onGuildCreate` syncs that guild's commands.

## Shutdown sequence (`shutdown()` in `index.js`)

Idempotent, and ordered so nothing uses a resource that is already closed:

1. Set `stopping`, resolve the startup-cancellation promise, remove the
   `ClientReady`/`GuildCreate` listeners, clear the presence timer.
2. Await any in-flight startup, then await all tracked async work
   (`Promise.allSettled`).
3. Close, in order: API server → scheduler → plugin manager → Discord client →
   database. Each failure is logged and collected; if any failed, shutdown ends
   by throwing an `AggregateError`.
4. Remove the process listeners registered in step 2 of startup.

`PluginManager.shutdown(reason)` stops plugin-owned resources only (unloading
plugins, unsubscribing hooks, shutting down workers) — the caller still owns
the DB, scheduler and client. It refuses new work once `_shuttingDown` is set,
and in-flight cron callbacks observe `_stopping` so they exit without running.

---

## Load order and discovery

`discoverPlugins()` scans two roots and skips broken npm symlinks:

- `node_modules/adb-plugin-*` → `source: "package"` (this is how plugins are
  actually installed);
- `plugins/*` in-repo → `source: "local"`, and the in-repo `administration`
  dashboard host.

`loadCore()` runs first and registers an internal plugin named `core` with
`source: "builtin"` and version `0.0.0`; it loads the `commands/` and `events/`
directories. Package and local plugins are then ordered by `getDependencies()`,
which unions the manifest's `dependsOn`, `dependencies` and
`engines.plugins` arrays. A plugin whose dependency is not discovered is marked
disabled with a warning. Ordering is a DFS topological sort that throws
`Circular dependency detected at <name>` on a cycle — the cycle is **not**
tolerated, so startup fails rather than picking an arbitrary order.

Each plugin is then checked with `checkEngines()`: `engines.core` is compared
against the `version` in this repo's `package.json` (read once at construction,
falling back to `0.0.0`), and each `engines.plugins.<name>` against the loaded
dependency's manifest version. Any unmet constraint means the plugin does not
load.

## Two contexts

The same `load(ctx)` code runs against two different `ctx` objects:

| | Direct mode | Isolated mode (default for npm plugins) |
|---|---|---|
| Built by | `core/PluginContext.js` | `core/rpc/worker-bootstrap.js` |
| `ctx.client` | real discord.js `Client` (behind a deprecation Proxy) | `null` |
| `ctx.discord` | **absent** | RPC proxy: `sendToChannel`, `sendDM`, `getGuild`, `getMember`, `fetchChannel` |
| `ctx.db` | real `Database` (behind a deprecation Proxy) | RPC proxy |
| `ctx.scheduler` | real `TaskScheduler` — `schedule(name, expr, fn)` / `unschedule(name)` | RPC shim — `schedule(expr, cb, name)` → `taskId`, `cancel(taskId)` |
| `ctx.commands` | the `Collection` | `null` |
| `ctx.overrideCommand` | works | warns and does nothing |
| `ctx.hooks` | gateway-gated facade (`on`, `onAny`, `off`, `offAny`, `emitHook`) | RPC proxy; no `onAny` |
| `ctx.config` | plugin config | `{ env }` — only granted env vars |
| Event payloads | real discord.js class instances | serialized plain objects |

Anything a plugin does must work in **both** modes, or fail loudly in the mode
it does not support. See `CREATE-PLUGIN.md`.

## Plugin model: core vs. installable, isolated vs. raw

A plugin's `source` determines how it loads and whether it is gateable:

| Source | Where | Loads in | Gateable per-guild? |
|---|---|---|---|
| `core` / builtin | the internal `core` plugin | main process | No — always on |
| `local` | `plugins/*` in-repo | main process | No — always on |
| `package` (isolated) | `node_modules/adb-plugin-*` | **worker thread** | **Yes** |
| `package` + `raw-client` | declares `system: ["raw-client"]` | main process (real `client`) | No — always on, **API rejects toggling** |

**Gateable = `source === "package"` and NOT `raw-client`.** Isolated package
plugins go through the broker, so the platform can gate them. `raw-client`
plugins bypass the broker (they hold the real bot token), so a per-guild gate on
them would be unenforceable — the API returns `not_toggleable` instead of
pretending. `isGuildGateable()` is the single implementation of that rule.

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

- `GET /api/guild/:guildId/config` — `ServerConfig` plus each plugin's config,
  filtered to the plugins the caller may `view`. Gated `guild.view`.
- `GET /api/guild/:guildId/plugins` — installed plugins annotated with
  `gateable` and `enabledForGuild`.
- `PUT /api/guild/:guildId/plugins/:name/enabled` — toggle a gateable plugin for
  the guild (`400 not_toggleable` for non-gateable). Gated `plugins.manage`.
- `GET /api/guild/:guildId/permissions/catalog` — full permission catalog. Gated `roles.manage`.
- `GET /api/guild/:guildId/roles/grants` — guild roles + current grants. Gated `roles.manage`.
- `PUT|DELETE /api/guild/:guildId/roles/grants/:roleId` — set/clear a role's
  granted permissions (validated against the catalog). Gated `roles.manage`.
- Host-owner-only `/api/plugins/*`: `install`, `uninstall`, `update`,
  `update-all`, `reload/:name`, `unload/:name`, `reinstate`, `submit`,
  `marketplace`, `categories`, `registry/:packageName`, `restart`, and the
  per-plugin `brochure` / `risk-card` / `violations` reads.
- `POST /api/plugin-ui/register` (localhost-only) — a plugin tells the bot which
  port it is listening on; the bot validates the port against the plugin's
  `webUi.port` declaration and relays it to the watchdog.
- `GET /health`, `GET /api/public-stats`, `GET /diag-guilds` — unauthenticated
  health/diagnostic reads.

There is **no** `GET /api/guild/:guildId` route. The caller's resolved tier comes
from `GET /api/me`, which returns `{ user, guilds: [{ id, name, icon, tier }],
isOwner }` for every guild the caller has a tier in.

### Member portal (`/me`) — not permission-gated

Member self-service routes are guarded by `requireMembership`, not
`requireGuildAccess`: any member of the guild passes, no dashboard permission
required.

- `GET /api/me/guild/:guildId/pages` — `PluginManager.getMemberPages(guildId)`,
  which already applies the per-guild enable gate, so a page only appears when
  its plugin is enabled for that guild.
- `GET /api/me/guild/:guildId/plugins/:name/data?path=…` — for a **rendered**
  page, reads the declared plugin model and force-scopes the query to
  `{ guildId, userId }` of the caller. The client cannot widen the scope.
- `POST /api/me/guild/:guildId/plugins/:name/action` — runs an action the page
  declared in `view.actions` against one of its own rows. The client picks only
  which declared action and which returned row id, never the operation or field.

The React admin dashboard lives in `plugins/administration/web` (CRA, built to
`/dashboard`). Its Sidebar and pages are permission-filtered from the resolved
permission set; the **Access** page (`Roles.jsx`) is the role→permission editor.

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

- Discord (**discord.js v14**) — gateway, components, OAuth
- **MongoDB** (Mongoose 8) — persistence and sessions
- **Fastify 4** — dashboard API (`@fastify/cors`, `@fastify/cookie`,
  `@fastify/session`, `@fastify/static`, `connect-mongo`)
- `node-cron` — core and plugin scheduling
- `worker_threads` — plugin isolation, with `resourceLimits` per worker
- `semver` — `engines` constraint checks and registry version comparison
- `chokidar` — plugin hot-reload watching
- `axios` — registry fetches (`core/pluginRegistry.js`) and API calls
- `ws` — watchdog ↔ bot stream, and the dashboard's live install/hook feed

`express`, `express-session` and `@google/genai` are still listed in
`package.json` but **no code in this repository requires them**. The core has no
AI feature: `client.profile.features` still advertises one, and `.env.example`
still carries `GEMINI_API_KEY` and the `ENABLE_*` flags, but nothing reads them.
The capability `ai:gemini-proxy` is defined in `core/capabilities.js` and no
shipped plugin declares it.

---

## Environment variables

Read by the code, in the order they matter:

Core bot:
- `DISCORD_TOKEN` (required) — bot token; startup throws if missing or blank
- `MONGODB_URI` (required) — Mongo connection string
- `CLIENT_ID`, `GUILD_ID` (both required for `deploy-commands.js`) — the deploy
  is **guild-scoped**; a global overwrite is refused. Startup syncs each joined
  guild separately.
- `PLUGIN_ISOLATION` — `false` disables worker isolation. Not for production.

Platform / dashboard:
- `BOT_API_ENABLED` — `true` to start the Fastify API
- `BOT_API_PORT` (must be an integer 1–65535), `BOT_API_BASE_URL`
- `OWNER_IDS` — comma-separated host-owner user IDs (**the HOST_OWNER tier**)
- `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`,
  `DISCORD_OAUTH_REDIRECT_URI` — dashboard login
- `SESSION_SECRET`, `DASHBOARD_REDIRECT_URL`, `CORS_ORIGIN`
- `PLUGIN_REGISTRY_URL` — plugin marketplace source
- `INVITE_FORCE_ADMIN` — forces the invite integer to `"8"` instead of computing
  it from enabled plugins' `discordPermissions`
- `TRIAL_MODE` — `true` also schedules `core:trial-reset`
- `WATCHDOG_PORT` — **required by the watchdog process**, which exits without it

Integration-check only (see `docs/VERIFICATION.md`): `ADB_PLUGIN_WORKSPACE`,
`ADB_INTEGRATION_MONGODB_URI`. `DEBUG` is read by the logger.

`PORT` appears in `.env.example` but is not read by any Node code — the API
port is `BOT_API_PORT`.

---

## Permissions & Intents

- Gateway intents (`index.js`), 9 in total: `Guilds`, `GuildMembers`,
  `GuildMessages`, `MessageContent`, `GuildMessageReactions`, `GuildVoiceStates`,
  `GuildPresences`, `GuildInvites`, `GuildModeration`. The privileged ones —
  Message Content, Guild Members, Presences, Guild Invites — must be enabled in
  the Developer Portal.
- Partials: `Message`, `Channel`, `Reaction`, `User`, `GuildMember`.
- The **invite permission integer** is computed from enabled plugins'
  `discordPermissions` (`core/permissions.js` → `computePermissionInteger`), not
  hardcoded. Unknown flag names are non-fatal but recorded, unless
  `INVITE_FORCE_ADMIN=true` forces `"8"`.

---

## Scaling & operational notes

- Scheduler and the enable index are in-process; running multiple bot instances
  duplicates scheduled jobs and each keeps its own index — coordinate (single
  scheduler process / leader election) if you scale out.
- The watchdog is a separate process (`core/adb-watchdog.js`): it supervises the
  bot, reverse-proxies all bot traffic (`/api/*`, `/dashboard/*`, `/ws`,
  `/auth/*`, `/plugin-ui/*`) from `WATCHDOG_PORT` (default 3008) to the bot port
  (3009), and exposes `/status`, `/restart`, `/stop`, `/start`. The dashboard
  "Restart & Deploy" goes through it. `index.js` never starts it.
- RBAC resolution and the enable index both fail closed (empty index = gateable
  plugins off; DB error on grants = no permissions granted).
- Worker isolation is a contract boundary, not an OS sandbox. A worker gets only
  its granted env, but Node built-ins are still requireable inside a worker —
  what stops a plugin is that the broker denies undeclared RPC calls and
  `core/manifest-crossvalidate.js` rejects at install time a manifest whose
  source imports gated built-ins or packages it has not declared.

---

## Extending the bot

- **New user-facing feature → a plugin**, in its own repository. Not here. See
  `AGENTS.md` and `CREATE-PLUGIN.md`. The core ships no commands, so there is
  nothing to add a command *to*; the `commands/` directory that `loadCore()`
  would read does not exist in this repository.
- **New plugin:** see `CREATE-PLUGIN.md`. Declare `manifestVersion: 2`,
  `permissions`, and `discordPermissions`; optionally `settings.schema`,
  `webUi`, and `dashboard.permissions[]`.
- **Core pipeline change:** `events/` files are loaded as the internal `core`
  plugin. `interactionCreate.js` and `messageCreate.js` are the before/after
  hook pipeline — editing them changes behaviour for every plugin. Note
  `events/messageCreate.js` only runs its own XP tracking when
  `adb-plugin-levels` is not enabled for that guild, so the two do not
  double-count.
- **New DB model:** update `models/schemas.js` and expose via
  `utils/database.js`. Plugin models instead go through
  `ctx.defineModel(name, schema)`, namespaced as `plugin_<name>_<model>`.
- **New dashboard permission:** `plugin.<name>.view` and
  `plugin.<name>.configure` are derived automatically. Declare
  `dashboard.permissions[]` only for extra keys — declared keys are **added** to
  the pair, not substituted for it.

---

## Status

- **Multi-tenant RBAC** — implemented. See **Multi-tenant RBAC** above.
- **Member portal (`/me`)** — implemented end to end. The platform side is the
  `webUi.memberPages` manifest field (normalized and validated in
  `core/manifest-schema.js`), `PluginManager.getMemberPages(guildId)` (which
  applies the per-guild enable gate), the `/api/me/*` routes, and the `/me` route
  tree in the dashboard SPA. As of this commit **16 of the 17 installed plugins
  declare `memberPages`**, all of them platform-*rendered*: they declare
  `source.model` + `view`, so the platform reads the model and renders the page
  and the plugin hosts no web server (none of them set `webUi.port`).
  `adb-plugin-music` is the only installed plugin with no `memberPages`.
  Remaining work is per-plugin: a page is only as good as the model it reads.
