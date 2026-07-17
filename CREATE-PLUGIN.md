# Creating an ADB Plugin

This guide covers everything you need to create a plugin for the ADB Discord bot.
Plugins can run in two modes: **direct** (in the main process) or **isolated** (in a sandboxed worker thread).

---

## Quick Start

```bash
mkdir plugins/adb-plugin-my-plugin
cd plugins/adb-plugin-my-plugin

cat > plugin.json << 'EOF'
{
  "name": "adb-plugin-my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "YourName",
  "main": "index.js",
  "requiresRestart": false,
  "capabilities": {
    "storage": ["own-collection"],
    "discord": ["SendMessages"]
  }
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

---

## Plugin Isolation

ADB supports running plugins in sandboxed **worker threads** for security isolation.
When isolation is enabled on the bot, plugins declared with `"isolation": true` (or by default) run in their own V8 isolate.

### What isolation gives you

- **Process isolation** — your plugin code cannot access `process.env`, `require('fs')`, or other Node.js built-ins directly
- **Capability gating** — you can only use resources your `plugin.json` declares
- **Resource limits** — memory and execution time are capped per plugin
- **Crash containment** — a plugin crash doesn't take down the bot

### What changes in isolated mode

| Direct mode | Isolated mode |
|-------------|---------------|
| `ctx.client` available | `ctx.client` is `null` — use `ctx.discord` |
| `ctx.db` is real DB | `ctx.db` routes through RPC |
| `require('mongoose')` works | Not available — use `ctx.defineModel()` |
| `require('discord.js')` works | Not available — use `ctx.discord` |
| `ctx.config.env` has env vars | Empty — secrets never leave Core |

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

  // ✅ Works in both modes — ctx.discord routes through RPC when isolated
  await ctx.discord.sendToChannel(channelId, { content: "Hello!" });

  // ❌ Only works in direct mode
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
  "isolation": true,
  "capabilities": {
    "storage": ["own-collection"],
    "discord": ["SendMessages", "EmbedLinks"],
    "hooks": ["subscribe"]
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
| `isolation` | boolean | `true` = run in worker thread. `false` = opt out of isolation. Default: `true` when isolation is enabled on the bot. |
| `capabilities` | object | Declare what resources your plugin needs (see below) |
| `discordPermissions` | array | Discord permission flags for the bot invite link |
| `configSchema` | object | JSON Schema for server admin settings UI |

---

## Capability System

Capabilities are declared in `plugin.json` and enforced at runtime. A plugin can only use RPC methods whose capabilities it has declared.

### Available capabilities

| Category | Values | Grants access to |
|----------|--------|-----------------|
| `storage` | `own-collection` | `ctx.db.getPluginConfig()`, `ctx.db.updatePluginConfig()`, `ctx.defineModel()` |
| `storage` | `read-profiles` | `ctx.db.getUserProfile()`, `ctx.db.getTopUsers()`, `ctx.db.getServerConfig()` |
| `storage` | `write-profiles` | `ctx.db.updateUserProfile()`, `ctx.db.addXP()`, `ctx.db.updateServerConfig()` |
| `discord` | `SendMessages` | `ctx.discord.sendToChannel()`, `ctx.discord.sendDM()` |
| `discord` | `EmbedLinks` | Sending embeds |
| `discord` | `GuildInfo` | `ctx.discord.getGuild()`, `ctx.discord.getMember()` |
| `discord` | `ChannelInfo` | `ctx.discord.fetchChannel()` |
| `discord` | `ManageRoles` | `ctx.discord.addRole()`, `ctx.discord.removeRole()` |
| `discord` | `ModerateMembers` | Timeout, kick, ban |
| `discord` | `ManageMessages` | Delete messages |
| `discord` | `AddReactions` | Add reactions |
| `hooks` | `subscribe` | `ctx.hooks.on()` |
| `hooks` | `emit` | `ctx.hooks.emitHook()` |
| `scheduler` | `cron` | `ctx.scheduler.schedule()`, `ctx.scheduler.cancel()` |

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

### ctx.discord — Discord API (isolated-mode safe)

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

```javascript
ctx.registerEvent("guildMemberAdd", async (eventPayload) => {
  // In isolated mode, eventPayload is a serialized object:
  // { id, user: { id, tag, username, avatarURL }, guildId, nickname, roles }
  const guildId = eventPayload.guildId || eventPayload.guild?.id;
  const config = await ctx.db.getPluginConfig(guildId, "my-plugin");
  // ...
});
```

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

```javascript
await ctx.scheduler.schedule("cleanup", "0 * * * *", async () => {
  // Runs every hour
  ctx.logger.info("Running hourly cleanup...");
});
```

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
2. **`ctx.config.env` is empty** — secrets never leave Core. If you need AI, use the broker's AI proxy (coming soon)
3. **`require()` only works for your own plugin files** — you can `require('./lib/helper')` but not `require('discord.js')`
4. **`ctx.overrideCommand()` is not available** — use `ctx.registerCommand()` instead
5. **Event payloads are serialized** — they're plain objects, not Discord.js class instances
6. **`ctx.hooks.onAny()` is not available** — use `ctx.hooks.on('specificHookName', handler)` instead

---

## Publishing Your Plugin

1. **Test locally** — Place in `plugins/` folder
2. **Create npm package** with `"peerDependencies": { "discord.js": ">=14.0.0" }`
3. **Publish to npm** — `npm publish`
4. **Submit to marketplace** — Add to the ADB Plugin Registry

---

## Examples

See these plugins for reference:
- `plugins/adb-plugin-welcome/` — Welcome messages with card generation
- `plugins/adb-plugin-automod/` — Auto-moderation with timed actions
- `plugins/adb-plugin-autorole/` — Automatic role assignment
- `plugins/administration/` — Admin dashboard with web UI
