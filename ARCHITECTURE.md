# Architecture

This file summarizes the runtime architecture and data model of ADB (Advanced
Discord Bot) as implemented in the repository. It is derived directly from the
code (`index.js`, `core/`, `utils/`, `models/`, `deploy-commands.js`,
`.env.example`).

ADB is not a monolithic feature bot. Core is a **lean plugin platform**: it
ships **no user-facing slash commands of its own**. All features come from
`adb-plugin-*` packages (npm) and local plugins in `plugins/`, which are
auto-discovered at startup and — by default — run sandboxed in worker threads,
reaching Discord and the database only through a capability-gated RPC broker.
An optional Fastify API serves a React admin dashboard and a plugin marketplace.

## High-level components

- `index.js` — startup path
  - Builds the discord.js `Client` with the intents/partials below.
  - Initializes the `Database` singleton (`utils/database.js`).
  - Creates a `TaskScheduler` (`utils/scheduler.js`), a `HookBus`
    (`core/HookBus.js`), and a `PluginManager` (`core/PluginManager.js`).
  - Enables plugin isolation unless `PLUGIN_ISOLATION=false`.
  - Optionally starts the Fastify API (`core/api/server.js`) when
    `BOT_API_ENABLED=true`.
  - Calls `pluginManager.loadAll()`, then logs in with `DISCORD_TOKEN`.
  - Rotates presence, and installs global `unhandledRejection` /
    `uncaughtException` / `SIGINT` handlers.
- `PluginManager` (`core/PluginManager.js`) — the heart of the platform.
  - Discovers, loads, isolates, hot-reloads, and unloads plugins.
  - Owns `client.commands` (the command registry the interaction router reads).
- `HookBus` (`core/HookBus.js`) — priority-ordered async event bus for
  inter-plugin and lifecycle hooks (`onPluginLoad`, `onPluginUnload`, plus any
  plugin-defined hooks). Handlers can mutate or `cancel` a payload; `onAny` is
  used by the API to stream events to the dashboard.
- Capability RPC layer (`core/rpc/`) — broker, worker manager, protocol, and
  the worker bootstrap that isolated plugins run inside.
- API + dashboard (`core/api/`, `core/adminPlugin.js`) — Fastify server with
  Discord OAuth, plugin management endpoints, and the React admin UI.
- Watchdog (`core/adb-watchdog.js`, `adb-watchdog.sh`) — independent process
  manager and reverse proxy that survives bot restarts.
- Data layer (`utils/database.js`, `models/schemas.js`) — mongoose models and
  a `Database` singleton with helper methods.
- Legacy core runtime (`events/`, `utils/scheduler.js`) — a residual set of
  built-in event handlers and cron jobs still loaded by core (see below). These
  predate the plugin split and are not the extension surface.

## The "core" plugin (legacy runtime)

`PluginManager.loadCore()` registers a synthetic `builtin` plugin named `core`
and loads:

- Commands from `commands/` — **this directory does not exist in the repo, so
  core contributes zero slash commands.**
- Events from `events/` (excluding `helpInteraction.js` and `modalCreate.js`):
  `guildCreate`, `guildMemberAdd`, `interactionCreate`, `messageCreate`,
  `ready`, `voiceStateUpdate`.

The most important of these is `events/interactionCreate.js` — the **slash
command router**. It looks up `interaction.client.commands.get(commandName)`,
enforces per-command cooldowns (`command.cooldown`, default applied by the
handler), and calls the command's `execute`. Plugins are what populate
`client.commands`; core just routes to them. The other legacy events
(`messageCreate` XP, `guildMemberAdd` birthday/welcome, `voiceStateUpdate` voice
tracking) still run against the legacy models and scheduler.

## Plugin lifecycle

### Discovery (`PluginManager.discoverPlugins`)

Two sources are scanned:

- **Local plugins:** every subdirectory of `plugins/` that contains a
  `plugin.json`. Tagged `source: "local"`. (The repo ships one:
  `plugins/administration`, the dashboard plugin.)
