# ADB Plugin Platform — Status

> **Status: all five phases below shipped.** This file started as a forward-looking
> roadmap and is kept as the record of *what was decided and why*. The manifest
> example, hook list and settings field types have been corrected to match the
> code as it now stands; for the current API read `CREATE-PLUGIN.md` and
> `ARCHITECTURE.md`, and for the design history read
> `docs/superpowers/`.

## Vision

Transform ADB from a feature-rich bot into a **platform**. A well-built plugin
should be able to add commands, override existing ones, read and write the
database, hook into the AI pipeline, schedule jobs, expose a dashboard, and turn
ADB into something specialized without touching core code.

Non-technical server admins get a clean web dashboard to install and configure
plugins. Power users get programmatic access to the bot platform.

Two things landed after this document was written and are not reflected in the
phases below: **process isolation** (every npm plugin runs in a worker thread
behind a capability broker — see `docs/superpowers/plans/2026-07-16-plugin-isolation-architecture.md`)
and **per-guild enablement with live RBAC** (installed plugins are off per guild
until an admin turns them on; access resolves per request from the member cache).
The "hook into the AI pipeline" goal was **not** delivered: the core has no AI
feature and no `onAIPrompt`/`onAIResponse` hook exists.

## System Overview

| Component | What It Is | Talks To |
| --------- | ---------- | -------- |
| **Bot process** | Discord.js bot, Plugin Manager, Hook Bus, Fastify API | Discord, MongoDB |
| **Dashboard** | React web app for server admins | Bot API |
| **Plugin registry** | Registry-backed manifest of community plugins | npm, Dashboard |
| **Watchdog** | Separate supervisor + reverse proxy | Bot process |

The dashboard does not touch MongoDB or the Discord client directly. It uses the
bot API so the bot remains the source of truth.

## Core Concepts

### PluginContext (`ctx`)

Every plugin receives a `ctx` object on load. This is the stable API surface
available to plugins. In isolated mode the object is built by
`core/rpc/worker-bootstrap.js` instead, and differs in several places — see the
**Two contexts** table in `ARCHITECTURE.md`.

```js
const ctx = {
  client,              // real Client in direct mode, null when isolated
  discord,             // isolated mode only — the RPC Discord surface
  db,
  scheduler,
  commands,
  registerCommand,
  overrideCommand,
  registerEvent,
  defineModel,
  models,
  hooks,
  config,
  logger,
};
```

### Hook Bus

The Hook Bus wraps core bot flows so plugins can extend behavior in priority
order. A `before*` hook can cancel or replace the payload; the `after*` hooks
observe the result. These are the hooks Core actually emits today:

```text
beforeCommand(interaction, command)  -> afterCommand(interaction, command, result)
beforeMessage(message)                -> afterMessage(message)
onLevelUp(user, newLevel, guild)
onTicketClose(ticket, id)
onPluginLoad(pluginName)              -> onPluginUnload(pluginName, reason)
onInteraction(interaction)
```

There is no hook registry — a plugin may emit any name it likes via
`ctx.hooks.emitHook()`, and other plugins subscribe with `ctx.hooks.on(name, …)`.

### Plugin Manifest (`plugin.json`)

Current shape is **manifest v2** (`manifestVersion: 2`). The v1 shape this file
originally showed — a flat `permissions: ["db.read", …]` array and a top-level
`port` — is still accepted and migrated, but should not be authored.

```json
{
  "name": "adb-plugin-economy-plus",
  "version": "1.0.0",
  "description": "Expanded economy with shops, trading, and auctions.",
  "author": "yourname",
  "main": "index.js",
  "requiresRestart": false,
  "manifestVersion": 2,
  "process": { "model": "pooled", "maxExecutionMs": 5000, "memoryMb": 128 },
  "engines": { "core": ">=2.0.0" },
  "permissions": {
    "discord": ["SendMessages", "EmbedLinks"],
    "storage": ["own-collection", "read-profiles", "write-profiles"],
    "hooks": ["subscribe"],
    "network": { "outbound": [] },
    "filesystem": { "read": [], "write": [] },
    "childProcess": false,
    "nativeAddons": false
  },
  "discordPermissions": ["SendMessages", "EmbedLinks"],
  "settings": { "commandPermissions": true, "schema": [] },
  "configSchema": {}
}
```

- `requiresRestart` controls hot-reload eligibility.
- `permissions` is the v2 block the broker enforces per RPC call. `network.outbound`
  is a host **allowlist**, not a boolean — an empty list means no outbound.
- `discordPermissions` is separate: Discord permission **flag names** used to
  compute the invite integer. Unknown names are non-fatal but recorded.
- `settings.schema` is what the dashboard renders.
- A plugin-hosted web UI is `webUi: { port, label, icon }`, and `port` must be
  3100–4999. There is no top-level `port` any more.

### Plugin Structure

A plugin is **its own repository** named `adb-plugin-<name>`, published to npm
under the same name:

```text
adb-plugin-economy-plus/
  plugin.json
  index.js
  commands/
  models/     (or ctx.defineModel() from index.js)
  test/
```

Plugins are **not** added to this repository's `plugins/` directory — that holds
only `administration`, the dashboard host. Plugin models are namespaced as
`plugin_<pluginName>_<modelName>` to avoid collisions.

### Plugin Distribution

