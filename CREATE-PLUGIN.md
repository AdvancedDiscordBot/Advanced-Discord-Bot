# Creating a ADB Plugin

This guide covers everything you need to create a plugin for the ADB Discord bot.

## Quick Start

```bash
# Create your plugin directory
mkdir plugins/adb-plugin-my-plugin
cd plugins/adb-plugin-my-plugin

# Create plugin.json
cat > plugin.json << 'EOF'
{
  "name": "adb-plugin-my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "YourName",
  "main": "index.js",
  "requiresRestart": false
}
EOF

# Create the entry point
cat > index.js << 'EOF'
async function load(ctx) {
  ctx.logger.info("My plugin loaded!");
  
  // Register a slash command
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

## Plugin Structure

```
adb-plugin-my-plugin/
├── plugin.json       # Required: Plugin manifest
├── index.js          # Required: Entry point
├── commands/         # Optional: Slash commands
├── models/           # Optional: Database schemas
└── README.md         # Optional: Documentation
```

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
  "port": 50001,
  "configSchema": {
    "type": "object",
    "properties": {
      "setting1": {
        "type": "string",
        "description": "A text setting"
      },
      "enabled": {
        "type": "boolean",
        "default": true
      },
      "count": {
        "type": "number",
        "minimum": 1,
        "maximum": 100
      },
      "mode": {
        "type": "string",
        "enum": ["easy", "medium", "hard"]
      }
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Package name (must start with `adb-plugin-`) |
| `displayName` | string | No | Human-readable name for marketplace |
| `version` | string | Yes | Semantic version |
| `description` | string | Yes | What your plugin does |
| `author` | string | Yes | Your name or organization |
| `main` | string | No | Entry point (default: `index.js`) |
| `requiresRestart` | boolean | No | If true, changes require bot restart |
| `port` | number | No | If set, exposes a web dashboard |
| `configSchema` | object | No | JSON Schema for settings UI |
| `permissions` | array | No | Internal capabilities (`db.read`, `db.write`, `commands.register`, `events.register`, …) |
| `discordPermissions` | array | No | Discord permissions your bot needs, as `PermissionsBitField.Flags` keys |

### discordPermissions

Declare the Discord permissions your plugin's code actually uses — e.g. a
moderation plugin that bans and deletes messages declares:

```json
"discordPermissions": ["BanMembers", "ModerateMembers", "ManageMessages", "SendMessages"]
```

Values must be exact discord.js flag names (`BanMembers`, `KickMembers`,
`ModerateMembers`, `ManageMessages`, `ManageChannels`, `ManageRoles`,
`ManageGuild`, `ManageWebhooks`, `SendMessages`, `AddReactions`,
`EmbedLinks`, `AttachFiles`, `ReadMessageHistory`, …). See the full list:
<https://discord.js.org/docs/packages/discord.js/main/PermissionFlagsBits:Variable>.

The bot ORs every enabled plugin's `discordPermissions` into a single
**permission integer** shown on the dashboard's Plugins page (copy it into
the Discord Developer Portal) and baked into the bot invite link. Declare
only what you use — over-declaring inflates the permissions users must grant.
Unknown flag names are ignored and surfaced as a load-time warning on the
plugin's card.

## The load Function

Your plugin must export a `load` function that receives the plugin context:

```javascript
async function load(ctx) {
  // ctx contains all available APIs
}

module.exports = { load };
```

## Plugin Context API

### ctx.client

Raw Discord.js client - full access to Discord API:

```javascript
// Get a guild
const guild = ctx.client.guilds.cache.get('guild_id');

// Listen to events
ctx.client.on('messageCreate', (message) => {
  console.log(message.content);
});
```

### ctx.db

Database access:

```javascript
// Get server config
const config = await ctx.db.getServerConfig(guildId);

// Query data
const users = await ctx.db.UserProfile.find({ guildId });
```

### ctx.registerCommand

Register a slash command:

```javascript
ctx.registerCommand({
  data: {
    name: "hello",
    description: "Say hello",
    options: [
      {
        name: "name",
        type: 3, // STRING
        description: "Your name",
        required: true
      }
    ]
  },
  async execute(interaction) {
    const name = interaction.options.getString("name");
    await interaction.reply(`Hello, ${name}!`);
  }
});
```

### ctx.overrideCommand

Override an existing command:

```javascript
ctx.overrideCommand("daily", async (originalExecute, command) => {
  return async (interaction) => {
    // Add custom logic before
    console.log("Daily command called!");
    
    // Call original
    const result = await originalExecute(interaction);
    
    // Add custom logic after
    await interaction.followUp("This was intercepted!");
    
    return result;
  };
});
```

### ctx.registerEvent

Listen to Discord events:

```javascript
ctx.registerEvent("messageCreate", async (message, client) => {
  if (message.content === "!ping") {
    await message.reply("Pong!");
  }
});
```

### ctx.defineModel

Define a namespaced database model:

```javascript
const MyModel = ctx.defineModel("myModel", {
  userId: String,
  data: String,
  createdAt: { type: Date, default: Date.now }
});

