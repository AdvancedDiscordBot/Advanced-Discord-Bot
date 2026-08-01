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

### The flow: install → enable → deploy → commands appear

1. **Install** a plugin — from the dashboard marketplace, or `npm install adb-plugin-<name>` in the bot's root.
2. **Enable** it from the dashboard (writes it into the plugin config the loader reads).
3. **Deploy** the commands to Discord:
   ```bash
   npm run deploy
   ```
   This runs `node scripts/build-plugins.js && node deploy-commands.js`, which
   gathers every enabled plugin's slash commands and registers them with Discord.
4. **Commands appear** in your server. Plugin *logic* hot-reloads, but adding or
   changing a slash command definition always needs a fresh `npm run deploy`.

---

## 🔌 Official plugins

From the registry at [AdvancedDiscordBot/registry](https://github.com/AdvancedDiscordBot/registry).
The commands below are indicative — see each plugin's own README for the full, current reference.

| Plugin | What it adds |
|---|---|
| [`adb-plugin-moderation`](https://github.com/AdvancedDiscordBot/adb-plugin-moderation) | Moderation + tickets: `/ban`, `/unban`, `/kick`, `/timeout`, `/warn`, `/warnings`, `/purge`, `/slowmode`, `/lock`, `/case`, `/history`, `/ticket …`. Numbered case log with auto-escalation. |
| [`adb-plugin-levels`](https://github.com/AdvancedDiscordBot/adb-plugin-levels) | XP & leveling from message activity: `/level`, `/leaderboard`, plus `/level-config` and `/level-roles` for admins. Role rewards on level-up. |
| [`adb-plugin-aegis`](https://github.com/AdvancedDiscordBot/adb-plugin-aegis) | Server protection: anti-raid, anti-spam, link filtering, and alt/join-gate detection. |
| [`adb-plugin-automod`](https://github.com/AdvancedDiscordBot/adb-plugin-automod) | Rule-based auto-moderation: `/automod rule add|remove|edit`, `/automod list`, `/automod whitelist`, `/automod action`. |
| [`adb-plugin-autorole`](https://github.com/AdvancedDiscordBot/adb-plugin-autorole) | Automatically assigns roles to members on join. |
| [`adb-plugin-confessions`](https://github.com/AdvancedDiscordBot/adb-plugin-confessions) | Anonymous confessions with optional approval: `/confess text`, `/confess-admin …`. |
| [`adb-plugin-counting`](https://github.com/AdvancedDiscordBot/adb-plugin-counting) | Counting game channel: `/counting channel|stats|reset`. |
| [`adb-plugin-custom-commands`](https://github.com/AdvancedDiscordBot/adb-plugin-custom-commands) | Lets admins define their own custom text/response commands. |
| [`adb-plugin-giveaways`](https://github.com/AdvancedDiscordBot/adb-plugin-giveaways) | Giveaways: `/giveaway start|end|reroll|list`. |
| [`adb-plugin-invite-tracker`](https://github.com/AdvancedDiscordBot/adb-plugin-invite-tracker) | Invite tracking + leaderboard: `/invites me|user|leaderboard`, `/invites-admin …`. |
| [`adb-plugin-reaction-roles`](https://github.com/AdvancedDiscordBot/adb-plugin-reaction-roles) | Self-assignable roles via reactions/buttons. |
| [`adb-plugin-reminders`](https://github.com/AdvancedDiscordBot/adb-plugin-reminders) | Personal reminders: `/remind set|list|cancel`. Bot DMs you when due. |
| [`adb-plugin-server-logs`](https://github.com/AdvancedDiscordBot/adb-plugin-server-logs) | Audit logging by category: `/log set|remove|list|enable|disable|ignore|retention`. |
| [`adb-plugin-tempvoice`](https://github.com/AdvancedDiscordBot/adb-plugin-tempvoice) | Temporary "join-to-create" voice channels with owner controls (lock, limit, rename, permit/deny, claim). |
| [`adb-plugin-todo`](https://github.com/AdvancedDiscordBot/adb-plugin-todo) | Personal to-do lists: `/todo add|list|done|remove|edit|clear`. |
| [`adb-plugin-welcome`](https://github.com/AdvancedDiscordBot/adb-plugin-welcome) | Configurable welcome / goodbye messages and cards. |

> Command names above were taken from each plugin's README/source where verified.
> Exact options and subcommands can change between versions — the plugin's own
> README is always the source of truth.

---

## 🔗 Where to look next

- **Per-plugin command reference** — each plugin's `README.md` (linked in the table above) lists its full, current command set.
- **Marketplace / registry** — browse and install plugins from the dashboard, or see the registry: [AdvancedDiscordBot/registry](https://github.com/AdvancedDiscordBot/registry).
- **Building your own plugin** — [CREATE-PLUGIN.md](./CREATE-PLUGIN.md).
- **Getting started with the bot** — [README.md](./README.md).

---

Adding or changing a plugin's slash commands? Re-run `npm run deploy` so Discord
receives the updated command list.