- **npm plugins:** every `node_modules/` entry whose name starts with
  `adb-plugin-`, including scoped packages `@scope/adb-plugin-*`, that contains
  a `plugin.json`. Tagged `source: "package"`.

Discovered plugins are topologically sorted by their manifest `dependsOn` /
`dependencies` (`sortByDependencies`); missing deps disable the plugin, circular
deps throw.

### Manifest (`plugin.json`)

Read verbatim as JSON. Fields the code consults include: `name`, `version`,
`main` (entry, default `index.js`), `displayName`, `description`, `author`,
`category`, `requiresRestart`, `dependsOn`/`dependencies`, `discordPermissions`
(validated against `core/permissions.js`), `capabilities` (see below), and a v2
`permissions` block normalized by `core/manifest-schema.js` (used to derive the
`network.outbound` host allowlist).

### Load contract

A plugin's entry module must export a `load(ctx)` function (or a default/
callable export). `PluginManager` resolves it as
`pluginModule.load || pluginModule.default || pluginModule` and calls it with a
context object. What `ctx` contains depends on the load **mode**.

### Isolated vs. direct mode (`loadPlugin`)

The mode is decided per plugin, not opt-in by the plugin:

- **Isolated (default for npm plugins):** `source === "package"` plugins run in
  a `worker_threads` Worker via `core/rpc/worker-bootstrap.js`. This is
  enforced — an installed third-party plugin cannot escape the sandbox by
  omitting a flag.
- **Direct (main process):** `builtin` core and `source: "local"` plugins always
  load directly through `core/PluginContext.js`.
- **Escape hatch:** a `package` plugin that declares the `system:raw-client`
  capability loads **direct/un-isolated** with full access. This is owner-
  approved at install time via the risk disclosure and logged as a warning.
- Setting `PLUGIN_ISOLATION=false` forces everything to direct mode (not
  recommended in production).

After load, hot-reload is wired for eligible plugins (`chokidar` watches the
plugin directory; not eligible if `requiresRestart` or the plugin registered
commands). Core is never hot-reloaded.

## The `ctx` object — differs by mode

This is the single most important correctness point: **isolated and direct
plugins receive different context objects.** Code that works in one mode is not
guaranteed to work in the other.

### Direct mode (`core/PluginContext.js`)

The context is frozen (read-only except `ctx.models`) and exposes:

- `ctx.client` — the **real** discord.js `Client` (wrapped in a deprecation-
  warning Proxy).
- `ctx.db` — the real `Database` singleton (also deprecation-wrapped).
- `ctx.scheduler` — the real `TaskScheduler`.
- `ctx.commands` — `client.commands`.
- `ctx.registerCommand`, `ctx.overrideCommand`, `ctx.registerEvent`,
  `ctx.defineModel`, `ctx.models`, `ctx.hooks`, `ctx.config`, `ctx.logger`.
- **There is no `ctx.discord`** — direct plugins use the real `ctx.client`.

### Isolated mode (`core/rpc/worker-bootstrap.js` → `createShimContext`)

Every resource is a shim that routes through RPC to the broker:

- `ctx.client` — **`null`.** The worker never touches a real client.
- `ctx.discord` — a Discord shim with **exactly five convenience methods**:
  `sendToChannel(channelId, payload)`, `sendDM(userId, payload)`,
  `getGuild(guildId)`, `getMember(guildId, userId)`, `fetchChannel(channelId)`.
- `ctx.db` — a Proxy that only allows a fixed set of methods (config, profile,
  XP, points, ticket, server-config helpers); anything else throws
  "not available in isolated mode".
- `ctx.scheduler`, `ctx.registerCommand`, `ctx.registerEvent`,
  `ctx.defineModel` (returns an RPC-backed model proxy), `ctx.hooks`,
  `ctx.config` (with `env`), `ctx.logger`.
- `ctx.commands` — `null`; `ctx.overrideCommand` warns that it is unsupported.

