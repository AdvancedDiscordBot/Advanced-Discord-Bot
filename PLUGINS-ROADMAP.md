# VAISH Plugin Architecture — Roadmap

> Planning document for the refactor of VAISH into a fully extensible, plugin-driven bot platform with a non-technical admin dashboard.

---

## Vision

Transform VAISH from a feature-rich bot into a **platform**. A well-built plugin should be able to add commands, override existing ones, read and write the database, hook into the AI pipeline, schedule jobs, and effectively turn VAISH into something completely different — all without touching core code.

Non-technical server admins get a clean web dashboard to install and configure plugins point-and-click. Power users get full programmatic access to everything.

---

## System Overview

Three separate concerns, deployed independently:

| Component           | What it is                                                | Talks to                |
| ------------------- | --------------------------------------------------------- | ----------------------- |
| **Bot process**     | Discord.js bot + Plugin Manager + Hook Bus + internal API | Discord, MongoDB        |
| **Dashboard**       | React web app for server admins                           | Bot's internal API only |
| **Plugin registry** | npm-backed manifest of community plugins                  | npm, Dashboard          |

The dashboard never touches MongoDB or the Discord client directly. Everything goes through the bot's API. This means the dashboard going down never affects the bot, and both can be deployed and scaled independently.

---

## Core Concepts

### PluginContext (`ctx`)

Every plugin receives a single `ctx` object on load. This is the entire API surface available to plugins — stable, versioned, and won't break plugins when internals are refactored.

```js
const ctx = {
	client, // raw discord.js Client — full power
	db, // Database singleton — full power
	scheduler, // TaskScheduler — register cron jobs
	commands, // Map of all loaded commands
	registerCommand, // register a new slash command dynamically
	overrideCommand, // wrap or replace an existing command's execute()
	registerEvent, // add new Discord event listeners
	defineModel, // register new Mongoose schemas (namespaced)
	hooks, // Hook Bus — intercept bot lifecycle events
	config, // bot env config (read-only)
	logger, // structured logger (namespaced to plugin)
};
```

### Hook Bus

An async EventEmitter that wraps core bot flows. Plugins subscribe to hooks to intercept, modify, or extend existing behaviour. Hooks fire in priority order and support async/await.

Key hooks (non-exhaustive):

```
beforeCommand(interaction, command)  →  afterCommand(interaction, result)
beforeMessage(message)               →  afterMessage(message)
onAIPrompt(prompt, context)          →  onAIResponse(response)
onLevelUp(user, newLevel, guild)
onTicketCreate(ticket, user)
onTicketClose(ticket)
onPluginLoad(pluginName)
onPluginUnload(pluginName)
```

Hook events also stream automatically to the dashboard's WebSocket activity feed — plugin authors get dashboard visibility for free.

### Plugin Manifest (`plugin.json`)

Every plugin declares itself upfront:

```json
{
	"name": "economy-plus",
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

`requiresRestart` controls hot-reload eligibility. `permissions` are surfaced in the dashboard before install — not enforced (full trust), but transparent. `configSchema` (JSON Schema) lets the dashboard auto-generate a settings UI for the plugin with zero extra dashboard code.

`port` (optional) — declares the port requirement for plugins that expose web interfaces. The plugin is responsible for starting its own web server on this port.

### Plugin Structure

```
plugins/
  economy-plus/
    plugin.json       ← manifest
    index.js          ← exports load(ctx)
    commands/         ← optional new slash commands
    models/           ← optional Mongoose schemas (auto-namespaced)
