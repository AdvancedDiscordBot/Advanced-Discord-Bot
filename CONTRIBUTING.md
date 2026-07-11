# 🤝 Contributing to Advanced Discord Bot

Thank you for helping improve **Advanced Discord Bot (ADB)**. The project is evolving from a single Discord bot into a self-hosted bot platform with a dashboard, plugin system, and plugin marketplace.

ADB is not currently part of any open source contribution program. There is no external contribution tracker to update; GitHub issues and pull requests are the source of truth.

## 🌟 Project Philosophy

### Own The Bot

- **Self-hosted first** - You decide where the bot and database run.
- **No vendor lock-in** - The source, data, and deployment are under your control.
- **Privacy-aware** - Server data lives in your MongoDB instance.
- **Composable** - Core features should stay useful, while plugins make the bot specialized.

### Build A Platform

- **Core bot** - Stable Discord.js runtime, commands, events, database, scheduling, and AI support.
- **Dashboard** - Admin UI for guild settings, plugin management, and activity visibility.
- **Plugin marketplace** - Registry-backed discovery for installable community modules.
- **Plugin API** - Commands, overrides, events, hooks, config schemas, jobs, and models.

## 🎯 Contribution Priorities

High priority:

- Bug fixes and reliability improvements
- Plugin manager, hook bus, registry, and dashboard polish
- Security and permission handling
- Documentation and onboarding improvements
- Tests for command, plugin, and dashboard behavior

Medium priority:

- New core commands only when they belong in the base bot
- Better observability, logs, and admin feedback
- Performance improvements
- Internationalization and accessibility

Plugin-first contributions:

- Features that are useful but not essential to the base bot should usually be built as plugins.
- Plugin examples and marketplace-ready packages are welcome.

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- MongoDB, local or cloud
- Discord bot token
- Discord application client ID
- Google Gemini API key if testing AI features

### Local Setup

```bash
git clone https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot.git
cd Advanced-Discord-Bot
npm install
cp .env.example .env
```

If `.env.example` is not present, create `.env` manually:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_test_guild_id
MONGODB_URI=your_mongodb_uri
GEMINI_API_KEY=your_gemini_key
SESSION_SECRET=replace_with_a_long_random_secret
```

Deploy slash commands and start the bot:

```bash
npm run deploy
npm start
```

## 🔁 Development Workflow

```bash
git checkout -b feature/short-description
npm test
git add .
git commit -m "Add short description"
git push origin feature/short-description
```

Then open a pull request with:

- What changed
- Why it changed
- How you tested it
- Screenshots or logs for dashboard/UI changes
- Any migration or deployment notes

## 🔌 Creating Plugins

ADB plugins can add commands, dashboards, models, scheduled jobs, hooks, and custom configuration.

Quick example:

```bash
mkdir plugins/adb-plugin-my-plugin
cd plugins/adb-plugin-my-plugin
```

```json
{
  "name": "adb-plugin-my-plugin",
  "version": "1.0.0",
  "description": "My ADB plugin",
  "author": "YourName",
  "main": "index.js",
  "requiresRestart": false
}
```

```javascript
async function load(ctx) {
  ctx.logger.info("My plugin loaded");

  ctx.registerCommand({
    data: {
      name: "hello",
      description: "Say hello"
    },
    async execute(interaction) {
      await interaction.reply("Hello from an ADB plugin!");
    }
  });
}

module.exports = { load };
```

See [CREATE-PLUGIN.md](./CREATE-PLUGIN.md) for the complete plugin guide.

## ✅ Development Guidelines

- Follow the existing command and event structure.
- Keep core changes focused; prefer plugins for optional features.
- Handle Discord permissions and missing guild/member/channel data gracefully.
- Avoid logging tokens, session secrets, connection strings, or user private data.
- Update documentation when behavior, setup, commands, or plugin APIs change.
- Run tests before submitting a PR.

## 🧪 Testing

```bash
npm test
```

For Discord behavior, also test in a private development guild and include the tested commands or flows in your PR notes.

## 🧭 Documentation Map

- [README.md](./README.md) - project overview and setup
- [DOCUMENTATION.md](./DOCUMENTATION.md) - slash command reference
- [ARCHITECTURE.md](./ARCHITECTURE.md) - runtime architecture
- [CREATE-PLUGIN.md](./CREATE-PLUGIN.md) - plugin authoring guide
- [REGISTRY-SETUP.md](./REGISTRY-SETUP.md) - marketplace registry setup
- [SECURITY.md](./SECURITY.md) - vulnerability reporting

## 📜 Code of Conduct

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). Keep discussions respectful, focused, and useful.