Discord events are serialized in Core (`_serializeDiscordEvent`) and broadcast
to workers; a subset is forwarded (`guildMemberAdd`, `messageCreate`,
`interactionCreate`, `voiceStateUpdate`, etc.). Isolated command handlers run in
the worker and reply via a proxied interaction that routes `reply`/`followUp`
back over RPC.

### Scheduler signature also differs by mode

- **Direct** (`utils/scheduler.js`): `schedule(name, cronExpression, fn)` —
  **name first** — and `unschedule(name)`.
- **Isolated** (worker shim): `schedule(expression, callback, name)` —
  **expression first, name last** — and `cancel(taskId)`. The worker subscribes
  to `cron:tick` events emitted by the broker.

## Capabilities and the RPC broker

Isolated plugins reach real resources only through the `CapabilityBroker`
(`core/rpc/broker.js`), which is the sole path to the DB, Discord, scheduler,
hooks, network, and AI. Every RPC call is checked against the plugin's declared
capabilities before it executes; denials and blocked hosts are tracked and can
auto-suspend a plugin.

Capabilities are declared in the manifest as `category: [values]` and referenced
as `"category:value"` strings (`core/capabilities.js`):

- `discord` — API actions (`SendMessages`, `EmbedLinks`, `ManageRoles`,
  `BanMembers`, `ModerateMembers`, `GuildInfo`, …).
- `storage` — `own-collection`, `read-profiles`, `write-profiles` (plugins never
  get raw Mongo).
- `network` — `outbound-http`.
- `ai` — `gemini-proxy` (keys stay in Core).
- `hooks` — `subscribe`, `emit`.
- `scheduler` — `cron`.
- `system` — `env`, `bot-token`, `raw-client` — elevated host access that
  reduces or removes the sandbox; owner-approved. `PluginManager.grantedEnv`
  turns these into the `process.env` slice a plugin's `ctx.config.env` sees
  (`raw-client` → full env; `env` → env minus infra secrets; `bot-token` → adds
  `DISCORD_TOKEN`; none → `{}`).

`core/rpc/methods.js` defines the full capability-gated RPC surface (many more
`discord.*`, `db.*`, `model.*`, `hooks.*`, `scheduler.*` methods than the five
convenience helpers on `ctx.discord`).

## Registry / marketplace (`core/pluginRegistry.js`)

A singleton `PluginRegistry` fetches `plugins.json` over HTTP:

- URL comes from `PLUGIN_REGISTRY_URL`, falling back to `FALLBACK_REGISTRY_URL`
  (`https://github.com/AdvancedDiscordBot/registry/blob/main/plugins.json`).
- `normalizeRegistryUrl` rewrites GitHub `blob`/`raw` URLs to
  `raw.githubusercontent.com` so axios receives JSON, not an HTML page.
- Responses are cached in `data/plugin-registry.json` for 30 minutes; on failure
  it falls back to that cache. There is no hardcoded plugin list.
- `getCategories()` returns exactly five: **features, moderation,
  entertainment, utility, analytics**.
- Also supports search, plugin-detail lookup, `isNewer` version comparison, and
  a submissions queue (`data/plugin-submissions.json`).

## Command deployment

`npm run deploy` = `node scripts/build-plugins.js && node deploy-commands.js`.

- `scripts/build-plugins.js` — finds `plugins/*/web` directories that have a
  `package.json` with a `build` script and runs `npm install && npm run build`
  in each (builds plugin front-ends, e.g. the administration dashboard).
- `deploy-commands.js` — collects `SlashCommandBuilder` JSON via
  `command.data.toJSON()` from `commands/` (absent) and from each
  `plugins/*/commands/` directory, then registers them with Discord's REST API
  (guild-scoped when `GUILD_ID` is set, else global), with timeout + rate-limit
  retry handling.

Plugins own their commands. At runtime, plugin `load(ctx)` calls
`ctx.registerCommand(...)`, which places the command in `client.commands` so the
core interaction router can dispatch it (isolated plugins register via RPC and
execute through a worker proxy).