// Use it
const doc = await MyModel.create({ userId: "123", data: "hello" });
```

This creates a model named `plugin_adb-plugin-my-plugin_mymodel`.

### ctx.scheduler

Schedule recurring tasks:

```javascript
ctx.scheduler.schedule("my-task", "0 * * * *", async () => {
  // Runs every hour
  console.log("Scheduled task running!");
});
```

### ctx.hooks

Hook into bot events:

```javascript
ctx.hooks.on("onLevelUp", async ({ user, newLevel, guild }) => {
  // User leveled up!
  const channel = guild.systemChannel;
  await channel.send(`${user} leveled up to ${newLevel}!`);
});
```

### ctx.logger

Namespaced logging:

```javascript
ctx.logger.info("Plugin loaded");
ctx.logger.warn("Something unexpected");
ctx.logger.error("Something went wrong", error);
```

### ctx.config

Environment configuration (read-only):

```javascript
const token = ctx.config.env.DISCORD_TOKEN;
const mongoUri = ctx.config.env.MONGODB_URI;
```

## Creating Commands

### Basic Command

```javascript
ctx.registerCommand({
  data: {
    name: "greet",
    description: "Greet a user"
  },
  async execute(interaction) {
    await interaction.reply("Hello!");
  }
});
```

### Command with Options

```javascript
ctx.registerCommand({
  data: {
    name: "roll",
    description: "Roll a dice",
    options: [
      {
        name: "sides",
        type: 4, // INTEGER
        description: "Number of sides",
        minValue: 2,
        maxValue: 20
      }
    ]
  },
  async execute(interaction) {
    const sides = interaction.options.getInteger("sides") || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    await interaction.reply(`Rolled a ${sides}-sided die: ${roll}`);
  }
});
```

### Command with Subcommands

```javascript
ctx.registerCommand({
  data: {
    name: "economy",
    description: "Economy commands",
    options: [
      {
        name: "balance",
        description: "Check your balance",
        type: 1 // SUB_COMMAND
      },
      {
        name: "transfer",
        description: "Transfer coins",
        type: 1, // SUB_COMMAND
        options: [
          {
            name: "user",
            type: 6, // USER
            required: true
          },
          {
            name: "amount",
            type: 4, // INTEGER
            required: true
          }
        ]
      }
    ]
  },
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "balance") {
      // Handle balance
    } else if (subcommand === "transfer") {
      // Handle transfer
    }
  }
});
```

## Creating a Web Dashboard

Your plugin can expose its own web interface! When you declare a port in `plugin.json`, the admin dashboard will automatically show a "Dashboard" button linking to your plugin's web UI.

### Quick Setup

1. Declare the port in `plugin.json`:

```json
{
  "name": "adb-plugin-my-plugin",
  "port": 50001
}
```

2. Start a web server in your plugin:

```javascript
const fastify = require("fastify");

async function load(ctx) {
  const app = fastify();
  
  // Your API routes
  app.get("/api/status", async () => ({ status: "ok" }));
  
  // Start the server
  await app.listen({ port: 50001, host: "0.0.0.0" });
  ctx.logger.info("Dashboard running on http://localhost:50001");
}

module.exports = { load };
```

The dashboard will automatically appear in the Plugins page with a "Dashboard" button.

### Full Web Dashboard Example

Here's a more complete example with multiple routes and static files:

```javascript
const fastify = require("fastify");
const path = require("path");

