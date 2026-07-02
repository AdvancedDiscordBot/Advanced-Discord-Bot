<div align="center">

# 📚 Advanced Discord Bot Slash Command Documentation

Official command reference for **Advanced Discord Bot (ADB)**.

</div>

---

## 💰 Economy Commands

| Command | Description | Usage |
|--------|-------------|-------|
| `/bal [user]` | Check wallet and bank balance. | `/bal` |
| `/buy <item>` | Buy a role from the shop. | `/buy PremiumRole` |
| `/coinflip <bet> <choice>` | Flip a coin and gamble coins. | `/coinflip 100 heads` |
| `/collect` | Collect income from purchased roles. | `/collect` |
| `/deposit <amount \| all>` | Deposit coins into the bank. | `/deposit all` |
| `/diceroll <bet> <number>` | Roll a die and bet on a number. | `/diceroll 50 4` |
| `/economy-setup [options]` | Configure economy settings. Admin only. | `/economy-setup` |
| `/give <recipient> <amount>` | Give coins to another user. | `/give @user 100` |
| `/leaderboard` | Show the richest users. | `/leaderboard` |
| `/shop` | Display roles available for purchase. | `/shop` |
| `/shop-admin <subcommand> [options]` | Manage the role shop. Admin only. | `/shop-admin add PremiumRole` |
| `/steal <victim>` | Attempt to steal coins. | `/steal @user` |
| `/withdraw <amount \| all>` | Withdraw coins into wallet. | `/withdraw 200` |
| `/work` | Work to earn coins. | `/work` |

---

## 🎉 Fun Commands

| Command | Description | Usage |
|--------|-------------|-------|
| `/8ball <question>` | Ask the magic 8-ball a question. | `/8ball Will I win?` |
| `/avatar [user]` | Display a user's avatar. | `/avatar @user` |
| `/meme [subreddit]` | Get a random meme. | `/meme` |
| `/poll <question> <options>` | Create an emoji poll. | `/poll "Best fruit?" apples, bananas, oranges` |
| `/reminder <time> <message>` | Set a reminder. | `/reminder 1h Take a break` |
| `/roll <dice>` | Roll dice. | `/roll 2d6` |
| `/secret` | Discover an easter egg. | `/secret` |

---

## ⚙️ General Commands

| Command | Description | Usage |
|--------|-------------|-------|
| `/banner` | Display server banner. | `/banner` |
| `/birthday <subcommand>` | Manage birthdays. | `/birthday set 1990-01-01` |
| `/botstats` | Bot performance statistics. | `/botstats` |
| `/calculate <expression>` | Perform arithmetic. | `/calculate 5 + 7` |
| `/dm <message>` | Send yourself a DM. | `/dm Remember the meeting!` |
| `/feedback` | Submit feedback. | `/feedback This bot is useful!` |
| `/help` | List bot commands. | `/help` |
| `/joindate [user]` | Show when a user joined. | `/joindate @user` |
| `/ping` | Bot and API latency. | `/ping` |
| `/resetnick` | Reset your nickname. | `/resetnick` |
| `/reverse <text>` | Reverse a message. | `/reverse hello` |
| `/serverinfo` | Display server info. | `/serverinfo` |
| `/setnick <nickname>` | Change your nickname. | `/setnick Hero` |
| `/spoiler <text>` | Hide text as spoiler. | `/spoiler secret text` |
| `/uptime` | Bot uptime info. | `/uptime` |
| `/userinfo [user]` | Detailed user info. | `/userinfo @user` |

---

## 🛡️ Moderation Commands

| Command | Description | Usage |
|--------|-------------|-------|
| `/ban <user> [reason]` | Ban a user. | `/ban @user spamming` |
| `/kick <user> [reason]` | Kick a user. | `/kick @user offensive language` |
| `/purge <amount> [user]` | Bulk delete messages. | `/purge 50` |
| `/ticket <title> <description>` | Create a support ticket. | `/ticket "Bug Report" "Feature not working"` |
| `/ticketdashboard <subcommand>` | Manage tickets. Mods only. | `/ticketdashboard list` |

---

## 📈 XP & Leveling Commands

| Command | Description | Usage |
|--------|-------------|-------|
| `/daily` | Claim daily reward. | `/daily` |
| `/points <subcommand>` | Manage or view points. | `/points view` |
| `/profile [user]` | View profile and stats. | `/profile @user` |
| `/roles <subcommand>` | View or claim role rewards. | `/roles claim` |
| `/xpconfig <subcommand>` | Configure XP and leveling. Admin only. | `/xpconfig set multiplier 2x` |

---

## 🤖 AI & Plugin Commands

| Command | Description | Usage |
|--------|-------------|-------|
| `/aiassistant ask <question>` | Ask the AI assistant. | `/aiassistant ask What can you do?` |
| `/config-ai` | Configure AI plugin behavior. | `/config-ai` |
| `/faq` | Use FAQ assistant features when the AI plugin is enabled. | `/faq` |
| `/antiraid <subcommand>` | Manage anti-raid system. | `/antiraid enable` |
| `/truthordare <subcommand>` | Play Truth or Dare. | `/truthordare start` |

---

Plugins can add more slash commands at runtime. Re-run `npm run deploy` after adding or changing slash command definitions so Discord receives the updated command list.
