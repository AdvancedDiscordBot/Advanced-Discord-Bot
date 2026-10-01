# Administration Dashboard

The built-in web dashboard for managing your ADB-powered Discord bot. Access guild settings, plugins, logs, and configuration from a clean browser interface.

## Features

- **Guild Overview** — Bot status, member counts, and server health at a glance
- **Plugin Management** — Browse the marketplace, install, configure, and uninstall plugins with one click
- **Per-guild Settings** — Tweak bot behaviour per server without touching config files
- **Hot Reload** — Reload eligible plugins live without restarting the bot
- **OAuth2 Login** — Secure Discord-based authentication for dashboard access
- **Infractions & Moderation (`/mod`)** — `warn`, `mute`/`unmute`, `timeout`, `kick`, `softban`, private case `note`s, evidence attachments, and `warnings view|remove|clear|list|stats`, all with per-server case IDs
- **Auto-Escalation** — Set per-action warning thresholds (mute, timeout, kick, temp ban, permanent ban) in the dashboard; members are DMed at each step with your appeal info

## Access

The dashboard runs on port `50000` by default. Visit `http://localhost:50000` after starting your bot and log in with your Discord account.

> Only users with Manage Server permissions (or bot owners) can access the dashboard.

## Permissions

Requires `db.read`, `db.write`, `commands.register`, `scheduler`, and `hooks`.
