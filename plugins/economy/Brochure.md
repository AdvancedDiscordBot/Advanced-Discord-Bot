# Economy

Official ADB economy plugin. Adds a complete server currency system to your Discord bot.

## Features

- Earn coins by chatting and claiming daily rewards
- Transfer coins between members with `/pay`
- Check your balance and browse the server leaderboard
- Admin commands to grant, deduct, and reset balances

## Commands

| Command | Description |
|---------|-------------|
| `/balance` | View your current balance |
| `/daily` | Claim your daily reward |
| `/pay @user amount` | Transfer coins to another member |
| `/leaderboard` | Top earners in the server |

## Configuration

Zero-config by default. Admins can adjust earn rates and daily reward amounts in plugin settings.

## Permissions

Requires `db.read`, `db.write`, and `commands.register`.
