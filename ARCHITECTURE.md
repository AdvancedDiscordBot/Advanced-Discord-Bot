# Architecture

This file summarizes the runtime architecture and data model of the bot as implemented in the repository. It is derived directly from the code (index.js, utils, events, models).

## High-level components

- index.js
  - Loads commands and events dynamically from `commands/` and `events/`.
  - Initializes the `Database` singleton (`utils/database.js`) which wraps `models/schemas.js`.
  - Starts `TaskScheduler` (`utils/scheduler.js`) for periodic jobs.
  - Rotates bot presence and handles graceful shutdown and global error handlers.
- Command loader
  - `deploy-commands.js` scans `commands/`, uses `SlashCommandBuilder` JSON via `command.data.toJSON()` and registers commands via Discord REST API.
- Events
  - `events/interactionCreate.js` — central handler for slash commands, buttons, modals, select menus; enforces per-command cooldowns and handles many interactive flows (tickets, AI modals, truth-or-dare, feedback).
  - `events/messageCreate.js` — XP tracking, message-based AI auto-responses (when configured), and related side-effects.
  - Other events: `ready.js`, `guildMemberAdd.js`, `modalCreate.js`, `voiceStateUpdate.js`, `helpInteraction.js`.
- Database layer
  - `utils/database.js` exposes model methods and utility functions for server config, user profile, tickets, AI rate limits, XP transactions, leaderboards, birthdays, shop items, anti-raid, and guild economy.
  - Models defined in `models/schemas.js` (see Data Models below).
- Background scheduler
  - `utils/scheduler.js` uses `node-cron` to run:
    - daily resets (midnight UTC)
    - weekly resets (Monday midnight UTC)
    - hourly leaderboard updates
    - role checks every 30 minutes
    - birthday checks daily at 8:00 UTC

## Data models (high-level)

- ServerConfig — per-guild configuration: `aiEnabled`, `aiContext`, `aiChannels`, `aiMode`, `ticketCategoryId`, `ticketLogChannelId`, XP and role automation settings, birthday config, etc.
- UserProfile — per-user-per-guild profile: `userId`, `guildId`, `wallet`, `bank`, `totalXp`, `level`, `messageCount`, `voiceMinutes`, `points`, `currentRoles`, `dailyStreak`, timestamps.
- Ticket — support ticket records with messages array, status, priority, moderatorId, closedAt.
- AIRateLimit — per-user rate limiting for AI requests (requestCount, lastRequest, resetAt).
- XPTransaction — XP audit log entries.
- Leaderboard — cached top users per guild.
- Birthday — birthday records.
- GuildEconomy, ShopItem, TruthOrDareConfig, AntiRaid — specialized configuration schemas.

(See `models/schemas.js` for full field lists and indexes.)

## Runtime flow

1. Startup (`node index.js`)
   - `index.js` loads commands and events and attempts to connect to MongoDB using `MONGODB_URI`.
   - Scheduler is created and registered.
   - Bot logs in with `DISCORD_TOKEN`.
2. Interaction flow
   - Slash commands: `events/interactionCreate.js` receives chat input commands, enforces cooldowns, and calls the command's `execute(interaction, client)`.
   - Buttons/selects/modals: `interactionCreate` dispatches UI interactions to helper handlers (tickets, help navigation, AI modals, truth-or-dare buttons).
3. Message flow
   - `messageCreate.js` handles XP awarding (rate-limited per user/time) and message-based AI auto-responses when the server `ServerConfig` allows it.
4. Scheduler tasks
   - Cron jobs perform resets, leaderboard updates, and role assignment checks.

## Command & event structure

- Each command file exports at least `data` (SlashCommandBuilder) and `execute` function.
- Commands may include a `cooldown` property (seconds) used by the interaction handler.
- Commands are organized in folders (fun, moderation, economy, xp, ai, truth-or-dare, etc.).

## External integrations

- Discord (discord.js v14) — main runtime and components
- MongoDB (mongoose) — persistence
- Google Gemini via `@google/genai` — AI assistant features (requires `GEMINI_API_KEY`)
- node-cron — scheduling

## Environment variables required by code

- `DISCORD_TOKEN` (required) — bot token
- `CLIENT_ID` (required for `deploy-commands.js`) — application id
- `GUILD_ID` (optional) — when present `deploy-commands.js` deploys commands to that guild
- `MONGODB_URI` (required) — MongoDB connection string
- `GEMINI_API_KEY` (optional) — Google Gemini key for AI
- `PORT` (optional) — not used by default; an express server is present but commented out

## Permissions & Intents

- Intents requested in `index.js`: `Guilds`, `GuildMembers`, `GuildMessages`, `MessageContent`, `GuildMessageReactions`, `GuildVoiceStates`, `GuildPresences`.
- Privileged intents (Message Content, Guild Members, Presences) must be enabled in the Discord Developer Portal to use the corresponding features.
- Bot requires typical moderation permissions depending on features used (Ban/Kick, ManageChannels for tickets, ManageRoles for automatic role assignment, ManageMessages for purge, EmbedLinks + SendMessages).

## Scaling & operational notes

- Scheduler runs in-process; running multiple instances will duplicate scheduled jobs unless you coordinate (e.g., leader election or single scheduler process).
- Database connections are per-process (the `Database` singleton avoids re-connecting repeatedly in the same process).
- Consider using Redis or another cache if you need high-throughput leaderboards or cross-process rate-limiting.

## Extending the bot

- Add new commands: create a file in `commands/<category>/` exporting `data` and `execute`. Run `node deploy-commands.js` to register slash commands.
- Add new events: place a new file in `events/` exporting `{ name, execute, once? }` and the loader in `index.js` will attach it.
- New DB models: update `models/schemas.js` and expose them via `utils/database.js` for convenience.
