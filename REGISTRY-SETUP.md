# Setting Up The ADB Plugin Registry

This guide covers how to set up and manage a plugin registry for **Advanced Discord Bot (ADB)**.

## Overview

The plugin registry is a JSON file that lists available plugins for the dashboard marketplace. Users browse registry entries and install plugins from npm packages or supported package sources.

**Submission Flow:**

1. Developer creates a plugin and publishes it.
2. Developer submits a PR to the registry repository.
3. Maintainer reviews the manifest, package, and security posture.
4. Plugin appears in the marketplace after merge and cache refresh.

## Creating The Registry Repository

### 1. Create A GitHub Repository

Create a public repository such as:

```text
https://github.com/YOUR_USERNAME/adb-plugin-registry
```

### 2. Create `plugins.json`

Create `plugins.json` in the repository root:

```json
{
  "plugins": [
    {
      "name": "adb-plugin-economy",
      "displayName": "Economy System",
      "description": "Complete economy system with coins, work commands, shop, and leaderboards",
      "author": "ADB",
      "version": "1.0.0",
      "category": "features",
      "permissions": ["db.read", "db.write", "commands.register"],
      "requiresRestart": false,
      "verified": true,
      "npmPackage": "adb-plugin-economy"
    },
    {
      "name": "adb-plugin-moderation",
      "displayName": "Advanced Moderation",
      "description": "Auto-mod, logs, slowmode, and advanced moderation tools",
      "author": "ADB",
      "version": "1.0.0",
      "category": "moderation",
      "permissions": ["db.read", "db.write", "commands.register"],
      "requiresRestart": false,
      "verified": true,
      "npmPackage": "adb-plugin-moderation"
    }
  ]
}
```

### 3. Plugin Entry Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Internal plugin or npm package name |
| `displayName` | string | Yes | Human-readable name |
| `description` | string | Yes | What the plugin does |
| `author` | string | Yes | Developer name |
| `version` | string | Yes | Current version |
| `category` | string | Yes | Marketplace category |
| `permissions` | array | No | Declared plugin permissions |
| `requiresRestart` | boolean | No | Whether the bot must restart after install/update |
| `verified` | boolean | No | Officially reviewed or audited plugin |
| `npmPackage` | string | Yes | Exact npm package name |
| `port` | number | No | Dashboard port if the plugin exposes a web UI |
| `configSchema` | object | No | JSON Schema used to render plugin settings |

### 4. Categories

| ID | Display Name |
|----|--------------|
| `features` | Features |
| `moderation` | Moderation |
| `entertainment` | Entertainment |
| `utility` | Utility |
| `analytics` | Analytics |
| `ai` | AI |
| `dashboard` | Dashboard |

### 5. Registry README

Optional registry README:

```markdown
# ADB Plugin Registry

This repository contains the plugin list for the ADB marketplace.

## Adding A Plugin

1. Publish your plugin package.
2. Fork this repository.
3. Add your plugin to `plugins.json`.
4. Submit a PR.

## Plugin Requirements

- Valid `plugin.json` manifest
- Published package or supported install source
- No malicious behavior
- Clear permissions and restart requirements
- Compatible with the current ADB plugin API
```

## Configuring ADB

Set the registry URL in your bot environment:

```bash
export PLUGIN_REGISTRY_URL="https://raw.githubusercontent.com/YOUR_USERNAME/adb-plugin-registry/main/plugins.json"
```

If `PLUGIN_REGISTRY_URL` is not set, configure one before enabling marketplace installs in production.

## Managing Submissions

Review checklist:

- [ ] Plugin has a valid `plugin.json`
- [ ] Package exists and is installable
- [ ] Version matches registry entry
- [ ] Description is accurate
- [ ] Category is appropriate
- [ ] Permissions are clearly declared
- [ ] No obvious malicious code or unsafe install scripts
- [ ] Plugin loads without errors in a test bot

Example merge flow:

```bash
git clone https://github.com/YOUR_USERNAME/adb-plugin-registry.git
cd adb-plugin-registry
git add plugins.json
git commit -m "Add adb-plugin-example"
git push origin main
```

## Production Best Practices

### Cache Management

The bot may cache the registry. To force a refresh:

1. Restart the bot, or
2. Wait for the registry cache to expire.

### Health Checks

```bash
curl -I https://raw.githubusercontent.com/YOUR_USERNAME/adb-plugin-registry/main/plugins.json
curl -s https://raw.githubusercontent.com/YOUR_USERNAME/adb-plugin-registry/main/plugins.json | jq .
```

### Backup

Keep `plugins.json` backed up. It is the source of truth for marketplace listings.

## Troubleshooting

### Plugin Not Appearing

- Check that `plugins.json` is valid JSON.
- Verify the package exists and is accessible.
- Ensure `npmPackage` matches exactly.
- Wait for cache expiry or restart the bot.

### Invalid JSON

```bash
jq . plugins.json
```

### Registry URL Not Working

- Use HTTPS in production.
- Return valid JSON.
- For GitHub raw files, use:

```text
https://raw.githubusercontent.com/USER/REPO/BRANCH/plugins.json
```

## Need Help?

Open an issue in the registry repository or in the main ADB repository with the registry URL, the plugin entry, and any install logs.