```

Plugin models are namespaced as `plugin_<pluginName>_<modelName>` automatically to avoid collisions with core schemas.

### Plugin Distribution

Both methods supported simultaneously:

- **Drop-in folder** — place plugin folder in `plugins/`. Simple, beginner-friendly, good for private/internal plugins.
- **npm package** — `npm install vaish-plugin-economy`. Enables versioning, dependency management, and dashboard one-click install. Plugin Manager scans both `plugins/` and `node_modules/vaish-plugin-*`.

---

## Hot Reload Policy

| Plugin type                                             | Behaviour                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| No new slash commands, no restart flag                  | Hot-reloads instantly — logic live immediately                       |
| Adds/modifies slash commands OR `requiresRestart: true` | Loads on next restart; dashboard shows "active after restart" banner |

Command _logic_ always hot-reloads. Command _registration_ (what Discord's UI shows) requires an explicit deploy step due to Discord API rate limits.

---

## Phase 1 — Plugin Manager + Hook Bus

**Goal:** The platform foundation. No dashboard yet.

- `core/PluginManager.js` — scans `plugins/` and `node_modules/vaish-plugin-*`, reads manifests, calls `plugin.load(ctx)` on each
- Load order resolution via manifest dependencies
- Error isolation — one bad plugin cannot crash the bot process
- Hot-reload via file watcher for eligible plugins
- `core/HookBus.js` — async EventEmitter wrapping `interactionCreate` and `messageCreate` flows
- `core/PluginContext.js` — builds and freezes the `ctx` object passed to each plugin
- `registerCommand` and `overrideCommand` implementations
- `defineModel` with automatic namespace prefixing
- New `PluginConfig` MongoDB model — keyed `{ guildId, pluginName }` — for per-guild plugin settings
- Refactor existing `index.js` command/event loading to go through Plugin Manager (core becomes a privileged internal plugin)

**Milestone:** A plugin placed in `plugins/` that overrides `/daily`, adds a new `/shop` command, and hooks `onLevelUp` — all working without touching any core file.

---

## Phase 2 — Internal Bot API

**Goal:** A control plane for the bot. Power users can script against it. Dashboard is not built yet but everything it needs is already exposed.

- Lightweight Express/Fastify server running in the bot process on a configurable internal port
- Discord OAuth middleware from day one — admins authenticate via Discord, API checks guild admin permissions, issues session tokens. **Not bolted on later.**
- REST endpoints:
  - `GET  /api/plugins` — list installed plugins + status
  - `POST /api/plugins/install` — install by npm package name or local path
  - `POST /api/plugins/unload/:name` — unload a plugin
  - `POST /api/plugins/reload/:name` — hot-reload if eligible
  - `GET  /api/guild/:guildId/config` — read guild + plugin configs
  - `PUT  /api/guild/:guildId/config` — write guild config
  - `GET  /api/guild/:guildId/stats` — members, XP activity, ticket counts
- WebSocket stream — broadcasts Hook Bus events to connected clients in real time (activity feed, live logs, install progress)
- Install endpoint runs `npm install <package>` in a child process and streams stdout/stderr back over WebSocket

**Milestone:** `curl`-ing the API to install a community plugin, watching it stream install logs, and seeing it go live — all without restarting the bot or touching any files.

---

## Phase 3 — Admin Dashboard (Core)

**Goal:** Non-technical server admins have a GUI. First usable version.

- Separate web app process (React)
- Discord OAuth login — "Sign in with Discord", server picker showing only guilds where the user has admin permissions
- Plugin management UI:
  - Installed plugins list with enable/disable toggles
  - Install from folder path or npm package name (power user escape hatch)
  - Restart-required badge on relevant plugins
  - Real-time install log stream via WebSocket
- Basic guild config UI — mirrors existing `ServerConfig` fields (AI settings, XP settings, ticket config, etc.)
- Activity feed — live WebSocket stream of hook events (commands fired, level-ups, tickets opened)

**Milestone:** A non-technical admin can log in with Discord, pick their server, toggle plugins on/off, and configure bot settings — without touching a config file or environment variable.

---

## Phase 4 — Plugin Registry (Marketplace)

**Goal:** Community plugins are discoverable and one-click installable from the dashboard.

- `vaish-plugin-registry` — a maintained npm package / GitHub repo containing a curated JSON manifest of community plugins
- Each registry entry: npm package name, display name, description, author, version, permissions summary, verified status, requiresRestart flag
- Dashboard marketplace tab — card grid of registry plugins, filterable by category and permissions
- Permission summary shown before install (same UX as Discord OAuth scopes or Android app permissions) — not a gate, just transparency
- Verified badge for audited plugins
- Community submission process via PR to the registry repo

**Milestone:** An admin opens the marketplace, sees community plugins as cards, clicks Install on one, watches the live log stream, and the plugin is live — all from the browser.

---

## Phase 5 — Auto-Generated Plugin Settings UI

**Goal:** Plugin authors declare a config schema, non-technical admins get a fully rendered settings form. Zero dashboard code required per plugin.

- Plugin manifest `configSchema` field — standard JSON Schema
- Dashboard reads schema and auto-renders appropriate form controls:
  - `string` → text input
  - `boolean` → toggle
  - `number` → number input with optional min/max
  - `enum` → dropdown
  - `array` → tag input
- Form saves to `PluginConfig` model via `PUT /api/guild/:guildId/config`
- Plugin reads its config via `ctx.db.getPluginConfig(guildId, pluginName)` — no form code in the plugin itself

**Milestone:** A plugin author adds a `configSchema` to their manifest. Without writing any dashboard code, server admins see a settings panel for that plugin with working form controls that persist per guild.

---

## Architectural Decisions (Locked)

These are cheap to decide now and expensive to change later. Treat them as settled.

**Discord OAuth from day one.** The internal API ships with auth middleware in Phase 2, not added later. Retrofitting auth onto an existing API requires restructuring every endpoint.

**Dashboard is just another API client.** The dashboard has no special privileges the API doesn't expose. A CLI tool, a Discord slash command, or a third-party integration hitting the same API gets the same capabilities. Build the API once; everything else is a consumer.

**PluginConfig is separate from ServerConfig.** Core bot config lives in `ServerConfig`. Plugin-specific per-guild config lives in `PluginConfig { guildId, pluginName, data }`. Plugins never write to `ServerConfig` directly.

**Hook Bus events stream to the WebSocket.** Plugin authors get dashboard activity feed visibility automatically. No extra work per plugin.

**Plugin models are namespaced.** `ctx.defineModel('inventory', schema)` inside plugin `economy-plus` registers as `plugin_economy-plus_inventory`. No collision risk with core schemas or other plugins.

---

## What a Fully Capable Plugin Can Do

To make the power of this platform concrete — a single well-built plugin can:

- Add any number of new slash commands
- Override any existing command (call the original, wrap it, or replace it entirely)
- Hook into the AI pipeline to inject persona, memory, or filtered context
- Register new MongoDB models and read/write them freely
- Schedule cron jobs
- Listen to any Discord event directly via the raw client
- Expose its own config schema so admins get a settings UI for free
- Communicate between plugins via the shared Hook Bus
- **Expose its own web interface** — plugins can run their own HTTP servers on declared ports

A plugin that does all of the above is effectively a new bot running on the same infrastructure. That is the intended ceiling.

---

## Phase 3.5 — Administration Plugin

**Goal:** Provide a built-in web-based admin dashboard as a default plugin.

The `administration` plugin is a first-class plugin that demonstrates the full power of the plugin system by exposing a complete web-based admin interface.

### Location

```
plugins/
  administration/
    plugin.json       ← manifest with port: 50000
    index.js          ← Fastify web server + API routes
    web/              ← React frontend source
      src/
        components/   ← Reusable UI components
        pages/        ← Dashboard pages (AI, XP, Tickets, etc.)
        hooks/        ← React hooks for auth and API calls
        utils/        ← Helper functions