## Dashboard / API layer (`core/api/server.js`, `core/adminPlugin.js`)

Started only when `BOT_API_ENABLED=true`. Fastify with `@fastify/cookie`,
`@fastify/session` (MongoDB-backed via `connect-mongo`), `@fastify/cors`, and a
CSP header. Highlights:

- **Auth:** Discord OAuth (`identify guilds`). `/auth/discord` →
  `/auth/discord/callback` stores the user plus the guilds where they have
  Manage-Guild/Admin. `OWNER_IDS` grants global access.
- **Access control:** `/api/*` requires a session; plugin-management actions
  require owner; guild config/stats require admin access to that guild.
- **Plugin management:** list, install/uninstall/update (npm, restricted to
  `adb-plugin-*` names by regex), reload, unload, marketplace search,
  categories, permissions integer, brochures, and per-plugin/registry **risk
  cards** (`core/risk-disclosure.js`) plus runtime **violations** and
  reinstatement.
- **Config/stats:** per-guild server config, per-plugin config (stored in the
  `PluginConfig` model), and aggregate stats.
- **Restart:** `/api/plugins/restart` delegates to the watchdog over HTTP rather
  than killing itself.
- **Dashboard:** `core/adminPlugin.js` serves the built React app from
  `plugins/administration/web/build` under `/dashboard/` and adds `/api/guilds`,
  `/api/guild/:id`, and leaderboard endpoints. Live job/hook events are pushed to
  the watchdog, which owns the WebSocket so it survives restarts.

## Watchdog (`core/adb-watchdog.js`)

An independent Node process (managed by `adb-watchdog.sh`) that runs the bot as
a child, proxies all bot traffic (`/api/*`, `/dashboard/*`, `/ws`, `/auth/*`),
and stays alive across bot restarts/crashes so the upstream tunnel never drops.
It listens on `WATCHDOG_PORT` and forwards to the bot on `BOT_API_PORT`, handles
deploy-and-restart requests, and hosts the dashboard WebSocket.

## Data models (`models/schemas.js`, `utils/database.js`)

Mongoose is used throughout. The `Database` singleton connects lazily
(`getInstance` / `ensureConnection`) using `MONGODB_URI` and exposes both model
references and helper methods.

Core-level models that still exist (mostly legacy, used by the built-in
scheduler/events and exposed selectively to plugins via `db.*` RPC):

- `ServerConfig` — per-guild config (AI, ticket, XP/role, birthday settings).
- `UserProfile` — per-user-per-guild profile (economy, XP/level, points,
  activity, current roles, streaks).
- `Ticket`, `AIRateLimit`, `XPTransaction`, `Leaderboard`, `Birthday`,
  `TruthOrDareConfig`, `AntiRaid`, `GuildEconomy`, `ShopItem` — specialized
  legacy schemas.
- `PluginConfig` — the per-guild plugin settings store (`{ guildId, pluginName,
  data }`), unique on `(guildId, pluginName)`. This is the current, plugin-era
  model.

New plugins do **not** add fields to these. Isolated plugins define their own
schemas via `ctx.defineModel(name, schema)`, which are **namespaced** as
`plugin_<pluginName>_<modelName>` (`PluginContext.defineModel`) so plugins can't
collide with each other or with core models. In isolated mode the returned model
is an RPC proxy (`find`, `findOne`, `create`, `updateOne`, `deleteOne`,
`countDocuments`, `save`).

## Background scheduler (`utils/scheduler.js`)

`TaskScheduler` (node-cron) still runs a set of **legacy** in-process jobs:
daily reset (midnight UTC), weekly reset (Mon midnight UTC), hourly leaderboard
update, role checks every 30 min, birthday check daily 08:00 UTC, and — only
when `TRIAL_MODE=true` — a destructive "trial reset" every 5 hours (leaves
guilds, drops the DB, `git pull`, `npm install`, `npm run deploy`, restart).

