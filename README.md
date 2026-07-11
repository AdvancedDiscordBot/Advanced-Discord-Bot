# 🤖 Advanced Discord Bot (ADB)

<div align="center">

![Discord Bot](https://img.shields.io/badge/Discord-Bot-7289DA?style=for-the-badge&logo=discord&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini-AI-4285F4?style=for-the-badge&logo=google&logoColor=white)
![Plugin Ready](https://img.shields.io/badge/Plugins-Ready-6A5ACD?style=for-the-badge)
![License](https://img.shields.io/badge/License-AGPL--3.0-blue?style=for-the-badge)

<br/>

<a href="https://discord.com/oauth2/authorize?client_id=1522106470018191532&permissions=8&integration_type=0&scope=bot+applications.commands">
  <img src="screenshots/invite-button.svg" alt="Invite Bot" height="40" />
</a>
<a href="https://adb.gollabharath.me">
  <img src="screenshots/dashboard-button.svg" alt="Dashboard" height="40" />
</a>

<br/>

**🚀 ADB is a self-hosted Discord bot platform built to become whatever your server needs.**  
**🔌 Install plugins • 🧩 Build your own modules • 🖥️ Manage everything from a dashboard • 🔓 Own the stack**

[![Features](https://img.shields.io/badge/-Features-4CAF50?style=for-the-badge&logo=sparkles&logoColor=white)](#-features)
[![Installation](https://img.shields.io/badge/-Installation-FF9800?style=for-the-badge&logo=visualstudiocode&logoColor=white)](#-quick-start)
[![Commands](https://img.shields.io/badge/-Commands-1976D2?style=for-the-badge&logo=terminal&logoColor=white)](#commands-list)
[![Plugins](https://img.shields.io/badge/-Plugin%20Docs-6A5ACD?style=for-the-badge)](./CREATE-PLUGIN.md)
[![Contributing](https://img.shields.io/badge/Contributing-Guidelines-blue?style=for-the-badge)](./CONTRIBUTING.md)

</div>

---

## 📊 Project Statistics

<div align="center">

<table>
<tr>
<td align="center">
<img src="https://img.shields.io/github/stars/AdvancedDiscordBot/Advanced-Discord-Bot?style=social" alt="GitHub Stars">
<br><b>Stars</b>
</td>
<td align="center">
<img src="https://img.shields.io/github/forks/AdvancedDiscordBot/Advanced-Discord-Bot?style=social" alt="GitHub Forks">
<br><b>Forks</b>
</td>
<td align="center">
<img src="https://img.shields.io/github/issues/AdvancedDiscordBot/Advanced-Discord-Bot" alt="GitHub Issues">
<br><b>Open Issues</b>
</td>
<td align="center">
<img src="https://img.shields.io/github/issues-pr/AdvancedDiscordBot/Advanced-Discord-Bot" alt="GitHub Pull Requests">
<br><b>Pull Requests</b>
</td>
<td align="center">
<img src="https://img.shields.io/github/contributors/AdvancedDiscordBot/Advanced-Discord-Bot" alt="GitHub Contributors">
<br><b>Contributors</b>
</td>
</tr>
</table>

</div>

## 👑 Maintainer

| Role | Name | GitHub |
| ---- | ---- | ------ |
| 🛠️ Maintainer | DeadIndian | [@DeadIndian](https://github.com/DeadIndian) |

ADB is not participating in any open source contribution program at the moment. Contributions are reviewed through regular GitHub issues and pull requests.


---

## 🖼️ Screenshots

### 🎨 Feature Showcase

<div align="center">

<table>
<tr>
<td width="33%">
<img src="screenshots/Birthday.png" alt="Birthday System" width="100%">
<i>🎂 Birthday System</i>
</td>
<td width="33%">
<img src="screenshots/DailyPoints.png" alt="Daily Points" width="100%">
<i>💰 Daily Rewards</i>
</td>
<td width="33%">
<img src="screenshots/FeedbackForm.png" alt="Feedback Form" width="100%">
<i>📝 Feedback Collection</i>
</td>
</tr>
<tr>
<td width="33%">
<img src="screenshots/FeedBackSuggestion.png" alt="Feedback Suggestions" width="100%">
<i>💡 Suggestions</i>
</td>
<td width="33%">
<img src="screenshots/LeaderboardPong.png" alt="Leaderboard" width="100%">
<i>🏆 Leaderboards</i>
</td>
<td width="33%">
<img src="screenshots/MainMenu.png" alt="Main Menu" width="100%">
<i>📋 Main Menu</i>
</td>
</tr>
<tr>
<td width="33%">
<img src="screenshots/Memes.png" alt="Memes System" width="100%">
<i>😂 Memes</i>
</td>
<td width="33%">
<img src="screenshots/PerformanceDashboard.png" alt="Performance Dashboard" width="100%">
<i>📊 Performance Dashboard</i>
</td>
<td width="33%">
<img src="screenshots/RemainderSetter.png" alt="Reminder Setter" width="100%">
<i>⏰ Reminders</i>
</td>
</tr>
</table>

</div>

---

## ✨ Why Choose ADB?

🔌 **Plugin-first foundation** - Add commands, dashboards, scheduled jobs, models, and hooks without editing core code  
🖥️ **Dashboard-ready** - Built around a web control plane for server admins and plugin management  
🛒 **Marketplace-ready** - Discover and install community plugins from a registry-backed marketplace  
🎯 **General or specialized** - Run it as an all-in-one community bot or strip it down into a focused custom bot  
🔓 **Self-hosted ownership** - Your bot, your data, your infrastructure, your rules  
🛡️ **Privacy-first** - Data stays in your MongoDB instance instead of a third-party SaaS platform  
🤖 **AI capable** - Google Gemini integration for assistant and FAQ-style workflows  
⚡ **Modern Discord stack** - Discord.js v14, Node.js, MongoDB, Fastify/Express pieces, and hot-reloadable plugins  

---

## 🎯 Features

### **🔌 Plugin Platform**

- Local plugins from `plugins/`
- npm-style plugin packages
- Plugin manifests with metadata, config schemas, permissions, restart flags, and optional dashboard ports
- Command registration and command overrides
- Event listeners, scheduled jobs, hook bus integration, and namespaced database models
- Registry support for a plugin marketplace

### **🖥️ Administration Dashboard**

- Discord OAuth-based admin access
- Guild picker for server-specific management
- Plugin install, enable, disable, and status views
- Settings pages for AI, XP, tickets, birthdays, economy, anti-raid, and plugins
- Activity logs and operational visibility

### **🤖 AI Assistant**

- Google Gemini-powered responses
- Configurable AI channels and behavior
- FAQ-oriented plugin support
- Rate limiting and graceful failure handling

### **💎 Economy, XP & Rewards**

- Wallet, bank, shop, work, collect, gamble, and leaderboard commands
- XP profiles, daily rewards, role rewards, and server-configurable leveling
- Persistent MongoDB-backed user data

### **🎫 Moderation & Tickets**

- Ban, kick, purge, anti-raid, support tickets, and ticket dashboards
- Configurable ticket categories and logs
- Permission-aware command handling

### **🎉 Community Tools**

- Birthdays, polls, reminders, feedback, memes, truth-or-dare, dice, 8ball, avatars, server info, and utility commands

---

## Commands List

<div align="center">

### 📊 Command Categories Breakdown

| Category | Examples |
| -------- | -------- |
| 🎮 **Fun & Games** | 8ball, meme, roll, secret, truthordare |
| 🛡️ **Moderation** | antiraid, ban, kick, purge |
| 📊 **Utility & Info** | help, ping, userinfo, serverinfo, botstats |
| 💎 **Economy & XP** | bal, daily, points, profile, work, shop, xpconfig |
| 🎫 **Support System** | ticket, ticketdashboard |
| 🤖 **AI Assistant** | aiassistant, faq, config-ai |
| 🎂 **Community** | birthday, feedback, poll, reminder |

</div>

Refer to [DOCUMENTATION.md](./DOCUMENTATION.md) for the complete slash command reference.

---

## Quick Start

### Prerequisites

- **Node.js** v18.0.0 or higher
- **MongoDB** database, local or cloud
- **Discord Bot Token** from the [Discord Developer Portal](https://discord.com/developers/applications)
- **Google Gemini API Key** from [Google AI Studio](https://makersuite.google.com/app/apikey), optional unless AI features are enabled

### Option 1: Local Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot.git
   cd Advanced-Discord-Bot
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file:

   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_bot_client_id_here
   GUILD_ID=your_test_guild_id_here
   MONGODB_URI=your_mongodb_connection_string
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3000
   DASHBOARD_URL=http://localhost:5173
   SESSION_SECRET=replace_with_a_long_random_secret
   ```

4. **Deploy slash commands**

   ```bash
   npm run deploy
   ```

5. **Start the bot**

   ```bash
   npm start
   ```

### Option 2: Docker Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot.git
   cd Advanced-Discord-Bot
   ```

2. **Configure environment variables**

   Create a `.env` file:

   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_bot_client_id_here
   GUILD_ID=your_test_guild_id_here
   MONGODB_URI=mongodb://advance:bot@mongo:27017/discord-bot?authSource=admin&retryWrites=true&w=majority
   GEMINI_API_KEY=your_gemini_api_key_here
   SESSION_SECRET=replace_with_a_long_random_secret
   ```

3. **Deploy slash commands**

   ```bash
   docker compose run --rm bot npm run deploy
   ```

4. **Build and start**

   ```bash
   docker compose up --build -d
   ```

5. **View logs**

   ```bash
   docker compose logs -f bot
   ```

---

## 🌐 Deployment

ADB can run on Render, Railway, Fly.io, a VPS, or any host that supports Node.js and MongoDB access.

Recommended production steps:

1. Set all required environment variables in your host dashboard.
2. Use `npm install` as the build command.
3. Use `npm start` as the start command.
4. Run `npm run deploy` once after first deployment or after slash command changes.
5. Point the dashboard URL and OAuth callback URLs at your deployed domain.

Suggested service name:

```text
Advanced Discord Bot
```

---

## 🔧 Database Setup

### MongoDB Options

**Option 1: MongoDB Atlas**

1. Create a cluster at [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a database user
3. Allow your deployment host in Network Access
4. Copy the connection string into `MONGODB_URI`

**Option 2: Local MongoDB**

```bash
mongod --dbpath ./data
```

**Option 3: Docker Compose**

Use the included `docker-compose.yml` to run MongoDB alongside the bot.

### Database Features

- Automatic schema creation
- Persistent guild, user, ticket, economy, XP, birthday, and plugin config data
- Plugin-specific model namespacing
- Backup-friendly MongoDB storage

---

## 🔌 Plugins & Marketplace

ADB is designed to be extended. A plugin can:

- Add slash commands
- Override existing commands
- Listen to Discord events
- Register scheduled jobs
- Define MongoDB models
- Hook into bot flows
- Expose its own dashboard
- Provide a settings schema for generated admin UI

Start here:

- [CREATE-PLUGIN.md](./CREATE-PLUGIN.md) - build a plugin
- [REGISTRY-SETUP.md](./REGISTRY-SETUP.md) - create or operate a plugin registry
- [PLUGINS-ROADMAP.md](./PLUGINS-ROADMAP.md) - platform architecture and roadmap

---

## 🛠️ Technical Architecture

### **Modern Tech Stack**

- **Discord.js v14** - Discord API wrapper
- **Node.js 18+** - JavaScript runtime
- **MongoDB + Mongoose** - Persistent data and schemas
- **Google Gemini AI** - AI assistant features
- **Fastify/Express** - Dashboard and internal API surfaces
- **React** - Administration dashboard

### **Core Runtime**

- Dynamic command and event loading
- Plugin Manager and Hook Bus
- Scheduled jobs via `node-cron`
- MongoDB-backed guild and user configuration
- Dashboard API for plugin and guild management

See [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation details.

---

## 📞 Support & Community

- 📖 **Documentation** - Start with this README and the linked docs
- 🐛 **Bug Reports** - Open a GitHub issue
- 💡 **Feature Requests** - Open an issue with the feature proposal
- 🔌 **Plugin Ideas** - Discuss or submit plugin-focused issues and PRs
- 💬 **Direct Contact** - Email [gollabharath2007@gmail.com](mailto:gollabharath2007@gmail.com) or reach out via Discord to **@deadindian**

---

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0**. See [LICENSE](LICENSE) for details.

<div align="center">

![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue?style=for-the-badge)

</div>

## 🏆 Acknowledgments

- **Discord Developer Community** - For tooling, examples, and ecosystem knowledge
- **Open Source Contributors** - For improving the project through issues and PRs
- **Plugin Authors** - For turning ADB into more than a single-purpose bot
- **Everyone self-hosting it** - For shaping the project through real-world usage

---

<div align="center">

## 🚀 Build The Bot Your Server Actually Needs

### Self-hosted • Plugin-ready • Dashboard-managed

[🌟 Star this repo](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot) • [🍴 Fork & Deploy](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot/fork) • [📖 Read the docs](#quick-start)

---

_Maintained by [@DeadIndian](https://github.com/DeadIndian)_  
_"One base bot. Any use case."_

</div>

<p align="center">
  <a href="#top" style="font-size: 18px; padding: 8px 16px; display: inline-block; border: 1px solid #ccc; border-radius: 6px; text-decoration: none;">
    ⬆️ Back to Top
  </a>
</p>
