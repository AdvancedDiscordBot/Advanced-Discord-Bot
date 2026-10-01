<div align="center">

# 📚 Advanced Discord Bot Documentation

How commands work in **Advanced Discord Bot (ADB)**.

</div>

---

## 🧩 ADB has no built-in commands

ADB's core is a lean bot runtime + dashboard. **It ships with zero user-facing
slash commands of its own.** Every command your server gets comes from an
installed **plugin** — a package named `adb-plugin-*`.

At startup the plugin loader discovers plugins from two places:

- `node_modules/` — anything matching `adb-plugin-*` with a `plugin.json` + entry file
- the local `plugins/` directory — the only in-repo plugin is `plugins/administration` (the dashboard itself)

Because the command set depends entirely on which plugins you install, this repo
does **not** maintain a central slash-command list. Each plugin documents its own
commands in its own README.

### The flow: install → enable per guild → deploy → commands appear

1. **Install** — host owner only, from the dashboard marketplace or
   `npm install adb-plugin-<name>` in the bot's root. Installation is an
   `npm install` of an `adb-plugin-*` package; the package name is validated
   first.
2. **Enable it per guild** — an installed plugin is **off in every guild** until
   that guild's admin turns it on from the dashboard **Plugins** page. This is
   enforced by the platform, not by your code. (`administration` and any
   `system:raw-client` plugin are not gateable — the API refuses to toggle them.)
3. **Deploy** the commands to Discord:
   ```bash
   npm run deploy
   ```
   This runs `node scripts/build-plugins.js && node deploy-commands.js`, which
   loads every enabled plugin in isolation mode and registers its slash commands
   with Discord. The overwrite is **guild-scoped** — `CLIENT_ID` and `GUILD_ID`
   are both required and a global overwrite is refused. An empty command set is
   refused unless you pass `--allow-empty`.
4. **Commands appear** in your server. Plugin *logic* hot-reloads, but adding or
   changing a slash command definition always needs a fresh `npm run deploy`.

---

## 🔌 Official plugins

The core ships **no user-facing commands of its own**. Everything below is a
separate repository under the
[`AdvancedDiscordBot`](https://github.com/AdvancedDiscordBot) org, published to
npm as `adb-plugin-<name>` and discovered from `node_modules/adb-plugin-*`.

Versions are the `version` in each installed `plugin.json` at the time this file
was written; they move, so treat the column as a snapshot rather than a promise.

| Plugin | Version | What it adds |
|---|---|---|
| [`adb-plugin-aegis`](https://github.com/AdvancedDiscordBot/adb-plugin-aegis) | 1.2.1 | Server protection: anti-raid, anti-spam, link filtering, alt/join-gate detection. |
| [`adb-plugin-automod`](https://github.com/AdvancedDiscordBot/adb-plugin-automod) | 1.3.3 | Rule-based auto-moderation: `/automod rule add\|remove\|edit`, `/automod list`, `/automod whitelist`, `/automod action`. |
| [`adb-plugin-autorole`](https://github.com/AdvancedDiscordBot/adb-plugin-autorole) | 1.3.0 | Automatically assigns roles to members on join. |
| [`adb-plugin-confessions`](https://github.com/AdvancedDiscordBot/adb-plugin-confessions) | 1.3.1 | Anonymous confessions with optional approval: `/confess text`, `/confess-admin …`. |
| [`adb-plugin-counting`](https://github.com/AdvancedDiscordBot/adb-plugin-counting) | 1.3.1 | Counting game channel: `/counting channel\|stats\|reset`. |
| [`adb-plugin-custom-commands`](https://github.com/AdvancedDiscordBot/adb-plugin-custom-commands) | 1.3.1 | Lets admins define their own custom text/response commands. |
| [`adb-plugin-giveaways`](https://github.com/AdvancedDiscordBot/adb-plugin-giveaways) | 1.3.1 | Giveaways: `/giveaway start\|end\|reroll\|list`. |
| [`adb-plugin-invite-tracker`](https://github.com/AdvancedDiscordBot/adb-plugin-invite-tracker) | 1.4.0 | Invite tracking and leaderboard: `/invites me\|user\|leaderboard`, `/invites-admin …`. |
| [`adb-plugin-levels`](https://github.com/AdvancedDiscordBot/adb-plugin-levels) | 1.3.1 | XP and leveling from message activity: `/level`, `/leaderboard`, plus `/level-config` and `/level-roles` for admins. Role rewards on level-up. |
| [`adb-plugin-moderation`](https://github.com/AdvancedDiscordBot/adb-plugin-moderation) | 1.3.1 | Moderation and tickets: `/ban`, `/unban`, `/kick`, `/timeout`, `/warn`, `/warnings`, `/purge`, `/slowmode`, `/lock`, `/case`, `/history`, `/ticket …`. Numbered case log with auto-escalation. |
| [`adb-plugin-reaction-roles`](https://github.com/AdvancedDiscordBot/adb-plugin-reaction-roles) | 2.0.0 | Self-assignable roles via reactions, buttons and select menus. |
| [`adb-plugin-reminders`](https://github.com/AdvancedDiscordBot/adb-plugin-reminders) | 1.4.0 | Personal reminders: `/remind set\|list\|cancel`. The bot DMs you when due. |
| [`adb-plugin-server-logs`](https://github.com/AdvancedDiscordBot/adb-plugin-server-logs) | 1.3.1 | Audit logging by category: `/log set\|remove\|list\|enable\|disable\|ignore\|retention`. |
| [`adb-plugin-tempvoice`](https://github.com/AdvancedDiscordBot/adb-plugin-tempvoice) | 1.3.0 | Temporary join-to-create voice channels with owner controls (lock, limit, rename, permit/deny, claim). Commands live under `/voice`. |
| [`adb-plugin-todo`](https://github.com/AdvancedDiscordBot/adb-plugin-todo) | 1.4.0 | Personal to-do lists: `/todo add\|list\|done\|remove\|edit\|clear`. |
| [`adb-plugin-welcome`](https://github.com/AdvancedDiscordBot/adb-plugin-welcome) | 2.1.1 | Configurable welcome and goodbye messages and cards. |

Two more packages exist but are not in the marketplace registry:

- **`adb-plugin-music`** (1.0.0) is installed in this checkout and not listed in
  `data/plugin-registry.json`. It needs an external Lavalink v4 node and
  credentials before it does anything.
- **`adb-plugin-template`** is the scaffold new plugins are copied from; it is
  not meant to be installed in production.

Plus one in-repo plugin: **`administration`** (v2.0.0), the dashboard host. It is
first-party, loads direct, and is not installable from the marketplace.

> Command names above were taken from each plugin's README/source where verified.
> Exact options and subcommands change between versions — the plugin's own
> README is the source of truth.

---

## 🔗 Where to look next

- **Per-plugin command reference** — each plugin's `README.md` (linked in the table above) lists its full, current command set.
- **Marketplace / registry** — browse and install plugins from the dashboard, or see the registry: [AdvancedDiscordBot/registry](https://github.com/AdvancedDiscordBot/registry).
- **Building your own plugin** — [CREATE-PLUGIN.md](./CREATE-PLUGIN.md).
- **Getting started with the bot** — [README.md](./README.md).

---

Adding or changing a plugin's slash commands? Re-run `npm run deploy` so Discord
receives the updated command list.
