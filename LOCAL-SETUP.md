# Local Setup — run ADB and a plugin on your own machine

This is the setup a contributor should complete **before** changing any plugin
code. It gets you a bot you fully own, running against your own Discord server
and your own database, with the plugin you want to work on loaded from local
source.

Nothing here touches production. Never use someone else's Discord application,
token, or database.

- [0. What you need](#0-what-you-need)
- [1. Create your own Discord application](#1-create-your-own-discord-application)
- [2. Create your own MongoDB](#2-create-your-own-mongodb)
- [3. Clone the bot](#3-clone-the-bot)
- [4. Configure `.env`](#4-configure-env)
- [5. Install the plugin you are working on](#5-install-the-plugin-you-are-working-on)
- [6. Start the bot and check it is alive](#6-start-the-bot-and-check-it-is-alive)
- [7. Deploy slash commands](#7-deploy-slash-commands)
- [8. Run the tests](#8-run-the-tests)
- [9. Enable the plugin for your server](#9-enable-the-plugin-for-your-server)
- [10. Troubleshooting](#10-troubleshooting)

---

## 0. What you need

| Tool | Version | Notes |
|---|---|---|
| Node.js | **20+** (22 or 24 recommended) | `node -v` |
| npm | 9+ | ships with Node |
| MongoDB | 7.x, or Docker | local, Docker, or a free cloud sandbox |
| Docker | any recent | optional; only for MongoDB and for disposable test DBs |
| A Discord account | — | you will create your own test server |

Check your toolchain:

```bash
node -v && npm -v && (docker --version || echo "docker not installed")
```

---

## 1. Create your own Discord application

**Do this yourself. Never copy the maintainer's token, client id or OAuth secret,
and never commit yours.**

1. Go to <https://discord.com/developers/applications> → **New Application**.
   Name it anything, e.g. `my-adb-dev`.
2. On **Bot** → **Reset Token** → copy it. This is your `DISCORD_TOKEN`.
   Treat it like a password.
3. Still on **Bot**, copy the **Application ID**. This is your `CLIENT_ID`.
   Enable these three privileged gateway intents:
   - **Server Members Intent**
   - **Message Content Intent**
   - **Presence Intent**
4. On **OAuth2 → URL Generator**, tick the scopes `bot` and
   `applications.commands`. Tick at least the permissions `Manage Roles`,
   `Manage Channels`, `Manage Messages`, `Moderate Members`, `Embed Links`.
   Open the generated URL to invite the bot to **your own** test server.
   This is your `DISCORD_OAUTH_CLIENT_ID`.
5. On **OAuth2 → Client**, generate a client secret. This is your
   `DISCORD_OAUTH_CLIENT_SECRET`. Add the redirect
   `http://localhost:3000/auth/discord/callback` (or the port you use below).
   This step is only needed if you want the web dashboard.
6. Create a server for testing (**Server Settings → Create Server**). Invite your
   bot to it. Put it above any roles it must be able to assign.
7. From Discord settings (enable Developer Mode) → right-click the server →
   **Copy Server ID**. This is your `GUILD_ID`. Right-click yourself → **Copy
   User ID**. This is your `OWNER_IDS` (comma-separate for more than one).

> Slash commands register instantly in your own guild, so testing is fast. They
> propagate globally over Discord's command sync (can take up to an hour) — which
> is exactly why you should always pass `GUILD_ID`.

---

## 2. Create your own MongoDB

Pick one. All three are fine; the Docker one is the least setup.

### Option A — Docker (recommended for a throwaway dev DB)

```bash
docker run -d --name adb-dev-mongo \
  -p 127.0.0.1:27017:27017 \
  --restart unless-stopped \
  mongo:7
```

Verify:

```bash
docker exec adb-dev-mongo mongosh --quiet --eval 'db.runCommand({ping:1}).ok'   # -> 1
```

Your URI is `mongodb://127.0.0.1:27017/adb_dev`.

To wipe it completely later:

```bash
docker rm -f adb-dev-mongo
```

### Option B — local MongoDB service

```bash
sudo systemctl start mongod        # or: brew services start mongodb-community
```

Your URI is `mongodb://127.0.0.1:27017/adb_dev`.

### Option C — free cloud sandbox

MongoDB Atlas free tier or any hosted sandbox. Put the connection string in
`.env` as `MONGODB_URI`. Never commit it.

---

## 3. Clone the bot

Clone **only the bot repository**, into its own directory:

```bash
mkdir -p ~/adb-work && cd ~/adb-work
git clone https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot.git
cd Advanced-Discord-Bot
```

Branch model — pick deliberately:

| Branch | Use it for |
|---|---|
| `main` | released, tagged versions. The safe default for local dev. |
| `beta` | the platform's integration branch. Use it if you need unreleased core changes. |

```bash
git checkout main          # or: git checkout beta
```

Keep this checkout **pristine**. Do not commit plugin code into it. Do not edit
its source. Use it as a runtime host for your plugin (see step 5).

```bash
npm install
```

---

## 4. Configure `.env`

```bash
cp .env.example .env
```

Fill it in:

```env
# ── Discord ──────────────────────────────────────────────────────────
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_test_server_id          # enables instant guild command sync

# ── Database ─────────────────────────────────────────────────────────
MONGODB_URI=mongodb://127.0.0.1:27017/adb_dev

# ── HTTP / dashboard ─────────────────────────────────────────────────
BOT_API_ENABLED=true
BOT_API_PORT=3210
DASHBOARD_REDIRECT_URL=http://localhost:3000
DISCORD_OAUTH_CLIENT_ID=your_application_id
DISCORD_OAUTH_CLIENT_SECRET=your_client_secret
DISCORD_OAUTH_REDIRECT_URI=http://localhost:3210/auth/discord/callback
SESSION_SECRET=<generate: openssl rand -hex 32>

# Comma-separated Discord user IDs allowed to install/uninstall plugins.
# This is the top privilege tier. Set at least your own ID.
OWNER_IDS=your_user_id

# ── Optional ─────────────────────────────────────────────────────────
GEMINI_API_KEY=            # only for the AI assistant
PLUGIN_REGISTRY_URL=https://raw.githubusercontent.com/AdvancedDiscordBot/registry/main/plugins.json
```

Generate a session secret:

```bash
openssl rand -hex 32
```

`.env` is gitignored. Confirm it stays that way:

```bash
git check-ignore -v .env     # should print a .gitignore rule
git status --porcelain      # .env must NOT appear
```

---

## 5. Install the plugin you are working on

A plugin is a normal npm package named `adb-plugin-<name>`, discovered from
`node_modules/`. To run your **local edits**, install the directory with
`--no-save` so the bot's `package.json` is not modified.

```bash
# 1. clone the plugin repo as a sibling of the bot checkout
cd ~/adb-work
git clone https://github.com/AdvancedDiscordBot/adb-plugin-<name>.git

# 2. install the plugin's own dependencies first
cd adb-plugin-<name> && npm install && cd ..

# 3. install the plugin into the bot from that local directory
cd Advanced-Discord-Bot
npm install --no-save --package-lock=false ../adb-plugin-<name>
```

Verify the bot can see it:

```bash
ls node_modules/adb-plugin-<name>/plugin.json && cat node_modules/adb-plugin-<name>/plugin.json | head -20
```

Confirm nothing was written to the bot's manifest:

```bash
git status --porcelain     # must be empty
```

You should now have:

```
~/adb-work/
├── Advanced-Discord-Bot/        ← runtime host; leave its source alone
└── adb-plugin-<name>/           ← your working copy; all edits happen here
```

**All your changes go in the plugin repo.** Commit and push from there.

### Starting a brand-new plugin

```bash
cd ~/adb-work
git clone https://github.com/AdvancedDiscordBot/adb-plugin-template.git adb-plugin-mything
cd adb-plugin-mything
# rename everywhere: adb-plugin-template -> adb-plugin-mything
grep -rl 'adb-plugin-template' . --exclude-dir=.git | xargs sed -i 's/adb-plugin-template/adb-plugin-mything/g'
npm install
npm test          # must pass before you write anything
```

Then create an empty repository under the `AdvancedDiscordBot` org named
`adb-plugin-mything` and push. Do **not** add it to the bot repo.

---

## 6. Start the bot and check it is alive

```bash
npm start
```

Watch for:

- `MongoDB connected successfully`
- `[PluginManager] Loaded plugin adb-plugin-<name>`
- `Logged in as <your bot name>`
- `/health` returning `{"status":"ok"}`

```bash
curl -s http://localhost:3210/health
```

If a plugin fails to load, the reason is printed next to its name. Fix it in the
plugin repo, then restart.

---

## 7. Deploy slash commands

**Command *logic* hot-reloads; Discord command *registration* does not.** After
adding, renaming or removing a slash command you must deploy:

```bash
npm run deploy
```

This also builds the dashboard's web assets. To build those separately:

```bash
npm --prefix plugins/administration/web install
npm --prefix plugins/administration/web run build
```

Re-run `npm run deploy` in your plugin repo after every command change.

---

## 8. Run the tests

### In the plugin repo

```bash
cd ~/adb-work/adb-plugin-<name>
npm test
```

Runs offline: no Discord, no MongoDB, no Lavalink. It exercises the plugin in
both isolated and direct load modes. **These must pass before you push.**

### In the bot checkout

```bash
cd ~/adb-work/Advanced-Discord-Bot
npm test                        # platform unit tests
npm run test:dashboard          # dashboard runtime checks
```

### The full plugin runtime integration check

This boots the real bot with real Mongoose models and a real (disposable)
MongoDB, runs every plugin's registered commands and event handlers, then
restarts the bot to check persistence. Discord I/O is simulated in memory.

```bash
docker run -d --name adb-verify-mongo \
  -p 127.0.0.1:32768:27017 --tmpfs /data/db:rw,size=512m \
  mongo:7 --quiet --bind_ip_all
sleep 8

cd ~/adb-work/Advanced-Discord-Bot
ADB_PLUGIN_WORKSPACE=~/adb-work \
ADB_INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:32768/adb_verify_plugins \
npm run test:integration

docker rm -f adb-verify-mongo
```

`ADB_PLUGIN_WORKSPACE` points at the directory holding your plugin checkouts, so
the check tests **your edited source** rather than npm releases. It refuses any
MongoDB that is not loopback or whose database name does not start with
`adb_verify_`.

> **Read [`docs/VERIFICATION.md`](./docs/VERIFICATION.md#known-limitations-of-the-integration-check)
> before you act on a failure here.** The simulated Discord API is incomplete, so
> some correct plugins fail for mock reasons. Known gaps are listed there.

---

## 9. Enable the plugin for your server

npm-installed plugins are **off by default per server**. Turn them on in the
dashboard:

1. Open `http://localhost:3000` and sign in with Discord.
2. Pick your test server.
3. **Plugins** → find your plugin → **Enable**.

Or via the API, as an `OWNER_IDS` user:

```bash
curl -s -X POST http://localhost:3210/api/guild/$GUILD_ID/plugins/adb-plugin-mything/enable \
  -H "Content-Type: application/json" -b cookies.txt
```

Each plugin's settings have their own panel, generated from the `settings` block
in `plugin.json`. If a setting does not appear, the plugin has not declared it.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Discord login failure` / `An invalid token was provided` | `DISCORD_TOKEN` is wrong or was reset in the Developer Portal. Re-copy it. |
| Slash commands do not appear | Run `npm run deploy`. Confirm `GUILD_ID` is set — without it Discord syncs globally and can take an hour. |
| `Plugin isolation enabled (worker_threads)` and a plugin cannot see `ctx.client` | Expected. Isolated plugins use `ctx.discord`. See `adb-plugin-template/README.md`. |
| Plugin never loads | Read the error next to `Loaded plugin`. A missing declared capability or an `engines` mismatch aborts that plugin only — the bot keeps running. |
| Mongoose `Schema hasn't been registered` | Restart the bot after changing a plugin's model schema. Cached models are compiled at load. |
| `Model.init() ... buffering timed out` | `MONGODB_URI` is unreachable. `docker ps` / `systemctl status mongod`. |
| Changes to a plugin do not appear | You edited the wrong copy, or did not restart. Commands also need `npm run deploy`. |
| `EADDRINUSE 3210` | Another bot instance is running. `ss -ltnp \| grep 3210`. **Never run a second gateway with a production token.** |
| Changes to plugin *source* have no effect | `npm install --no-save ../adb-plugin-<name>` links the directory; re-run it after adding new files the bot must resolve. |
| Integration check: "Permission lookup timed out" | A harness/mock limitation, not your plugin. See `docs/VERIFICATION.md`. |

---

## 11. Before you open a PR

- [ ] `npm test` passes in the plugin repo
- [ ] `npm test` and `npm run test:integration` pass in the bot checkout
- [ ] You actually ran the feature in your test server and can describe what happened
- [ ] `git status` in the **bot** repo is clean — you changed nothing there
- [ ] No tokens, no `.env`, no database URLs in the diff
- [ ] `plugin.json` version bumped, and the change is described in the PR body
- [ ] You know whether this is a plugin repo or a core change — and it is a plugin repo

Reference: [`AGENTS.md`](./AGENTS.md) · [`CONTRIBUTING.md`](./CONTRIBUTING.md)
· [`docs/VERIFICATION.md`](./docs/VERIFICATION.md)