- **Package install** — the real path. `npm install adb-plugin-<name>`, or
  install from the dashboard marketplace. `PluginManager` discovers
  `node_modules/adb-plugin-*`.
- **Drop-in folder** — a directory in `plugins/` loads with `source: "local"`,
  in the main process and never isolated. Useful for development; not how
  plugins ship.

## Hot Reload Policy

| Plugin type | Behavior |
| ----------- | -------- |
| No new slash commands and no restart flag | Hot-reloads instantly |
| Adds/modifies slash commands or `requiresRestart: true` | Loads on next restart or command deploy cycle |

Command logic can hot-reload. Discord slash command registration still requires
a deploy step.

## Phase 1 — Plugin Manager + Hook Bus ✅

- `core/PluginManager.js` scans plugin folders and packages.
- Load manifests and call `plugin.load(ctx)`.
- Resolve load order through dependencies (topological, cycles rejected).
- Isolate plugin errors so one bad plugin does not crash the bot.
- Watch files for hot-reloadable plugins (chokidar).
- `core/HookBus.js` wraps interaction and message flows.
- `core/PluginContext.js` builds the plugin API object.
- Support `registerCommand`, `overrideCommand`, and `defineModel`.
- Store per-guild plugin settings in `PluginConfig`.

**Milestone:** A plugin can override `/daily`, add a command, hook level-up
events, and define its own model.

## Phase 2 — Internal Bot API ✅

- Fastify server inside the bot process.
- Discord OAuth middleware and live guild access resolution.
- Plugin endpoints: install, uninstall, update, update-all, load, unload,
  reload, reinstate, submit, marketplace, categories, restart, plus per-plugin
  brochure / risk-card / violations.
- Guild endpoints: config, stats, server-stats, plugins, commands, settings,
  permissions catalog, role grants.
- WebSocket stream for logs and install progress.

**Milestone:** The API can install and reload a plugin while streaming progress.

## Phase 3 — Admin Dashboard ✅

- React dashboard served from `plugins/administration/web`, mounted at `/dashboard`.
- Discord OAuth login.
- Guild picker for servers where the user has a tier.
- Plugin management UI, marketplace install, restart-required state, live logs.
- Guild settings pages.
- `⌘K` / `Ctrl+K` command palette.
- Widget-grid home page backed by `/api/guild/:id/server-stats`.

Feature-specific settings pages (AI, XP, Economy, Tickets, Birthdays,
AntiRaid, ActivityLogs) and the `plugins/ai/` and `plugins/economy/` directories
were deleted; their functionality now lives in plugins or not at all.

**Milestone:** A server admin can configure ADB and manage plugins without
touching files.

## Phase 4 — Plugin Registry Marketplace ✅

- Registry repository with a curated `plugins.json` manifest.
- Each entry carries package name, display name, description, author, version,
  permissions, verification state and restart requirement.
- Dashboard marketplace with filters and a permission summary before install.
- Verified badge for reviewed plugins.
- Submission via registry PRs; the bot caches the registry and shows a
  risk-card diff on version change.

**Milestone:** An admin installs a marketplace plugin from the browser and sees it
become available.

## Phase 5 — Auto-Generated Plugin Settings UI ✅

- Plugins declare `settings.schema`; the dashboard renders controls by field
  type. The six supported types are `string`, `number`, `boolean`, `channel`,
  `role` and `select` — the `enum` and `array` types in the original plan were
  never implemented.
- `settings.commandPermissions: true` adds a per-command enable/role table.
- Fields marked `secret` / `writeOnly` / `format: "password"` are stripped from
  API responses and reported only as configured / not configured.
- Settings save through the guild config API; plugins read them through
  `ctx.db.getPluginConfig(guildId, name)`.

**Milestone:** Plugin authors get working settings screens by adding a schema to
`plugin.json`.

## Architectural Decisions

**Discord OAuth from day one.** Dashboard and API endpoints ship with auth and
live guild access checks.

**Dashboard is an API client.** It does not bypass the same API a CLI or
integration would use.

**PluginConfig is separate from ServerConfig.** Core config lives in
`ServerConfig`; plugin data lives in `PluginConfig`.

**Plugin models are namespaced.** Plugins do not collide with core schemas or
each other.

**Capability enforcement over declaration.** Manifest v2 made `discordPermissions`
declarative only, on the understanding that real enforcement was a separate
concern. That concern was later built: `core/capabilities.js` +
`core/rpc/broker.js` gate every privileged RPC call, and
`core/manifest-crossvalidate.js` rejects a manifest whose source reaches for more
than it declares.

## What a Plugin Can Do

- Add slash commands
- Override existing commands *(direct mode only — `ctx.overrideCommand` warns
  and does nothing in an isolated worker)*
- Register its own Mongoose models, namespaced
- Read and write its own per-guild config
- Subscribe to and emit hooks
- Schedule cron jobs
- Add Discord event listeners
- Serve a member portal page — either platform-rendered from one of your models,
  or from a web server you host
- Expose a hosted web UI, and appear in the marketplace

Not available: hooking an AI pipeline. The core ships no AI feature and declares
no `onAIPrompt` / `onAIResponse` hook.

## Where Things Stand

The platform is built. What remains is per-plugin work: declaring
`webUi.memberPages` against a real model, and tightening the member portal's
rendered views. See the **Status** section of `ARCHITECTURE.md` for the current
count.

