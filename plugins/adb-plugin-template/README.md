# adb-plugin-template

A starter template for building ADB plugins. Works in both **direct mode** (main process) and **isolated mode** (worker thread).

## What it demonstrates

- Registering a slash command (`/template-hello`)
- Listening to Discord events (`guildMemberAdd`)
- Reading/writing plugin config via `ctx.db`
- Using `ctx.discord` for Discord API calls (isolated-mode safe)
- Subscribing to hooks from other plugins

## Quick start

1. Copy this folder to `plugins/adb-plugin-my-plugin/`
2. Update `plugin.json` with your plugin name, description, and capabilities
3. Edit `index.js` to implement your features
4. Add your discord permissions to `discordPermissions` in `plugin.json`
5. Restart the bot or let hot-reload pick up changes

## Configuration

Server admins can configure this plugin via the dashboard:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable the plugin |
| `welcomeMessage` | string | `"Hello!"` | Custom welcome message (use `{user}` for mention) |
| `welcomeChannelId` | string | — | Channel ID for welcome messages |

## Capabilities

This template declares these capabilities:

- `storage:own-collection` — for plugin config
- `discord:SendMessages` — for sending messages
- `discord:GuildInfo` — for fetching guild/member info

Add more capabilities as needed. See `CREATE-PLUGIN.md` for the full list.

## Isolated mode

This plugin is designed to work in isolated mode (`"isolation": true` in plugin.json).

Key differences from direct mode:
- `ctx.client` is `null` — use `ctx.discord` for all Discord operations
- `require('discord.js')` is not available in the worker
- Event payloads are serialized plain objects, not Discord.js class instances
- `ctx.config.env` is empty — secrets never leave Core

See `CREATE-PLUGIN.md` for the full isolation guide.
