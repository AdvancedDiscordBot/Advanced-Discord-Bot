<div align="center">

# 🤖 Advanced Discord Bot

### Self-hosted Discord bot platform with a plugin marketplace

[![Build](https://img.shields.io/github/last-commit/AdvancedDiscordBot/Advanced-Discord-Bot?style=flat-square)](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/commits/beta)
[![License](https://img.shields.io/github/license/AdvancedDiscordBot/Advanced-Discord-Bot?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-43853D?style=flat-square)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)
[![Plugins](https://img.shields.io/badge/plugins-16%20published-6A5ACD?style=flat-square)](https://github.com/AdvancedDiscordBot/registry)

[**Get Started**](#-quick-start) · [**Plugins**](#-official-plugins) · [**Build a Plugin**](#-build-your-own-plugin) · [**Docs**](CONTRIBUTING.md#-documentation-map) · [**Report a Bug**](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/issues/new?template=bug_report.md)

<img src="screenshots/MainMenu.png" alt="ADB dashboard" width="85%" />

</div>

---

## 📖 Contents

- [Why](#-why)
- [Quick Start](#-quick-start)
- [Official Plugins](#-official-plugins)
- [Build Your Own Plugin](#-build-your-own-plugin)
- [Contributing](#-contributing)
- [How It Works](#-how-it-works)
- [Configuration](#-configuration)
- [Testing](#-testing)
- [Docs](#-docs)

---

## 💡 Why

A Discord bot you actually own. The source is AGPL, your data stays in your
MongoDB, and the features you don't want are plugins you can simply not install.

**Core ships no user-facing commands on purpose.** Moderation, levels, welcome
messages — all of that is a plugin. That boundary is why a community plugin can
never take down your bot process, and it is why adding a feature to your server
doesn't mean forking the bot.

- **16 published plugins**, installed from the dashboard or npm
- **Per-server plugin toggles** — every npm plugin is off until a server admin
  enables it
- **Capability-gated plugins** — each declares exactly what it may use; the
  runtime denies the rest
- **Optional worker isolation** — plugins can run in a separate thread with a
  gated RPC surface instead of the main process
- **Plugin marketplace** — registry-backed discovery and install from the dashboard

---

## 🚀 Quick Start

Requires **Node.js 20+** and a **MongoDB** you control.

### 1. Create a Discord application

At the [Discord Developer Portal](https://discord.com/developers/applications),
create an application, add a bot, and reset its token. On the **Bot** page enable
**Server Members Intent**, **Message Content Intent** and **Presence Intent** —
the client requests all three and will fail to connect without them.

### 2. Get the code

```bash
git clone https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot.git
cd Advanced-Discord-Bot
npm install
```

### 3. Configure it

```bash
cp .env.example .env
```

Minimum viable `.env`:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_test_server_id
MONGODB_URI=mongodb://127.0.0.1:27017/adb_dev
OWNER_IDS=your_discord_user_id
SESSION_SECRET=openssl-rand-hex-32-output
```

`OWNER_IDS` is the top privilege tier — only these users can install or uninstall
plugins. `GUILD_ID` makes command registration instant in your own server instead
of Discord's global sync (which can take an hour).

### 4. Run it

```bash
npm run deploy    # register slash commands
npm start
```

Confirm it is alive:

```bash
curl -s http://localhost:3000/health     # -> {"status":"ok"}
```

### Docker

```bash
docker compose up -d --build
```

Configuration lives in `.env`; the compose file pins the project name and ports
so volumes survive a rebuild. Never add `-v` to a deploy — that wipes the
database.

> **Full walkthrough, including the dashboard and OAuth:** [`LOCAL-SETUP.md`](LOCAL-SETUP.md)

---

## 🔌 Official Plugins

Install from the dashboard's marketplace, or with npm:

```bash
npm install adb-plugin-moderation
```

npm-installed plugins are **off in every server** until that server's admin
enables them. See [Build Your Own Plugin](#-build-your-own-plugin) for the
authoring side.

| Plugin | Repo | npm | Latest | What it does |
|---|---|---|---|---|
| Aegis | [`aegis`](https://github.com/AdvancedDiscordBot/adb-plugin-aegis) | `adb-plugin-aegis` | 1.2.1 | Anti-raid, anti-spam, anti-link and anti-alt detection, each module toggled separately |
| Automod | [`automod`](https://github.com/AdvancedDiscordBot/adb-plugin-automod) | `adb-plugin-automod` | 1.3.3 | Rule-based filtering for spam, links, words, caps, mentions, emoji and invites |
| Autorole | [`autorole`](https://github.com/AdvancedDiscordBot/adb-plugin-autorole) | `adb-plugin-autorole` | 1.3.0 | Assign roles on join, for bots, at an XP level, after a delay, or temporarily |
| Confessions | [`confessions`](https://github.com/AdvancedDiscordBot/adb-plugin-confessions) | `adb-plugin-confessions` | 1.3.1 | Anonymous webhook posts with moderation queue, cooldowns and a blocklist |
| Counting | [`counting`](https://github.com/AdvancedDiscordBot/adb-plugin-counting) | `adb-plugin-counting` | 1.3.1 | Sequential counting game with turn enforcement, milestones and per-user stats |
| Custom Commands | [`custom-commands`](https://github.com/AdvancedDiscordBot/adb-plugin-custom-commands) | `adb-plugin-custom-commands` | 1.3.1 | Admin-defined slash, text and context-menu commands with variable templates |
| Giveaways | [`giveaways`](https://github.com/AdvancedDiscordBot/adb-plugin-giveaways) | `adb-plugin-giveaways` | 1.3.1 | Scheduled giveaways with entry buttons, role requirements, rerolls and auto-end |
| Invite Tracker | [`invite-tracker`](https://github.com/AdvancedDiscordBot/adb-plugin-invite-tracker) | `adb-plugin-invite-tracker` | 1.4.0 | Per-user invite attribution, leaderboard, fake-join detection and milestone roles |
| Levels & XP | [`levels`](https://github.com/AdvancedDiscordBot/adb-plugin-levels) | `adb-plugin-levels` | 1.3.1 | XP from message activity, levels, leaderboards and role rewards on level-up |
| Moderation | [`moderation`](https://github.com/AdvancedDiscordBot/adb-plugin-moderation) | `adb-plugin-moderation` | 1.3.1 | Ban, kick, timeout, warn, purge, slowmode, lock, tickets and numbered case log |
| Reaction Roles | [`reaction-roles`](https://github.com/AdvancedDiscordBot/adb-plugin-reaction-roles) | `adb-plugin-reaction-roles` | 2.0.0 | Self-assignable roles via emoji reactions, buttons or select menus |
| Reminders | [`reminders`](https://github.com/AdvancedDiscordBot/adb-plugin-reminders) | `adb-plugin-reminders` | 1.4.0 | `/remind set|list|cancel`, delivered by DM with a channel fallback and retry backoff |
| Server Logs | [`server-logs`](https://github.com/AdvancedDiscordBot/adb-plugin-server-logs) | `adb-plugin-server-logs` | 1.3.1 | Audit logging by category for member, message, moderation, voice and channel events |
| Temp Voice | [`tempvoice`](https://github.com/AdvancedDiscordBot/adb-plugin-tempvoice) | `adb-plugin-tempvoice` | 1.3.0 | Join-to-create voice rooms with name templates, limits, permit/deny and auto-delete |
| To-Do | [`todo`](https://github.com/AdvancedDiscordBot/adb-plugin-todo) | `adb-plugin-todo` | 1.4.0 | Per-user task lists with paging, per-guild caps and status filters |
| Welcome | [`welcome`](https://github.com/AdvancedDiscordBot/adb-plugin-welcome) | `adb-plugin-welcome` | 2.1.1 | Welcome and goodbye messages, canvas image cards, DMs, roles and social links |

Not in the table: [`adb-plugin-template`](https://github.com/AdvancedDiscordBot/adb-plugin-template)
(the authoring scaffold, deliberately never published) and
[`adb-plugin-music`](https://github.com/AdvancedDiscordBot/adb-plugin-music)
(a complete Lavalink music plugin that is not yet published — see
[issue #13](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/issues/13)).

### Trust and isolation — read before installing

Each plugin's `plugin.json` declares a `capabilities` block, and the runtime
denies any RPC the plugin did not declare. A plugin requesting
`system:raw-client` is the explicit, owner-approved exception: it runs in the
bot's main process with full host access, and the dashboard shows a risk card
before you approve it.

Most first-party plugins need this today, so **install only code you have
reviewed**. Worker separation is not an operating-system sandbox. Tracked in
[#39](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/issues/39).

---

## 🧩 Build Your Own Plugin

**Plugins live in their own repository.** This repo is the platform. If you
arrange a new command folder in here, you have built the wrong thing — see
[`AGENTS.md`](AGENTS.md).

```bash
git clone https://github.com/AdvancedDiscordBot/adb-plugin-template.git
mv adb-plugin-template adb-plugin-myplugin
cd adb-plugin-myplugin

# rename the package everywhere it is referenced
grep -rl 'adb-plugin-template' . --exclude-dir=.git \
  | xargs sed -i 's/adb-plugin-template/adb-plugin-myplugin/g'

npm install && npm test        # 14 tests, no Discord or MongoDB needed
```

`adb-plugin-template` ships a working harness, a manifest-v2 example and a
`README.md` that is the authoritative description of the plugin API. Read its
README before writing anything.

A plugin is one function:

```js
async function load(ctx) {
  ctx.registerCommand({
    data: { name: "hello", description: "Say hello" },
    async execute(interaction) {
      await interaction.reply("Hello from my plugin!");
    },
  });
}
module.exports = { load };
```

Then, to run it inside a real bot:

```bash
cd /path/to/Advanced-Discord-Bot
npm install --no-save --package-lock=false ../adb-plugin-myplugin
npm run deploy && npm start
```

### Before you open a PR

A plugin PR is accepted when it does these things, in this order:

1. **Runs.** `npm test` passes in your plugin repo. This is checked first and
   everything else is secondary — a PR that does not run is not reviewable.
2. **Works in both load modes.** Isolated (worker) and direct (main process).
   Anything you write must work in both, or fail loudly and readably in the one it
   does not support.
3. **Declares what it uses.** Capabilities, `engines`, `discordPermissions` and
   the per-guild `settings` schema. An undeclared RPC call is denied at runtime,
   so a missing declaration is a broken plugin, not a warning.
4. **Handles absence.** `getUser()` and `getChannel()` return `null` for a
   departed member or deleted channel **even for a required option**. Every
   resolved option gets a null check.
5. **Respects Discord's limits.** Content 2000, embed description 4096, 25 fields,
   6000 total embed text, 100 messages per bulk delete, 3-second interaction
   window.
6. **Has tests for the bug it fixes.** A regression test that fails before your
   change and passes after it.
7. **Is testable offline.** No live Discord, MongoDB or network in `npm test`.
   Ship a mock `ctx` — copy the template's `test/mock-ctx.js` rather than inventing
   one.
8. **Bumps `version`** in both `plugin.json` and `package.json`: patch for fixes,
   minor for new commands or settings, major for breaking manifest or API changes.
9. **Is readable.** Short commit subjects in Conventional Commit form. A reviewer
   should be able to tell what changed from the subject line alone.

**Full guide:** [`CREATE-PLUGIN.md`](CREATE-PLUGIN.md)
**Template:** [`adb-plugin-template`](https://github.com/AdvancedDiscordBot/adb-plugin-template)

---

## 🤝 Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. If you are an AI coding agent,
read [`AGENTS.md`](AGENTS.md) — it contains hard rules, including not touching
this repository for plugin work.

### AI assistance: allowed, low-effort volume: not

Using an AI assistant to help you write, review or refactor code is **welcome**.
What is not welcome is a stream of unreviewed, unreproduced pull requests.

The bar is the same for a human or an agent:

- **You must have run the code.** Not "it should work" — you ran it, you saw the
  output, you pasted it. A PR whose author cannot describe the observed behaviour
  will be closed.
- **You must understand your diff.** If you cannot explain why each changed line
  is there, do not open the PR.
- **One change per PR.** No drive-by reformatting, no unrelated "while I was in
  there" edits.
- **No speculative PRs.** "I think this might be a problem" is an issue, not a
  pull request.
- **No reformatting or boilerplate commits** generated to look busy.
- **Describe the reasoning, not the diff.** A body that restates `git diff` adds
  nothing. Say what was broken, what you observed, and why this is the right fix.

PRs that are machine-generated without the author having run or understood the
change will be closed with a short explanation and not reviewed further. This is
about accountability, not about tools — a genuinely good AI-assisted PR is
indistinguishable from a good human one, and it is welcome.

Report a security vulnerability through [`SECURITY.md`](SECURITY.md), not as a
public issue.

---

## ⚙️ How It Works

```
Discord Gateway ─┐
                 ├─► PluginManager ─► hooks ─► scheduler ─► dashboard
MongoDB ─────────┘        │
                          ├─► isolated plugin  (worker_thread, gated RPC)
                          └─► direct plugin     (main process, raw client)
```

- **`core/PluginManager`** discovers plugins from `node_modules/adb-plugin-*/` and
  the local `plugins/`, sorts them by declared dependencies, and registers their
  commands and events.
- **`core/rpc/`** brokers the resource surface an isolated plugin can reach.
  Every call is checked against that plugin's declared capabilities.
- **`core/PluginContext`** is the only API a plugin gets. It is sealed — a plugin
  cannot mutate the runtime context.
- **Per-guild gating** is applied on the hot path for events, hooks and commands,
  so an npm plugin that a server has not enabled does no work there.
- **`plugins/administration`** is the dashboard host and the only plugin inside
  this repository.

More: [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`DOCUMENTATION.md`](DOCUMENTATION.md)

---

## 🔧 Configuration

Every variable the code actually reads. `.env` is gitignored — never commit it.

| Variable | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token |
| `CLIENT_ID` | for deploy | Application id, used to register commands |
| `GUILD_ID` | recommended | Your test server; makes command sync instant |
| `MONGODB_URI` | yes | Database connection string |
| `OWNER_IDS` | yes | Comma-separated user ids allowed to install/uninstall plugins |
| `SESSION_SECRET` | for dashboard | Signs dashboard sessions |
| `PLUGIN_ISOLATION` | no | `false` loads every plugin in the main process. Default is isolation on |
| `BOT_API_ENABLED` | no | Serves the HTTP API and dashboard |
| `BOT_API_PORT` | no | API port (default `3000`) |
| `BOT_API_BASE_URL` | no | Externally reachable API base URL |
| `DISCORD_OAUTH_CLIENT_ID` | for dashboard | OAuth client id |
| `DISCORD_OAUTH_CLIENT_SECRET` | for dashboard | OAuth client secret |
| `DISCORD_OAUTH_REDIRECT_URI` | for dashboard | OAuth callback URL |
| `DASHBOARD_REDIRECT_URL` | for dashboard | Where to send users after login |
| `CORS_ORIGIN` | no | Allowed dashboard origin |
| `PLUGIN_REGISTRY_URL` | no | Marketplace registry JSON URL |
| `DEBUG` | no | Verbose logging |
| `TRIAL_MODE` | no | Disables destructive admin actions |
| `INVITE_FORCE_ADMIN` | no | Grants admin to the bot on join |
| `WATCHDOG_PORT` | no | Dev-only watchdog control API port |

---

## 🧪 Testing

```bash
npm test                                    # 483 platform tests
npm run test:dashboard                      # dashboard runtime checks
npm --prefix plugins/administration/web run build
```

The full plugin-runtime check boots the real bot with real Mongoose models
against a disposable database and exercises every plugin's registered commands
and event handlers:

```bash
docker run -d --name adb-verify-mongo -p 127.0.0.1:32768:27017 \
  --tmpfs /data/db:rw,size=512m mongo:7 --quiet --bind_ip_all

ADB_PLUGIN_WORKSPACE=/path/to/your/plugin/checkouts \
ADB_INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:32768/adb_verify_plugins \
npm run test:integration

docker rm -f adb-verify-mongo
```

It refuses any MongoDB that is not on loopback with a database name starting
`adb_verify_`, and drops only the database it created.

**Offline checks do not prove live behaviour.** Gateway authorisation, channel
permissions, role hierarchy, OAuth redirects and audio playback still need a
human in a real server. The check also has
[known mock limitations](docs/VERIFICATION.md#known-limitations-of-the-integration-check)
worth reading before you debug a failure.

---

## 📚 Docs

| Document | Covers |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Hard rules for AI coding agents |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute, what gets accepted |
| [`LOCAL-SETUP.md`](LOCAL-SETUP.md) | Running the bot and a plugin locally |
| [`CREATE-PLUGIN.md`](CREATE-PLUGIN.md) | Plugin authoring guide |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Runtime architecture |
| [`DOCUMENTATION.md`](DOCUMENTATION.md) | Commands and plugin reference |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Test commands and their limits |
| [`REGISTRY-SETUP.md`](REGISTRY-SETUP.md) | Running a plugin registry |
| [`SECURITY.md`](SECURITY.md) | Reporting a vulnerability |

---

## 👤 Maintainer

**DeadIndian** — [@DeadIndian](https://github.com/DeadIndian)

---

<div align="center">

## 📄 License

**AGPL-3.0-only** — see [LICENSE](LICENSE). If you run a modified version of this
bot as a service, you must publish your modifications.

<sub>Built by <a href="https://github.com/DeadIndian">DeadIndian</a></sub>

</div>