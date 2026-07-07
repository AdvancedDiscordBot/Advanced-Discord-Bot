# Administration Dashboard

The built-in web dashboard for managing your ADB-powered Discord bot. Access guild settings, plugins, logs, and configuration from a clean browser interface.

## Features

- **Guild Overview** — Bot status, member counts, and server health at a glance
- **Plugin Management** — Browse the marketplace, install, configure, and uninstall plugins with one click
- **Per-guild Settings** — Tweak bot behaviour per server without touching config files
- **Hot Reload** — Reload eligible plugins live without restarting the bot
- **OAuth2 Login** — Secure Discord-based authentication for dashboard access

## Access

The dashboard runs on port `50000` by default. Visit `http://localhost:50000` after starting your bot and log in with your Discord account.

> Only users with Manage Server permissions (or bot owners) can access the dashboard.

## Permissions

Requires `db.read`, `db.write`, `commands.register`, `scheduler`, and `hooks`.