On top of that it exposes the generic direct-mode plugin API
`schedule(name, cronExpression, fn)` / `unschedule(name)` described above.

## External integrations

- Discord (discord.js v14) — gateway, interactions, components.
- MongoDB (mongoose v8) — persistence and session store.
- Google Gemini via `@google/genai` — AI, proxied through Core so keys never
  reach plugins (`GEMINI_API_KEY`).
- node-cron — scheduling; chokidar — hot reload; axios — registry/OAuth HTTP;
  ws — dashboard WebSocket; acorn / acorn-walk — manifest static analysis
  (`core/manifest-crossvalidate.js`).

## Environment variables

From `.env.example` (authoritative):

- `DISCORD_TOKEN` (required) — bot token.
- `CLIENT_ID` (required for `deploy-commands.js`) — application id.
- `GUILD_ID` (optional) — guild-scoped command deployment when set.
- `MONGODB_URI` (required) — MongoDB connection string.
- `GEMINI_API_KEY` (optional) — Gemini key.
- `BOT_API_ENABLED`, `BOT_API_PORT`, `BOT_API_BASE_URL` — the Fastify API.
- `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`,
  `DISCORD_OAUTH_REDIRECT_URI`, `SESSION_SECRET`, `DASHBOARD_REDIRECT_URL`,
  `OWNER_IDS` — dashboard auth.
- `NODE_ENV`, `PORT`, `WATCHDOG_PORT` — deployment/health/watchdog.
- `ENABLE_AI_ASSISTANT`, `ENABLE_POINTS_SYSTEM`, `ENABLE_XP_SYSTEM`,
  `ENABLE_TICKET_SYSTEM`, `ENABLE_MODERATION` — legacy feature toggles.
- `PLUGIN_REGISTRY_URL` — marketplace registry (empty → fallback URL).

Additional variables read by code but not in `.env.example`:
`PLUGIN_ISOLATION` (`index.js`), `CORS_ORIGIN` and `INVITE_FORCE_ADMIN`
(`core/api/server.js`), `TRIAL_MODE` (`utils/scheduler.js`), `DEBUG`
(worker logging).

## Permissions & Intents

- Intents (`index.js`): `Guilds`, `GuildMembers`, `GuildMessages`,
  `MessageContent`, `GuildMessageReactions`, `GuildVoiceStates`,
  `GuildPresences`. Partials: `Message`, `Channel`, `Reaction`, `User`,
  `GuildMember`.
- Privileged intents (Message Content, Guild Members, Presences) must be enabled
  in the Discord Developer Portal.
- The bot's required Discord permissions are **computed from installed plugins'**
  declared `discordPermissions` (`core/permissions.js`,
  `/auth/invite`), not hardcoded — each plugin declares what it needs.

## Scaling & operational notes

- The legacy `TaskScheduler` and forwarded Discord events run in-process;
  running multiple bot instances would duplicate scheduled jobs and event
  handling unless coordinated.
- The `Database` singleton keeps one connection pool per process.
- Isolated plugins run in worker threads with resource limits
  (`core/rpc/resource-limits.js`); a misbehaving plugin can be suspended without
  taking down Core.
- The watchdog is the intended front door in production so restarts/deploys
  don't drop the tunnel or the dashboard WebSocket.

## Extending the bot

Do **not** add files to `commands/` or `events/` — that is the legacy core
runtime, not the extension surface. To add a feature, **build a plugin**:

1. Create a `plugin.json` manifest (name, `main`, `capabilities`, any
   `discordPermissions`/`dependsOn`).
2. Export a `load(ctx)` function from the entry file and use `ctx` (respecting
   the mode differences above) to `registerCommand` / `registerEvent`,
   `defineModel`, schedule tasks, and subscribe to hooks.
3. Place it in `plugins/<name>/` (local, direct mode) or publish it as an
   `adb-plugin-*` npm package (isolated by default).

See `CREATE-PLUGIN.md` for the full plugin authoring guide and
`REGISTRY-SETUP.md` for hosting a marketplace registry.
