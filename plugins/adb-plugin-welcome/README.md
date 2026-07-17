# Welcome & Goodbye Plugin for Advanced Discord Bot (ADB)

A highly customizable and premium welcome and goodbye plugin for [Advanced Discord Bot](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot). Displays beautifully styled cards, text embeds, and custom messages to welcome new members and farewell departing ones.

## Features

- **Welcome Messages:** Send custom welcome messages to a designated text channel.
- **Goodbye Messages:** Send custom goodbye messages to a designated text channel.
- **Direct Messages (DMs):** Direct message new members upon joining.
- **Image Cards:** Dynamically generate high-fidelity, modern welcome/goodbye image cards with:
  - User's avatar with gradient border and outer glow.
  - Custom linear gradient background matching welcome/goodbye actions.
  - Server icon and name in a clean header.
  - Username and member count with ordinal suffixes (e.g. 1st, 2nd, 3rd, 102nd member).
- **Interactive Configuration:** Simple slash commands to set up the plugin.
- **Preview & Test Commands:** Instantly view changes and simulate real events before public deployment.

## Installation

Within your ADB installation directory, install the plugin:

```bash
npm install adb-plugin-welcome
```

## Slash Commands

Configured commands are restricted to server administrators/managers:

| Command | Description |
|---|---|
| `/welcome channel [#channel]` | Sets the welcome text channel. Run without `#channel` to disable. |
| `/welcome message <text>` | Configures the welcome message text. |
| `/welcome goodbye-channel [#channel]` | Sets the goodbye text channel. Run without `#channel` to disable. |
| `/welcome goodbye-message <text>` | Configures the goodbye message text. |
| `/welcome dm on/off` | Toggles whether welcome messages are sent to new members in Direct Messages. |
| `/welcome card on/off` | Toggles canvas image card generation on welcome/goodbye actions. |
| `/welcome preview` | Generates and sends a welcome & goodbye preview in the current channel. |
| `/welcome test` | Simulates and delivers real welcome/goodbye events to the configured destinations. |

## Placeholders

Use these variables within welcome and goodbye messages:

- `{user}` - Mentions the user (e.g., `<@123456789>`).
- `{username}` - Plaintext username of the user (e.g., `NewMember`).
- `{server}` / `{guild}` - Name of the Discord server (e.g., `My Awesome Server`).
- `{memberCount}` - Current member count of the server (e.g., `124`).

## Development and Local Testing

Run the test suite to verify command definitions and event behaviors:

```bash
npm install
npm test
```

## License

This plugin is licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](LICENSE) file.