```

### Features

| Section | Description |
|---------|-------------|
| **Dashboard** | Server overview with member count, XP stats, ticket counts, top users |
| **AI Settings** | Toggle AI, configure mode (context/auto/hybrid), set channels, edit FAQ context |
| **XP & Leveling** | Configure XP rates, channel tracking, role rewards |
| **Tickets** | View ticket stats, configure category and log channel |
| **Economy** | Work reward settings, shop item management |
| **Birthdays** | Enable/disable, configure announcement channel and birthday role |
| **Anti-Raid** | Enable raid protection, configure thresholds and actions |
| **Activity Logs** | View recent XP transactions and events |
| **Settings** | Server info, config export, documentation links |

### Authentication

- Uses Discord OAuth2 — same as the internal bot API
- Sessions stored in MongoDB (`admin_sessions` collection)
- Permission check: Administrator (0x8) or Manage Guild (0x20)
- Bot owners bypass all permission checks via `OWNER_IDS` env var

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ADMINISTRATION_PORT` | Web server port (default: 50000) |
| `ADMINISTRATION_SESSION_SECRET` | Session secret (falls back to `SESSION_SECRET`) |
| `ADMINISTRATION_OAUTH_CLIENT_ID` | Discord OAuth client ID (falls back to `DISCORD_OAUTH_CLIENT_ID`) |
| `ADMINISTRATION_OAUTH_CLIENT_SECRET` | Discord OAuth secret (falls back to `DISCORD_OAUTH_CLIENT_SECRET`) |
| `ADMINISTRATION_OAUTH_REDIRECT_URI` | OAuth callback URL (default: `http://localhost:50000/auth/discord/callback`) |
| `ADMINISTRATION_BOT_API_URL` | Bot API URL for internal calls (default: `http://localhost:{BOT_API_PORT}`) |

### Plugin Architecture Extension

This plugin extends the concept of what a plugin can do:
- Plugins can declare a `port` in their manifest
- Plugins can run their own HTTP servers
- Plugins can serve their own static content (React SPA)
- Plugins can register their own API routes
- Plugins can implement their own authentication flows using the core OAuth setup

---

_This document is a living planning reference. Update it as architectural decisions are made or revised._
