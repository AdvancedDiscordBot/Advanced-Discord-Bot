# Creating an ADB Plugin

What a plugin is, how to write one, and what the platform guarantees. Plugins run
in two modes: **direct** (main process) or **isolated** (a `worker_thread`), and
anything you write has to work in both.

> **🤖 AI coding agents: read [`AGENTS.md`](./AGENTS.md) before this guide.** A
> plugin is **never** created inside the `Advanced-Discord-Bot` repository. If you
> were told to `mkdir plugins/adb-plugin-…` in the bot repo, that advice is wrong.
> Stop, and re-read [`AGENTS.md`](./AGENTS.md).

---

## Where plugin code lives

**Every plugin is its own repository** under the
[`AdvancedDiscordBot`](https://github.com/AdvancedDiscordBot) org, named
`adb-plugin-<name>`, published to npm as `adb-plugin-<name>`.

The `Advanced-Discord-Bot` repository is the **platform core**. Its `plugins/`
directory contains exactly one plugin — `administration`, the dashboard host — and
that is not a place to add yours. At runtime, `PluginManager` discovers plugins in
two places:

- `node_modules/adb-plugin-*/plugin.json` — how plugins are actually installed;
- the local `plugins/` directory — for linking during development only.

So creating a plugin means creating a repository and installing it from npm, not
adding a folder to the bot repo.

---

## Quick Start

```bash
# 1. Start from the maintained template (it ships the manifest, models and a
#    working offline test harness).
git clone https://github.com/AdvancedDiscordBot/adb-plugin-template.git
mv adb-plugin-template adb-plugin-my-plugin
cd adb-plugin-my-plugin

# 2. Rename the package everywhere it is referenced.
grep -rl 'adb-plugin-template' . --exclude-dir=.git \
  | xargs sed -i 's/adb-plugin-template/adb-plugin-my-plugin/g'

# 3. Confirm the shipped tests still pass before you change anything.
npm install && npm test
```

Then create an empty repository named `adb-plugin-my-plugin` under the
`AdvancedDiscordBot` org and push. To run it inside a local bot checkout:

```bash
cd /path/to/Advanced-Discord-Bot
npm install --no-save --package-lock=false ../adb-plugin-my-plugin
npm run deploy && npm start
```

See [`LOCAL-SETUP.md`](./LOCAL-SETUP.md) for the complete local workflow, and
[`AGENTS.md`](./AGENTS.md) for the rules an AI agent must follow.

<details>
<summary>Or write <code>plugin.json</code> by hand</summary>

```bash
mkdir -p adb-plugin-my-plugin && cd adb-plugin-my-plugin

cat > plugin.json << 'EOF'
{
  "name": "adb-plugin-my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "YourName",
  "main": "index.js",
  "requiresRestart": false,
  "manifestVersion": 2,
  "process": { "model": "pooled", "maxExecutionMs": 5000, "memoryMb": 128, "persistentReason": null },
  "engines": { "core": ">=2.0.0" },
  "capabilities": {
    "storage": ["own-collection"],
    "discord": ["SendMessages"]
  },
  "permissions": {
    "storage": ["own-collection"],
    "discord": ["SendMessages"],
    "network": { "outbound": [] },
    "filesystem": { "read": [], "write": [] },
    "childProcess": false,
    "nativeAddons": false
  },
  "discordPermissions": ["SendMessages"]
}
EOF

cat > index.js << 'EOF'
async function load(ctx) {
  ctx.logger.info("My plugin loaded!");

  ctx.registerCommand({
    data: {
      name: "mycommand",
      description: "My first command"
    },
    async execute(interaction) {
      await interaction.reply("Hello from my plugin!");
    }
  });
}

module.exports = { load };
EOF
```

Add `package.json` with `"name": "adb-plugin-my-plugin"` and a `test` script that
runs your offline harness. Prefer copying `adb-plugin-template` — it already has
both.

</details>

---

## Plugin Isolation

ADB runs plugins in sandboxed **worker threads** for security. Isolation is
**enabled by default** on the bot (opt out at the bot level with
`PLUGIN_ISOLATION=false`).

**What decides whether YOUR plugin is isolated — it's not a manifest flag you
control:**

| How the plugin is loaded | Runs |
|--------------------------|------|
| Installed from npm (`node_modules/adb-plugin-*`) | **Isolated** (worker) — always, enforced |
| Ships in the bot repo (`plugins/`, e.g. the dashboard) | Direct (in-process) |
| Declares `capabilities.system: ["raw-client"]` | Direct (in-process), owner-approved |

An npm-installed plugin **cannot** opt out of isolation with `"isolation": false`
— that would be a trivial sandbox bypass. The only sanctioned escape hatch is
the owner-approved `system:raw-client` escalation (see below). Assume your
published plugin runs isolated and write it isolation-safe.

### What isolation gives you

- **A narrowed environment** — the worker is spawned with `env:` set to only the
  variables your plugin was granted, so the bot's `process.env` is not visible.
- **Capability gating** — you can only reach resources your `plugin.json`
  declares. An undeclared RPC call is **denied at runtime**; the broker replies
  with `Missing capability: <category>:<Value>` and tells you which key to add.
- **A registry of violations** — 5 capability violations inside a 60s rolling
  window suspend the plugin; its calls are then refused with *"Plugin is
  suspended pending review after repeated capability violations"*, and the
  dashboard can show the recent violations and reinstate the plugin.
- **Crash containment** — a plugin crash doesn't take down the bot. A worker is
  respawned up to a fixed number of consecutive times before the plugin is given
  up on, and it is respawned with only your granted env. ⚠️ But note: a worker
  that **throws during `load()`** (e.g. calls an RPC it didn't declare a
  capability for) is respawned, so a missing capability shows up as a repeating
  crash/deny in the logs, not a one-line error.

> **Known gap — `process` limits are declared but not applied.**
> `process.maxExecutionMs` and `process.memoryMb` are range-checked and clamped at
> manifest-validation time, but the worker is spawned with **fixed**
> `resourceLimits` (512 MB old-generation, 32 MB young-generation, 4 MB stack)
> taken from a constant in `core/rpc/worker-manager.js`, not from your manifest,
> and the RPC client's per-call timeout is its own default rather than
> `maxExecutionMs`. Declare sensible values and expect the current numbers to be
> the ones that matter; do not rely on them as a hard quota. `core/rpc/resource-limits.js`
> and `core/rpc/process-router.js` exist but are not wired into the spawn path.

**What isolation does not give you.** A `worker_thread` is not an OS sandbox.
`require('fs')`, `require('net')`, `require('child_process')` and friends still
*resolve* inside the worker. What actually constrains a plugin is:

- the broker denying undeclared RPC calls at runtime, and
- `core/manifest-crossvalidate.js`, which parses your source with `acorn` at
  install time and **rejects the manifest** if the code imports a gated
  Node built-in you have not declared permission for (`fs` needs
  `filesystem.read`/`write`, `net`/`http`/`https`/`tls` need
  `network.outbound`, `child_process`/`cluster`/`worker_threads` need
  `childProcess: true`; `vm`, `module` and `repl` are never allowed), or
  `require()`s a package that is missing from `declaredDependencies`.

So: treat every installed plugin as trusted code, and keep `declaredDependencies`
and `permissions` honest. `docs/VERIFICATION.md` says the same about relying on
isolation for hostile code.

### What changes in isolated mode

| Direct mode | Isolated mode |
|-------------|---------------|
| `ctx.client` available | `ctx.client` is `null` — use `ctx.discord` |
| no `ctx.discord` | `ctx.discord` exists (5 methods, see below) |
| `ctx.db` is real DB | `ctx.db` routes through RPC |
| `ctx.config` is the plugin's per-guild config | `ctx.config` is `{ env }` — granted vars only |
| `ctx.commands` is the `Collection` | `ctx.commands` is `null`; register via `ctx.registerCommand()` |
| `require('mongoose')`, `require('discord.js')`, `require('node-cron')` resolve | the same `require`s resolve, but Core has no idea you did it — anything you use must be in `declaredDependencies`, and the Discord/DB/cron APIs must be the `ctx.*` surfaces |
| `ctx.scheduler.schedule(name, expr, fn)` / `unschedule(name)` | `ctx.scheduler.schedule(expr, cb, name)` → `taskId` / `cancel(taskId)` |
| `ctx.overrideCommand()` works | warns and does nothing |
| `ctx.hooks.onAny()` works | not available — use `ctx.hooks.on(name, handler)` |
| `process.env` is the bot's env | only granted vars |
| event payloads are discord.js instances | serialized plain objects |

### Writing dual-mode plugins

Your plugin can work in **both modes** by using the isolation-safe APIs:

```javascript
async function load(ctx) {
  // ✅ Works in both modes
  ctx.registerCommand({ ... });
  ctx.registerEvent("guildMemberAdd", async (eventPayload) => {
    // In isolated mode, eventPayload is a serialized object
    // In direct mode, it's the real Discord.js member object
    const guildId = eventPayload.guildId || eventPayload.guild?.id;
    const userId = eventPayload.userId || eventPayload.user?.id;
    // ...
  });

  // ✅ Works in both modes — ctx.db routes through RPC when isolated
  const config = await ctx.db.getPluginConfig(guildId, "my-plugin");

  // ⚠️ ctx.discord is the ISOLATED-mode Discord surface (routes through RPC).
  //    It does NOT exist in direct mode — there, use ctx.client instead.
  await ctx.discord.sendToChannel(channelId, { content: "Hello!" });

  // ❌ Only works in direct mode (ctx.client is null when isolated)
  // const guild = ctx.client.guilds.cache.get(guildId);
  // await guild.channels.fetch(channelId);
}
```

---

## Plugin Structure

```
adb-plugin-my-plugin/
├── plugin.json       # Required: Plugin manifest
├── index.js          # Required: Entry point with load(ctx)
├── commands/         # Optional: Slash command files
├── models/           # Optional: Mongoose schemas (namespaced automatically)
├── lib/              # Optional: Helper modules
├── package.json      # Optional: npm dependencies
└── README.md         # Optional: Documentation
```

---

## plugin.json Reference

```json
{
  "name": "adb-plugin-my-plugin",
  "displayName": "My Plugin",
  "version": "1.0.0",
  "description": "What your plugin does",
  "author": "YourName",
  "main": "index.js",
  "requiresRestart": false,
  "manifestVersion": 2,
  "process": { "model": "pooled", "maxExecutionMs": 5000, "memoryMb": 128, "persistentReason": null },
  "engines": { "core": ">=2.0.0" },
  "capabilities": {
    "storage": ["own-collection"],
    "discord": ["SendMessages", "EmbedLinks"],
    "hooks": ["subscribe"]
  },
  "permissions": {
    "storage": ["own-collection"],
    "discord": ["SendMessages", "EmbedLinks"],
    "hooks": ["subscribe"],
    "network": { "outbound": [] },
    "filesystem": { "read": [], "write": [] },
    "childProcess": false,
    "nativeAddons": false
  },
  "discordPermissions": ["SendMessages", "EmbedLinks"],
  "configSchema": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": true }
    }
  }
}
```

### Key fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Package name (must start with `adb-plugin-`) |
| `isolation` | boolean | Advisory only. `false` is **ignored** for npm-installed plugins (they're always isolated unless they declare `system:raw-client`). |
| `manifestVersion` | number | Set to `2` for the current manifest. v1 manifests (no version) are auto-migrated but you should author v2. |
| `process` | object | v2 resource block: `{ model: "pooled"\|"persistent"\|"oneshot", maxExecutionMs, memoryMb, persistentReason }` |
| `capabilities` | object | Declare what resources your plugin needs (see below) — **the broker enforces this** |
| `permissions` | object | v2 mirror of capabilities + `network.outbound` host allowlist, `filesystem`, `childProcess`, `nativeAddons` |
| `discordPermissions` | array | Discord permission flags for the bot invite link |
| `engines` | object | Version constraints: `{ core: ">=2.0.0", plugins: { "administration": ">=2.0.0" } }` — see **Plugin Dependencies**. In practice you should always declare it: `normalize()` fills in `engines.core: null` when you omit the block, and `validateManifestV2()` then rejects the manifest with *"engines.core must be a valid semver range, got null"*. That check runs in the integration check (`npm run test:integration`), not in the runtime load path, so an omitted block loads fine but fails verification. |
| `settings` | object | Dashboard settings schema + command-permission toggle — see **Plugin Settings** |
| `webUi` | object | Plugin-hosted frontend: `{ port, label, icon, memberPages }` — requires `web:host-ui` capability — see **webUi block** |
| `dashboard` | object | Optional RBAC block: `{ permissions: [...] }` for finer-grained dashboard permission keys — see **Dashboard Access (RBAC)** |
| `configSchema` | object | JSON Schema `properties`. Not how the settings UI is built — that comes from `settings.schema` — but the API still reads it for per-field **secret detection** (`secret`/`writeOnly`/`format: "password"`, which make a value write-only over HTTP) and as a fallback source of per-key validation constraints. |
| `dependsOn`, `dependencies` | array | Additional load-order dependencies, unioned with `engines.plugins` by `getDependencies()`. No version constraint attached. |

> `capabilities` (the v1-style category→values block) is what the runtime broker
> checks on every RPC. `permissions` (the v2 block) additionally drives the
> network host allowlist and the install-time risk disclosure. Author **both**,
> keeping the `discord`/`storage`/`hooks`/`scheduler`/`system` values identical
> between them. See
> [`adb-plugin-template/plugin.json`](https://github.com/AdvancedDiscordBot/adb-plugin-template/blob/main/plugin.json)
> for the canonical shape.

---

## Capability System

Capabilities are declared in `plugin.json` and enforced at runtime. A plugin can only use RPC methods whose capabilities it has declared.

### Available capabilities

Authoritative capability → RPC-method map (the broker denies any method whose
capability you didn't declare):

| Capability | RPC methods it unlocks |
|------------|------------------------|
| `storage:own-collection` | `ctx.db.getPluginConfig/updatePluginConfig/getAllPluginConfigs` (3), the five ticket methods `createTicket`/`getTickets`/`getTicketById`/`updateTicket`/`updateTicketStatus`, and 11 model ops behind `ctx.defineModel()` — `find`, `findOne`, `findById`, `create`, `updateOne`, `updateMany`, `findOneAndUpdate`, `deleteOne`, `deleteMany`, `countDocuments`, `save` (19 methods total; `markModified` is reached through the `save` params) |
| `storage:read-profiles` | `getUserProfile`, `getTopUsers`, `getUserRank`, `checkRoleRewards`, `getServerConfig`, `getServerStats`, `getUserPoints`, `getPointsLeaderboard` |
| `storage:write-profiles` | `updateUserProfile`, `addXP`, `updateUserRoles`, `givePoints`, `updateServerConfig` |
| `discord:SendMessages` | `ctx.discord.sendToChannel()`, `ctx.discord.sendDM()`, and all ten `interaction.*` methods (`reply`, `deferReply`, `editReply`, `followUp`, `fetchReply`, `deleteReply`, `update`, `deferUpdate`, `showModal`, `respond`) |
| `discord:GuildInfo` | `ctx.discord.getGuild()`, `ctx.discord.getMember()` |
| `discord:ChannelInfo` | `ctx.discord.fetchChannel()` |
| `hooks:subscribe` | `ctx.hooks.on()` (RPC `hooks.on`) |
| `hooks:emit` | `ctx.hooks.emitHook()` (RPC `hooks.emit`) |
| `scheduler:cron` | `ctx.scheduler.schedule()`, `ctx.scheduler.cancel()` |
| `network:outbound-http` | `network.fetch` — additionally gated by the `permissions.network.outbound` host allowlist (empty = reach nothing) |
| `system:env` / `system:bot-token` / `system:raw-client` | Escalations — see below |

`discord.sendEmbed`, `discord.addReaction`, `discord.deleteMessage`,
`discord.timeout`, `discord.kick`, `discord.ban`, `discord.addRole` and
`discord.removeRole` are real RPC methods with real capabilities
(`discord:EmbedLinks`, `AddReactions`, `ManageMessages`, `ModerateMembers`,
`KickMembers`, `BanMembers`, `ManageRoles`), but Core does not expose them on
`ctx.discord` — there is no accessor to call them with. Embeds still work,
because `sendToChannel`/`sendDM` accept an `embeds` array under
`discord:SendMessages` alone. The rest are reachable only from a
`system:raw-client` plugin using the real client.

The remaining `discord` capability values — `ManageChannels`, `ManageGuild`,
`ViewAuditLog`, `MentionEveryone`, `ViewChannel`, `UseApplicationCommands`,
`ReadMessageHistory`, `AttachFiles`, `Connect`, `Speak`, `MoveMembers` — have no
RPC method at all. The sandbox cannot perform those; a plugin that needs them
must run direct via `system:raw-client`. They still appear on the invite link if
listed in `discordPermissions`.

`ai:gemini-proxy` and `web:host-ui` are declared in the capability schema. No
shipped plugin declares `gemini-proxy`; `web:host-ui` is covered under
**webUi block** below.

### Escalation capabilities (`system`) — HIGH RISK

Some plugins genuinely can't work over the sandboxed RPC surface — they need
voice connections, raid-lockdown channel edits, cross-plugin introspection, the
bot token, or their own env secrets. For those, declare a `system` capability.
Each triggers a **high-risk disclosure** the server owner must approve at
install, and grants strictly more than the sandbox normally allows:

| Value | Effect |
|-------|--------|
| `system:env` | `ctx.config.env` is populated with the bot's env (minus core infra secrets). Plugin still runs isolated. |
| `system:bot-token` | Adds `DISCORD_TOKEN` to `ctx.config.env`. Plugin still runs isolated. |
| `system:raw-client` | Plugin runs **UN-ISOLATED in the main process** with the real `ctx.client`, full env, and host access. The escape hatch for voice/lockdown/introspection plugins. |

```json
{
  "capabilities": {
    "system": ["raw-client"],
    "discord": ["BanMembers", "KickMembers", "ModerateMembers", "ManageChannels", "ManageGuild"]
  }
}
```

A `system:raw-client` plugin uses the **direct-mode** API (`ctx.client`, real
discord.js objects in events, `require("discord.js")`) — it is not sandboxed, so
the isolated-mode restrictions below do not apply to it.

### Example: moderation plugin

```json
{
  "capabilities": {
    "storage": ["own-collection", "read-profiles", "write-profiles"],
    "discord": ["ModerateMembers", "ManageMessages", "SendMessages", "GuildInfo"],
    "hooks": ["subscribe", "emit"]
  }
}
```

---

## Context API

### ctx.db — Database access

```javascript
// Plugin config (requires storage:own-collection)
const config = await ctx.db.getPluginConfig(guildId, "my-plugin");
await ctx.db.updatePluginConfig(guildId, "my-plugin", { enabled: true });

// User profiles (requires storage:read-profiles / write-profiles)
const profile = await ctx.db.getUserProfile(userId, guildId);
await ctx.db.addXP(userId, guildId, 100, "bonus", "Daily reward");

// Server config
const server = await ctx.db.getServerConfig(guildId);
await ctx.db.updateServerConfig(guildId, { aiEnabled: true });
```

### ctx.discord — Discord API (isolated mode only)

`ctx.discord` exists **only in isolated mode** — it's the sandboxed RPC surface
for Discord operations. In direct mode there is no `ctx.discord`; use `ctx.client`
(real discord.js) instead.

```javascript
// Send a message
await ctx.discord.sendToChannel(channelId, { content: "Hello!" });

// Send with embeds
await ctx.discord.sendToChannel(channelId, {
  content: "Welcome!",
  embeds: [{ title: "Server Rules", description: "Be nice", color: 0x6366F1 }]
});

// Send a DM
await ctx.discord.sendDM(userId, { content: "Hey there!" });

// Fetch guild info
const guild = await ctx.discord.getGuild(guildId);
// Returns: { id, name, memberCount, icon, iconURL }

// Fetch member info
const member = await ctx.discord.getMember(guildId, userId);
// Returns: { id, user: { id, tag, username, avatarURL }, nickname, roles }
```

### ctx.defineModel — Namespaced database models

```javascript
const MyModel = ctx.defineModel("myModel", {
  userId: String,
  guildId: String,
  data: String,
  createdAt: { type: Date, default: Date.now }
});

// CRUD operations
const doc = await MyModel.create({ userId: "123", guildId: "456", data: "hello" });
const found = await MyModel.findOne({ userId: "123" });
await MyModel.updateOne({ userId: "123" }, { data: "updated" });
await MyModel.deleteOne({ userId: "123" });
const count = await MyModel.countDocuments({ guildId: "456" });
```

Also available: `findById`, `updateMany`, `findOneAndUpdate`, `deleteMany`.

`find()` and `findOne()` return a **query object**, so mongoose-style chaining
works before you await:

```javascript
const recent = await MyModel.find({ guildId })
  .sort({ createdAt: -1 })
  .limit(10)
  .lean();          // .skip(), .select() and .exec() are there too
const rows = await MyModel.find({ guildId });   // awaited directly → plain array
```

Two ways to persist:

```javascript
// 1. Mutate a doc you fetched, then save it. markModified marks a Mixed subpath.
found.data = "changed";
found.markModified("nested");
await found.save();

// 2. Or hand the model the doc plus the fields that changed.
await MyModel.save(found, { data: "changed" });
```

> **Isolated-mode model gotchas (they bite):**
> - Awaiting a query yields plain objects, not Mongoose documents. `doc.save()`
>   is present on hydrated docs (it round-trips through RPC), but
>   `doc.validate()`, virtuals and instance methods are not.
> - **No `.populate()`** over RPC. Resolve the referenced id yourself.
> - Schemas are sent to Core and rehydrated there, so use plain scalar field
>   types (`String`, `Number`, `Date`, `Boolean`) with `default`, `required`,
>   `enum`, `unique`/`index`. Exotic types, custom validators, methods and
>   virtuals do **not** cross the worker boundary.
> - The returned document has `markModified` and `save` defined as
>   non-enumerable properties, so spreading it (`{...doc}`) drops them.

### ctx.registerCommand — Slash commands

```javascript
ctx.registerCommand({
  data: {
    name: "greet",
    description: "Greet a user",
    options: [{
      name: "user",
      type: 6, // USER
      description: "Who to greet",
      required: true
    }]
  },
  async execute(interaction) {
    const user = interaction.options.getUser("user");
    await interaction.reply(`Hello, ${user}!`);
  }
});
```

### ctx.registerEvent — Discord events

In isolated mode the payload is a **serialized plain object**, not a discord.js
instance — no methods (`.kick()`, `.reply()`, `.delete()`), no lazy `.fetch()`,
no `.guild`/`.channel` objects. Only the fields Core serializes are present.

**Event names:** any value from discord.js's `Events` enum, plus the deprecated
`"ready"` string, which Core still accepts for older plugins. Core subscribes to
the client event only for the names a plugin actually registers. Between them
the shipped plugins register 24 of them — `channelCreate`, `channelDelete`,
`channelUpdate`, `guildBanAdd`, `guildBanRemove`, `guildCreate`, `guildDelete`,
`guildMemberAdd`, `guildMemberRemove`, `guildMemberUpdate`, `guildUpdate`,
`interactionCreate`, `inviteCreate`, `inviteDelete`, `messageCreate`,
`messageDelete`, `messageDeleteBulk`, `messageReactionAdd`,
`messageReactionRemove`, `messageUpdate`, `raw`, `roleCreate`, `roleDelete`,
`roleUpdate`, `voiceStateUpdate` — but any valid name will be forwarded.

The handler is called as `handler(...args, client)`. In isolated mode the raw
`client` is that trailing `null`.

**Serialized `GuildMember` payload** (guildMemberAdd/Remove/Update):
```js
{
  id: "userId",
  user: { id, tag, username, bot, avatarURL },
  nickname, guildId,
  roles: ["roleId", ...],   // array of ids
  joinedAt
}
```

**Serialized `Message` payload** (messageCreate/Delete/Update):
```js
{
  id, content,
  author: { id, tag, username, bot },
  guildId, channelId
}
```

```javascript
ctx.registerEvent("guildMemberAdd", async (member) => {
  const guildId = member.guildId;          // NOT member.guild.id in isolated mode
  const userId  = member.user?.id || member.id;
  // To act, go through RPC — e.g. send a welcome:
  const config = await ctx.db.getPluginConfig(guildId, "adb-plugin-my-plugin");
  if (config?.data?.channelId) {
    await ctx.discord.sendToChannel(config.data.channelId, { content: `Welcome <@${userId}>!` });
  }
});
```

> Note: account-age / `user.createdAt`, full role objects, message attachments,
> reactions, and voice channel state are **not** in the serialized payload. A
> plugin that needs them must declare `system:raw-client` and run direct.

### ctx.hooks — Inter-plugin communication

```javascript
// Listen for hooks from other plugins
ctx.hooks.on("onLevelUp", async ({ user, newLevel, guild }) => {
  ctx.logger.info(`${user.tag} leveled up to ${newLevel}!`);
});

// Emit a hook for other plugins
await ctx.hooks.emitHook("myPluginEvent", { data: "something" });
```

### ctx.scheduler — Recurring tasks

Isolated mode signature: `schedule(cronExpression, callback, name)` — **expression
first, name last** — and it resolves to a `taskId`. `cancel()` takes that
`taskId`, not the name you passed. Core runs the cron and invokes your callback
on tick; a bundled `node-cron` will not work in an isolated worker, so always use
`ctx.scheduler`.

```javascript
const taskId = await ctx.scheduler.schedule("0 * * * *", async () => {
  ctx.logger.info("Running hourly cleanup...");
}, "cleanup");      // "cleanup" is a label, for Core's bookkeeping

await ctx.scheduler.cancel(taskId);
```

> **Direct mode differs.** When your plugin runs direct (`system:raw-client` or
> in-repo), `ctx.scheduler` is the real `TaskScheduler`, whose signature is
> **name-first**: `schedule(name, cronExpression, fn)`, and cancellation is
> `unschedule(name)` — there is no `cancel()`. Only isolated mode uses the
> `schedule(expression, callback, name)` / `cancel(taskId)` shim shown above.
> Because the two differ in both argument order and cancel name, wrap the call
> once and use that wrapper everywhere.

### ctx.logger — Namespaced logging

```javascript
ctx.logger.info("Plugin loaded");
ctx.logger.warn("Something unexpected");
ctx.logger.error("Something went wrong", error);
```

---

## Isolated Mode Differences

When running in a worker thread, keep these in mind:

1. **`ctx.client` is `null`** — use `ctx.discord` for all Discord operations
2. **`ctx.config.env` is empty** unless you declare `system:env` or `system:bot-token` (owner-approved). Secrets never leave Core otherwise.
3. **`require()` only works for your own plugin files** — you can `require('./lib/helper')` but not `require('discord.js')`, `require('mongoose')`, or `require('node-cron')`. Bundle no runtime deps that must load inside the worker.
4. **`ctx.overrideCommand()` is not available** — use `ctx.registerCommand()` instead
5. **Event payloads are serialized** — they're plain objects, not Discord.js class instances (see the event payload shapes below)
6. **`ctx.hooks.onAny()` is not available** — use `ctx.hooks.on('specificHookName', handler)` instead
7. **`ctx.scheduler`, not `node-cron`** — Core runs the cron; signature is `schedule(expression, callback, name)`

---

## Plugin Settings & Dashboard Integration

Plugins can expose settings, per-command permissions, and an optional hosted web UI — all surfaced in the left sidebar of the admin dashboard under a **PLUGINS** section.

### settings block

Add a `settings` block to `plugin.json` to expose configuration fields in the dashboard:

```json
"settings": {
  "commandPermissions": true,
  "schema": [
    { "key": "announceChannel", "type": "channel", "label": "Announcement channel" },
    { "key": "staffRole",       "type": "role",    "label": "Staff role" },
    { "key": "xpRate",          "type": "number",  "label": "XP per message", "default": 10 },
    { "key": "enabled",         "type": "boolean", "label": "Feature enabled", "default": true },
    { "key": "welcomeMsg",      "type": "string",  "label": "Welcome message" },
    { "key": "mode",            "type": "select",  "label": "Mode", "default": "normal",
      "options": [ { "value": "normal", "label": "Normal" }, { "value": "strict", "label": "Strict" } ] }
  ]
}
```

**Field types:** `string`, `number`, `boolean`, `channel`, `role`, `select`
(requires `options`). These are exactly the six the dashboard knows how to
render.

**Secret fields.** A field with `"secret": true` (or `"writeOnly": true`, or
`"format": "password"`) is stripped from every API response and replaced by a
boolean in a separate `configuredSecrets` map. The stored value stays readable
by your plugin via `ctx.db.getPluginConfig`, but the dashboard can never read it
back — so a blank submit does not overwrite what is already saved.

`commandPermissions: true` adds a per-command table to the settings page where admins can toggle each command on/off and restrict it to specific roles.

**Reading saved config in your plugin:**

```javascript
async function load(ctx) {
  ctx.registerEvent("interactionCreate", async (interaction) => {
    const cfg = await ctx.db.getPluginConfig(interaction.guildId, "adb-plugin-my-plugin");
    const channel = cfg?.announceChannel;
    const rate    = cfg?.xpRate ?? 10;
  });
}
```

Config is stored in `PluginConfig.data` (MongoDB). The dashboard writes to the same document. The `_commands` sub-key is reserved for per-command permission data — do not write to it directly.

---

### webUi block — hosting a plugin frontend

A plugin can run its own web server and have the watchdog reverse-proxy it at `/plugin-ui/<name>/*`:

```json
"capabilities": {
  "web": ["host-ui"]
},
"permissions": {
  "web": ["host-ui"]
},
"webUi": {
  "port": 3210,
  "label": "My Plugin UI",
  "icon": "LayoutDashboard"
}
```

**Requirements:**

- `permissions.web` must include `"host-ui"` — this triggers the owner-approval flow at install (same as `system:raw-client`).
- `webUi.port` must be in the range **3100–4999** (avoids the bot's HTTP port 3000/3009 and watchdog 3008).
- The plugin must start its own HTTP server on that port and register it with the bot at startup:

```javascript
async function load(ctx) {
  const http = require("http");

  const server = http.createServer((req, res) => {
    res.end("<h1>My Plugin UI</h1>");
  });

  server.listen(3210, "127.0.0.1", async () => {
    // Register with the bot so the watchdog proxy table is updated
    await fetch("http://localhost:" + (process.env.BOT_API_PORT || 3009) + "/api/plugin-ui/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "adb-plugin-my-plugin", port: 3210 }),
    });
  });
}
```

Once registered, the dashboard sidebar shows an **"Open UI"** link that opens `/plugin-ui/adb-plugin-my-plugin/` — proxied by the watchdog to `localhost:3210`.

> **Security:** The watchdog only proxies to a port that the bot explicitly registered. A plugin cannot proxy to an arbitrary port by claiming it in the manifest — the bot validates the port matches the manifest declaration before registering.

> **Isolation note:** a **hosted** page needs `webUi.port` bound on a real port,
> which an isolated worker thread cannot do. A plugin serving its own UI must
> therefore also declare `system:raw-client` (direct mode) or be an in-repo
> `local` plugin. A **rendered** member page has no such requirement — it needs
> no port, so an isolated plugin can ship one.

#### Member portal pages (`webUi.memberPages`)

The admin dashboard is for people who *configure* the server. The **member
portal** (`/me`) is the self-service surface for everyone else — a member logs
in, picks a server they're in, and sees pages showing **their own** data (my
rank, my reminders, my tickets). It is not gated on any dashboard permission:
any member of the guild can reach it.

There are two kinds of page, and you almost certainly want the first.

**A platform-rendered page — no web server needed.** You declare a model and a
view; the platform reads the model, renders the page, and scopes every query to
the caller. This needs **no `webUi.port`** and no `system:raw-client`, so an
isolated plugin can do it. All 16 registered plugins do it this way.

```json
"webUi": {
  "memberPages": [
    {
      "path": "/me/rank",
      "label": "My Rank",
      "icon": "Star",
      "source": { "model": "Level", "scope": "member", "limit": 1 },
      "view": {
        "type": "stat",
        "stats": [
          { "field": "level", "label": "Level" },
          { "field": "xp",    "label": "Total XP" }
        ]
      }
    }
  ]
}
```

The model is your own `ctx.defineModel()` name. The platform queries it with
`{ guildId, userId }` — **the caller's identity, forced** — applies your `sort`
and a `limit` capped at 500, and returns the rows. You cannot widen that scope
from the client. A declared `view.actions` entry also becomes a row action the
member can invoke; the client chooses only *which* declared action and *which*
returned row id, never the operation or the field.

**A hosted page.** Give `webUi` a `port` and the portal opens your own server at
`/plugin-ui/<name><path>?guildId=<id>`, with the member's session cookie riding
along so your handler can scope to *this member in this guild*. Resolve who the
member is from the session the same way the admin API does.

Rules for both:
- `path` is required and must start with `/`; `label` is required; `icon` is
  optional (a lucide-react icon name). Duplicate paths are dropped.
- A page is treated as rendered when it sets `rendered: true` or declares both
  `source.model` and `view.type`. A page that is neither rendered nor backed by
  a `webUi.port` is silently skipped, so a hosted page without a port will not
  show up.
- A page only appears in a guild's portal when the plugin is **enabled for that
  guild** — the same per-guild gate as everything else. Gateable plugins are off
  until an admin enables them.

---

## Plugin Dependencies

Plugins can declare version constraints on the ADB core platform and on other plugins using the `engines` block.

### engines block

```json
"engines": {
  "core": ">=2.0.0",
  "plugins": {
    "administration": ">=2.0.0"
  }
}
```

- `engines.core` — semver range checked against the bot's `package.json` version. If unmet, the plugin refuses to load with a clear error.
- `engines.plugins.<name>` — semver range checked against the named plugin's loaded `version`. If the dependency is not loaded or its version is too old, the plugin refuses to load.

**Why `engines.plugins.administration >= 2.0.0`?**

The `settings`, `commandPermissions`, and `webUi` features are served by the administration dashboard plugin. Version 2.0.0 is the first version that understands those manifest blocks. A plugin using them should declare this constraint so it fails loudly on an old install rather than silently having a dead settings page.

### Load ordering

`engines.plugins` names are treated as load-order dependencies — a plugin that requires `administration` will always load *after* `administration`, regardless of discovery order. Circular dependencies are detected at startup and cause both plugins to fail with a clear error.

### Difference from `declaredDependencies`

| Field | Purpose |
|-------|---------|
| `declaredDependencies` | npm packages your code `require()`s — used for manifest↔code cross-validation |
| `engines.plugins` | sibling ADB plugins your plugin needs at runtime — enforces load order + version |

### Worked example — `adb-plugin-template`

The template plugin demonstrates all three features together:

```json
"engines": {
  "core": ">=2.0.0",
  "plugins": { "administration": ">=2.0.0" }
},
"settings": {
  "commandPermissions": true,
  "schema": [
    { "key": "welcomeMessage",  "type": "string",  "label": "Welcome message", "default": "Hello!" },
    { "key": "announceChannel", "type": "channel", "label": "Announcement channel" },
    { "key": "staffRole",       "type": "role",    "label": "Staff role" },
    { "key": "maxPerDay",       "type": "number",  "label": "Max uses per day", "default": 10 },
    { "key": "featureEnabled",  "type": "boolean", "label": "Feature enabled", "default": true },
    { "key": "mode",            "type": "select",  "label": "Mode", "default": "normal",
      "options": [ { "value": "normal", "label": "Normal" }, { "value": "strict", "label": "Strict" } ] }
  ]
}
```

This produces a settings page in the dashboard sidebar with all six field types, plus a per-command enable/role table for every command the plugin registers.

---

## Dashboard Access (RBAC)

The dashboard is multi-tenant. Two RBAC facts affect every plugin author; both
work **with zero manifest changes** — the `dashboard` block is opt-in only.

### Your plugin is off per-guild until an admin enables it

When a host owner installs your (isolated, npm) plugin it becomes **available**
but is **disabled in every guild by default**. Each guild's admin flips it on
from the dashboard **Plugins** page. Until then, the platform gate blocks your
plugin's events, hooks, and commands for that guild — you don't write any code
for this; it's enforced at the platform chokepoints.

Consequences:
- Don't assume your handlers run in a guild just because the plugin is
  installed. A guild that hasn't enabled you sees nothing from you.
- `raw-client` (direct-mode) and in-repo `core`/`local` plugins are **not**
  gateable — they're always on. The API rejects toggling them
  (`not_toggleable`). See the isolation table above.

### Dashboard permission keys

Guild admins grant Discord roles fine-grained access to the dashboard. Every
loaded plugin **automatically** contributes two permission keys — no manifest
needed:

| Key | Gates |
|-----|-------|
| `plugin.<name>.view` | seeing your plugin's dashboard pages |
| `plugin.<name>.configure` | changing your plugin's settings for a guild |

If you need finer-grained keys (e.g. a high-risk action), declare them in a
`dashboard.permissions` block:

```json
"dashboard": {
  "permissions": [
    { "key": "resetXp", "label": "Reset user XP", "description": "Wipe a member's XP." },
    { "key": "export",  "label": "Export data" }
  ]
}
```

Rules:
- Keys are **always re-namespaced** under `plugin.<name>.` — you cannot mint a
  permission outside your own namespace (declaring `plugins.manage` becomes
  `plugin.<name>.plugins.manage`, which grants nothing platform-level).
- Declared keys are **added to** the automatic `view`/`configure` pair, not
  substituted for it. You keep both by default; a declared key that collides
  with one of them is ignored.
- Entries may be a plain string (`"export"`) or `{ key, label, description }`. A
  key with no `label` gets `<DisplayName>: <key>`.

There is no runtime enforcement helper to call — the platform filters the
sidebar and 403s the API based on the resolved permission set. Your plugin code
doesn't check permissions itself.

---

## Publishing Your Plugin

1. **Test locally** — the [`adb-plugin-template`](https://github.com/AdvancedDiscordBot/adb-plugin-template) repo ships a local mock-`ctx` harness you can run your plugin against with no bot/Mongo. (Note: this repo's own `npm test` runs the platform test suite — broker/manifest/permissions — not your plugin.) Otherwise, test inside a real bot checkout.
2. **Smoke-test in a real bot** — install into the pre-prod bot's `node_modules` and confirm it loads isolated with no `Missing capability` denials or crash-loops in the log.
3. **Bump the version** — npm forbids republishing an existing version. Patch-bump every publish.
4. **`npm publish`** — the package name must start with `adb-plugin-`; `PluginManager` auto-discovers `node_modules/adb-plugin-*`.
5. **Register** (optional) — add an entry with your `npmPackage` to the ADB plugin registry (`REGISTRY-SETUP.md`).

> On a version bump the install screen shows a **risk-card diff** — exactly which
> capabilities the new version adds or drops — so keep the `capabilities` block
> honest across versions.

---

## Reference plugins

The canonical, up-to-date examples live in their own repos under the
[`AdvancedDiscordBot`](https://github.com/AdvancedDiscordBot) org:

- **`adb-plugin-template`** — the isolation-ready scaffold; start here.
- **`adb-plugin-aegis`** — a `system:raw-client` (direct-mode) plugin: raid
  lockdown, anti-alt, channel edits — things the sandbox can't express.

The only plugin that ships inside this repo's `plugins/` is `administration`
(the dashboard); it loads direct because it's first-party, not because of any
flag.
