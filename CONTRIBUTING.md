# 🤝 Contributing to Advanced Discord Bot

Thank you for helping improve **Advanced Discord Bot (ADB)** — a self-hosted
Discord bot platform with a dashboard, a plugin system and a plugin marketplace.

ADB is not part of any external contribution program. GitHub issues and pull
requests are the source of truth.

> **🤖 AI coding agents: read [`AGENTS.md`](./AGENTS.md) first.** It contains hard
> rules — most importantly: **plugin features never go into this repository**, and
> you must ask the user to set the bot up locally and test the plugin before
> changing code. Then read this document for the human-level detail.

---

## 📌 The one thing to get right first

**This repository is the platform core. It is not a plugin.**

| You want to… | Do it in |
|---|---|
| Add a user-facing feature or fix a plugin bug | **your own `adb-plugin-<name>` repository** |
| Start a brand-new plugin | **a new repo copied from [`adb-plugin-template`](https://github.com/AdvancedDiscordBot/adb-plugin-template)** |
| Add or update a marketplace entry | the [`registry`](https://github.com/AdvancedDiscordBot/registry) repo (`plugins.json`) |
| Change the loader, plugin manager, broker, RPC, dashboard host, or plugin API | **this repository** |

The only plugin inside this repo is `plugins/administration` (the dashboard
itself). Every other plugin lives in its own repository and is installed from npm.

**Do not** create plugin folders in `plugins/`, do not add plugin commands to this
repo's `commands/`, and do not open plugin pull requests here. If you are unsure
which side of the line a change falls on, ask before writing code.

---

## 🎯 Project philosophy

### Own the bot

- **Self-hosted first** — you decide where the bot and its database run.
- **No vendor lock-in** — source, data and deployment stay under your control.
- **Privacy-aware** — server data lives in your MongoDB instance.
- **Composable** — the core stays lean; plugins specialise it.

### Build a platform

- **Core platform** — lean Discord.js runtime, plugin loader, isolation, database,
  scheduling, dashboard host. No user-facing commands live in core.
- **Dashboard** — admin UI for guild settings, plugin management and activity.
- **Marketplace** — registry-backed discovery for installable community modules.
- **Plugin API** — commands, overrides, events, hooks, config schemas, jobs,
  models, per-guild enablement, capability-gated RPC.

---

## 📊 Contribution priorities

**High**

- Bug fixes and reliability work
- Plugin manager, hook bus, registry, dashboard polish
- Security and permission handling
- Documentation and onboarding
- Tests for command, plugin and dashboard behaviour

**Medium**

- New core/platform capabilities, when they belong in the base runtime
- Observability, logs, admin feedback
- Performance, internationalisation, accessibility

**Plugin-first**

Features that are useful but not essential to the base runtime should be built as
plugins. Plugin examples and marketplace-ready packages are very welcome.

---

## 🚀 Getting started

> Full, copy-pasteable walkthrough — own Discord app, own MongoDB, own test
> server, install your plugin, deploy commands, run the tests:
> **[`LOCAL-SETUP.md`](./LOCAL-SETUP.md)**.

Short version:

```bash
# 1. the bot (runtime host only — leave its source alone)
git clone https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot.git
cd Advanced-Discord-Bot && npm install
cp .env.example .env      # fill in YOUR Discord app + YOUR MongoDB

# 2. the plugin you are working on (sibling directory)
cd ..
git clone https://github.com/AdvancedDiscordBot/adb-plugin-<name>.git
cd adb-plugin-<name> && npm install && npm test

# 3. run the plugin from local source
cd ../Advanced-Discord-Bot
npm install --no-save --package-lock=false ../adb-plugin-<name>
npm run deploy
npm start
```

### Prerequisites

- Node.js **20+** (22 or 24 recommended)
- MongoDB (local, Docker, or cloud sandbox)
- **Your own** Discord application, bot token and client id
- Google Gemini API key only if you are testing AI features

**Never** use the maintainer's Discord application, token, OAuth secret or
database. **Never** commit `.env`, tokens or connection strings.

### Gateway intents

Enable **Server Members**, **Message Content** and **Presence** in the Developer
Portal. Invite with the `bot` and `applications.commands` scopes.

### Branches and releases

| Repo | Branch | Meaning |
|---|---|---|
| `Advanced-Discord-Bot` | `beta` | development / integration |
| `Advanced-Discord-Bot` | `main` | released; commits are tagged |
| `adb-plugin-*` | `main` | development; published to npm on release |

**Core releases are tags.** Nothing reaches a deployment until `beta` is merged to
`main` and tagged. Plugin repositories are independent and version themselves.

---

## 🔁 Development workflow

```bash
git checkout -b fix/short-description
npm test                        # plugin repo
# ...change code...
npm test                        # again, and make sure it still passes
git add -A && git commit -m "fix(thing): what changed and why"
git push origin fix/short-description
```

Then open a PR containing:

- **what** changed and **why**
- **how you tested it** — commands run, servers used, real output quoted
- **what you could not test** and why
- screenshots or logs for dashboard/UI changes
- a `plugin.json` version bump for plugin repos

---

## 🔌 Working on a plugin

Every plugin is its own repository:

```bash
git clone https://github.com/AdvancedDiscordBot/adb-plugin-<name>.git
cd adb-plugin-<name>
npm install
npm test            # must pass before you change anything
```

Recommended path for a **new** plugin: clone
[`adb-plugin-template`](https://github.com/AdvancedDiscordBot/adb-plugin-template),
rename it `adb-plugin-<yourname>`, and keep its `test/` harness. The template's
[README](https://github.com/AdvancedDiscordBot/adb-plugin-template/blob/main/README.md)
is the authoritative description of the plugin API.

### The two load modes — this is the thing people get wrong

|  | isolated (`isolation: true`, default) | direct (`isolation: false`) |
|---|---|---|
| runs in | a `worker_thread` | the main process |
| `ctx.client` | `null` | the real client |
| `ctx.discord` | present (RPC-backed) | absent |
| Discord data | serialized plain values | real discord.js instances |

Write code that works in **both**, or fail loudly and readably in the mode you do
not support. `system:raw-client` is an explicit, owner-trusted opt-out — not a
way to paper over an inconvenient scheduler signature.

### Plugin contract

```json
{
  "name": "adb-plugin-mything",       // must start with adb-plugin-
  "version": "1.0.0",
  "manifestVersion": 2,
  "main": "index.js",
  "isolation": true,
  "capabilities": { "storage": ["own-collection"], "discord": ["SendMessages"] },
  "engines": { "core": ">=2.0.0" }
}
```

```js
async function load(ctx) {
  ctx.registerCommand({
    data: { name: "hello", description: "Say hello" },
    async execute(interaction) { await interaction.reply("Hello!"); },
  });
}
module.exports = { load };
```

The runtime enforces what you declare. A missing capability, an `engines`
mismatch or a malformed manifest disables **only that plugin** — the bot keeps
running and logs the reason.

Reference: [`CREATE-PLUGIN.md`](./CREATE-PLUGIN.md).

---

## ✅ Development guidelines

- **Core ships no user-facing commands.** Keep core changes to the platform.
- Handle missing guild/member/channel data gracefully — `getUser()` and
  `getChannel()` return `null` for deleted channels and departed members, even
  for **required** options. Never dereference them unchecked.
- Respect Discord limits: content 2000, embed description 4096, 25 fields,
  6000 total embed text, 100-message bulk delete, 3-second interaction window.
- Never log tokens, session secrets, connection strings, or user private data.
- Respect the per-guild enable gate: read `config.enabled === true` before any
  independent scheduled side effect, including DMs.
- Update documentation whenever behaviour, setup, commands or the plugin API change.
- Run the tests before submitting a PR.

---

## 🧪 Testing

```bash
# in the plugin repo — offline, no Discord/Mongo/Lavalink, both load modes
npm test

# in the bot checkout
npm test
npm run test:dashboard
npm --prefix plugins/administration/web run build

# full plugin runtime check: real models + disposable MongoDB, fake Discord I/O
ADB_PLUGIN_WORKSPACE=/path/to/your/plugin/parent \
ADB_INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:32768/adb_verify_plugins \
npm run test:integration
```

Read [`docs/VERIFICATION.md`](./docs/VERIFICATION.md) before interpreting an
integration-check failure — **the simulated Discord API is incomplete and has
known gaps**, and a correct plugin can fail for mock reasons.

Offline checks do **not** prove gateway authorisation, Developer Portal intents,
channel permissions, role hierarchy, OAuth redirects, or audio playback. Verify
those in a real test guild. Music additionally needs a live Lavalink v4 node.

---

## 🐛 Reporting bugs

One issue per bug. File it in the repository that owns the code — `adb-plugin-<name>`
or `Advanced-Discord-Bot`. Use the `bug` label and include: repo, version/commit,
minimal reproduction, the **actual** log output, and expected behaviour. If you
cannot reproduce it, say so instead of guessing. See
[`SECURITY.md`](./SECURITY.md) for vulnerabilities — do not open a public issue
for a security report.

---

## 🗺️ Documentation map

| Document | What it covers |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | Hard rules for AI coding agents |
| [`LOCAL-SETUP.md`](./LOCAL-SETUP.md) | Running the bot + a plugin locally |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | This document |
| [`README.md`](./README.md) | Project overview and setup |
| [`DOCUMENTATION.md`](./DOCUMENTATION.md) | Commands + official plugin reference |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Runtime architecture |
| [`CREATE-PLUGIN.md`](./CREATE-PLUGIN.md) | Plugin authoring guide |
| [`docs/VERIFICATION.md`](./docs/VERIFICATION.md) | Test commands + harness limits |
| [`REGISTRY-SETUP.md`](./REGISTRY-SETUP.md) | Marketplace registry |
| [`SECURITY.md`](./SECURITY.md) | Vulnerability reporting |

---

## 📜 Code of conduct

Follow [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Keep discussions respectful,
focused and useful.

---

## 🤖 AI assistance: welcome, low-effort volume: not

Using an AI assistant — to write code, review a diff, explain a subsystem, or
draft an issue — is **encouraged and welcome**. There is no policy against it, and
none of the rules above treat an AI-assisted contribution as lesser.

What is not welcome is **volume without verification**. The standard is not which
tool you used; it is whether you can stand behind the result.

**Always acceptable**

- Using an agent to explore an unfamiliar codebase
- Having one review or explain your diff before you send it
- Drafting tests, then reading and fixing them yourself
- Getting help with the plugin API, manifest fields or the local setup

**Not acceptable — closed without review**

- Opening a PR for code you have not run
- Restating `git diff` in the description instead of explaining the reasoning
- Speculative changes ("this might be a bug") submitted as pull requests
- Drive-by reformatting mixed into a feature or fix
- Reformatting-only or boilerplate commits submitted to look productive
- A diff the author cannot explain line by line

**The bar for every PR, human or agent**

1. You ran it, and you paste the real output.
2. You can say why each changed line is there.
3. The PR does one thing.
4. You say what you could **not** test.

If you used an agent heavily, consider saying so in the PR body. It is not
required and it is not held against you — it is useful context for the reviewer,
and honest disclosure is the whole point of this section.

Pull requests opened by a bot where no human has run the code will be closed with
a short explanation. This is about accountability, not about tools.