async function load(ctx) {
  const app = fastify({ logger: false });
  
  // ============================================
  // API Routes
  // ============================================
  
  // Get plugin settings for a guild
  app.get("/api/settings/:guildId", async (request, reply) => {
    const { guildId } = request.params;
    const settings = await ctx.db.getPluginConfig(guildId, "adb-plugin-my-plugin");
    return settings?.data || {};
  });
  
  // Update plugin settings
  app.put("/api/settings/:guildId", async (request, reply) => {
    const { guildId } = request.params;
    const data = request.body || {};
    await ctx.db.updatePluginConfig(guildId, "adb-plugin-my-plugin", data);
    return { ok: true };
  });
  
  // Get stats
  app.get("/api/stats/:guildId", async (request, reply) => {
    const { guildId } = request.params;
    const count = await ctx.db.MyModel.countDocuments({ guildId });
    return { count };
  });
  
  // ============================================
  // Serve Static Files (React/Vue/HTML app)
  // ============================================
  const staticDir = path.join(__dirname, "public");
  app.register(require("@fastify/static"), {
    root: staticDir,
    prefix: "/",
    decorateReply: false,
  });
  
  // SPA fallback - serve index.html for unknown routes
  app.setNotFoundHandler(async (request, reply) => {
    const indexPath = path.join(staticDir, "index.html");
    return reply.code(200).type("text/html").send(require("fs").readFileSync(indexPath));
  });
  
  // ============================================
  // Start Server
  // ============================================
  await app.listen({ port: 50001, host: "0.0.0.0" });
  ctx.logger.info("Plugin dashboard: http://localhost:50001");
}

module.exports = { load };
```

### Plugin Web UI Best Practices

1. **Use unique ports** - Each plugin needs a unique port. Recommended range: 50001-50100

2. **Include authentication** - Your dashboard should validate Discord permissions:

```javascript
app.get("/api/verify", async (request, reply) => {
  const guildId = request.headers["x-guild-id"];
  const userId = request.headers["x-user-id"];
  
  // Check if user is admin in the guild
  const guild = ctx.client.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(userId);
  
  if (!member?.permissions.has("Administrator")) {
    return reply.code(403).send({ error: "Forbidden" });
  }
  
  return { ok: true };
});
```

3. **Proxy through main dashboard** (optional) - For production, you might want to proxy plugin dashboards through the main admin panel rather than exposing multiple ports.

4. **Clean up on unload** - Handle plugin unload to close your server:

```javascript
let server;

async function load(ctx) {
  const app = fastify();
  // ... setup routes
  
  await app.listen({ port: 50001, host: "0.0.0.0" });
  server = app;
  
  // Clean up when plugin is unloaded
  ctx.hooks.on("onPluginUnload", async ({ pluginName }) => {
    if (pluginName === "adb-plugin-my-plugin") {
      await server.close();
    }
  });
}
```

### Plugin Structure with Web UI

```
adb-plugin-my-plugin/
├── plugin.json
├── index.js              # Fastify server
├── public/               # Static web files
│   ├── index.html
│   ├── static/
│   │   ├── css/
│   │   └── js/
│   └── assets/
└── package.json
```

## Settings with configSchema

Define settings that server admins can configure:

```json
{
  "name": "adb-plugin-my-plugin",
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "description": "Your API key for the service"
      },
      "enabled": {
        "type": "boolean",
        "default": true
      },
      "maxCount": {
        "type": "number",
        "default": 10,
        "minimum": 1,
        "maximum": 100
      },
      "mode": {
        "type": "string",
        "enum": ["fast", "normal", "slow"],
        "default": "normal"
      }
    }
  }
}
```

Access settings in your plugin:

```javascript
async function load(ctx) {
  // Get settings for a specific guild
  const settings = await ctx.db.getPluginConfig(guildId, "adb-plugin-my-plugin");
  
  // settings.data contains { apiKey, enabled, maxCount, mode }
}
```

## Publishing Your Plugin

1. **Test locally**: Place in `plugins/` folder or install via npm

2. **Create npm package**:
   ```json
   {
     "name": "adb-plugin-my-plugin",
     "version": "1.0.0",
     "main": "index.js",
     "peerDependencies": {
       "discord.js": ">=14.0.0"
     }
   }
   ```

3. **Publish to npm**:
   ```bash
   npm publish
   ```

4. **Submit to marketplace**:
   - Fork the [ADB Plugin Registry](https://github.com/adb-plugin-registry/registry)
   - Add your plugin to `plugins.json`
   - Submit a PR

## Examples

See these existing plugins for reference:

- `plugins/administration/` - Admin dashboard (with web UI)
- `plugins/economy/` - Economy system
- `plugins/ai/` - AI assistant

## Troubleshooting

### Command not showing up
- Make sure your plugin is loaded
- Run `/deploy` to register commands with Discord

### Plugin not loading
- Check `plugin.json` is valid JSON
- Ensure `index.js` exports `load` function
- Check bot logs for errors

### Settings not saving
- Ensure `configSchema` is valid JSON Schema
- Use `ctx.db.getPluginConfig()` to read settings

## Need Help?

- Discord: [ADB Support Server](https://discord.gg/ADB_PLACEHOLDER)
- GitHub: [ADB Discord Bot](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot)