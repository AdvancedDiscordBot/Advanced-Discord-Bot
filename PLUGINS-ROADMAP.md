# ADB Plugin Architecture — Roadmap

> Planning document for the evolution of Advanced Discord Bot into a fully extensible, plugin-driven bot platform with a non-technical admin dashboard.

## Vision

Transform ADB from a feature-rich bot into a **platform**. A well-built plugin should be able to add commands, override existing ones, read and write the database, hook into the AI pipeline, schedule jobs, expose a dashboard, and turn ADB into something specialized without touching core code.

Non-technical server admins get a clean web dashboard to install and configure plugins. Power users get programmatic access to the bot platform.

## System Overview

| Component | What It Is | Talks To |
| --------- | ---------- | -------- |
| **Bot process** | Discord.js bot, Plugin Manager, Hook Bus, internal API | Discord, MongoDB |
| **Dashboard** | React web app for server admins | Bot internal API |
| **Plugin registry** | Registry-backed manifest of community plugins | npm/package sources, Dashboard |

The dashboard should not touch MongoDB or the Discord client directly. It should use the bot API so the bot remains the source of truth.

## Core Concepts

### PluginContext (`ctx`)

Every plugin receives a `ctx` object on load. This is the stable API surface available to plugins.

```js
const ctx = {
  client,
  db,
  scheduler,
  commands,
  registerCommand,
  overrideCommand,
  registerEvent,
  defineModel,
  hooks,
  config,
  logger,
};
```

### Hook Bus

The Hook Bus wraps core bot flows so plugins can extend behavior in priority order.

Key hooks:

```text
beforeCommand(interaction, command)  -> afterCommand(interaction, result)
beforeMessage(message)              -> afterMessage(message)
onAIPrompt(prompt, context)          -> onAIResponse(response)
onLevelUp(user, newLevel, guild)
onTicketCreate(ticket, user)
onTicketClose(ticket)
onPluginLoad(pluginName)
onPluginUnload(pluginName)
```

Hook events can also stream to the dashboard activity feed.

### Plugin Manifest (`plugin.json`)

```json
{
  "name": "adb-plugin-economy-plus",
  "version": "1.0.0",
  "description": "Expanded economy with shops, trading, and auctions.",
  "author": "yourname",
  "requiresRestart": false,
  "permissions": ["db.read", "db.write", "commands.override", "scheduler"],
  "overrides": ["daily"],
  "configSchema": {},
  "port": 50000
}
```

`requiresRestart` controls hot-reload eligibility. `permissions` are surfaced in the dashboard before install. `configSchema` lets the dashboard auto-generate a settings UI. `port` declares a plugin-owned web UI.

### Plugin Structure

```text
plugins/
  adb-plugin-economy-plus/
    plugin.json
    index.js
    commands/
    models/
```

Plugin models are namespaced as `plugin_<pluginName>_<modelName>` to avoid collisions.

### Plugin Distribution

- **Drop-in folder** - place a plugin folder in `plugins/`.
- **Package install** - install an `adb-plugin-*` package and let Plugin Manager discover it.

The Plugin Manager should scan both `plugins/` and supported package locations.

## Hot Reload Policy

| Plugin type | Behavior |
| ----------- | -------- |
| No new slash commands and no restart flag | Hot-reloads instantly |
| Adds/modifies slash commands or `requiresRestart: true` | Loads on next restart or command deploy cycle |

Command logic can hot-reload. Discord slash command registration still requires a deploy step.

## Phase 1 — Plugin Manager + Hook Bus

- `core/PluginManager.js` scans plugin folders and packages.
- Load manifests and call `plugin.load(ctx)`.
- Resolve load order through dependencies.
- Isolate plugin errors so one bad plugin does not crash the bot.
- Watch files for hot-reloadable plugins.
- `core/HookBus.js` wraps interaction and message flows.
- `core/PluginContext.js` builds the plugin API object.
- Support `registerCommand`, `overrideCommand`, and `defineModel`.
- Store per-guild plugin settings in `PluginConfig`.

**Milestone:** A plugin can override `/daily`, add a command, hook level-up events, and define its own model.

## Phase 2 — Internal Bot API

- Fastify/Express server inside the bot process.
- Discord OAuth middleware and guild admin checks.
- Plugin endpoints:
  - `GET /api/plugins`
  - `POST /api/plugins/install`
  - `POST /api/plugins/unload/:name`
  - `POST /api/plugins/reload/:name`
- Guild endpoints:
  - `GET /api/guild/:guildId/config`
  - `PUT /api/guild/:guildId/config`
  - `GET /api/guild/:guildId/stats`
- WebSocket stream for hook events, logs, and install progress.

**Milestone:** The API can install and reload a plugin while streaming progress.

## Phase 3 — Admin Dashboard

- React dashboard process.
- Discord OAuth login.
- Guild picker for servers where the user has admin permissions.
- Plugin management UI.
- Install from registry, package name, or local folder.
- Restart-required state.
- Live install logs.
- Guild settings pages for core modules.
- Activity feed backed by the WebSocket stream.

**Milestone:** A server admin can configure ADB and manage plugins without touching files.

## Phase 4 — Plugin Registry Marketplace

- Registry repository containing a curated JSON manifest.
- Each entry includes package name, display name, description, author, version, permissions, verification state, and restart requirement.
- Dashboard marketplace tab with filters.
- Permission summary before install.
- Verified badge for reviewed plugins.
- Community submission process through registry PRs.

**Milestone:** An admin installs a marketplace plugin from the browser and sees it become available.

## Phase 5 — Auto-Generated Plugin Settings UI

- Plugins declare `configSchema` using JSON Schema.
- Dashboard renders controls based on field types:
  - `string` -> text input
  - `boolean` -> toggle
  - `number` -> number input
  - `enum` -> dropdown
  - `array` -> tag/list input
- Settings save through the guild config API.
- Plugins read settings through plugin config helpers.

**Milestone:** Plugin authors get working settings screens by adding schema to `plugin.json`.

## Architectural Decisions

**Discord OAuth from day one.** Dashboard and API endpoints should ship with auth and guild admin checks.

**Dashboard is an API client.** It should not bypass the same API a CLI or integration would use.

**PluginConfig is separate from ServerConfig.** Core config lives in `ServerConfig`; plugin data lives in `PluginConfig`.

**Hook Bus events stream to WebSocket.** Plugin activity becomes visible without custom dashboard code.

**Plugin models are namespaced.** Plugins should not collide with core schemas or each other.

## What A Fully Capable Plugin Can Do

- Add slash commands
- Override existing commands
- Hook into AI flows
- Register MongoDB models
- Read and write plugin config
- Schedule cron jobs
- Add Discord event listeners
- Expose a web dashboard
- Integrate with marketplace metadata

## Current Direction

ADB should remain useful out of the box, but the long-term center of gravity is the plugin ecosystem. Core should provide trusted primitives; plugins should provide breadth.
