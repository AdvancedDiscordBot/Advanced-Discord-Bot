# Runtime Verification

## Local Checks

From the bot repository:

```bash
npm test
npm run test:dashboard
npm --prefix plugins/administration/web run build
```

Run `npm test` in each edited `adb-plugin-*` repository as well. The plugin
harnesses run without Discord, MongoDB or Lavalink. The bot tests include actual
worker-thread round trips and authenticated API route tests with simulated
external boundaries.

## Edited Plugins

Sibling source changes do not update npm releases or a running Docker image.
For local development, install the edited plugin directories into the bot with
`npm install --no-save --package-lock=false ../adb-plugin-<name>`. npm creates
local links; the loader follows them. Install each plugin's dependencies in its
own repository first. The integration check can test all sibling plugins without
changing the bot's installed dependencies:

```bash
ADB_PLUGIN_WORKSPACE=.. \
ADB_INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:32768/adb_verify_plugins \
npm run test:integration
```

Without `ADB_PLUGIN_WORKSPACE`, the check uses the plugins actually installed in
the bot's `node_modules`. The workspace check includes the template; installing
the template into production is unnecessary.

## Disposable MongoDB

Use a separate empty MongoDB instance, never the production database. For example:

```bash
docker run --detach --rm --name adb-verification-mongo \
  --publish 127.0.0.1::27017 --tmpfs /data/db:rw,size=512m \
  mongo:7 --quiet --bind_ip_all
docker port adb-verification-mongo 27017/tcp
```

Use the reported port in `ADB_INTEGRATION_MONGODB_URI`. The checker accepts only
loopback MongoDB URLs whose database name starts with `adb_verify_`. It appends a
unique suffix and removes only that database after the run. It does not read
`.env`, log in to Discord, perform npm reconciliation, or contact Lavalink.

The check boots the real bot with all selected plugins, uses real Mongoose models
and MongoDB writes, executes registered commands and event handlers, verifies
private worker replies and scheduled delivery, and restarts the bot to check
persistence. Discord HTTP and gateway operations are intercepted in memory.

Remove the disposable instance afterwards:

```bash
docker stop adb-verification-mongo
```

## Live Acceptance

Offline checks do not prove gateway authorization, Developer Portal intents,
channel permissions, role hierarchy, OAuth redirects, or audio playback on a real
server. Test these in a designated Discord test guild before production rollout.

Manual deployment requires `CLIENT_ID`, `GUILD_ID`, and the configured database;
non-dry-run deployment also requires `DISCORD_TOKEN`. Dry-run executes plugin
initializers to collect commands, so use trusted plugins and a test database.
Scheduled work and gateway login are not started by the collector.

Several plugins need full Discord.js APIs and explicitly declare `system:raw-client`.
They run in the main process with full host access and require owner trust. Other
plugins retain their worker/RPC mode, and workers receive only approved environment
variables. Worker separation is not an operating-system sandbox for hostile code:
install only plugins whose code and dependencies you trust.

The music plugin needs an external Lavalink v4 node, its connection credentials,
and the relevant server source plugins for YouTube, Spotify or SoundCloud. Lyrics
need a configured lyrics provider. A missing node produces an actionable command
error rather than crashing the bot.

Temporary voice now uses `/voice <subcommand>`. Restart after upgrading plugin
schemas so cached Mongoose models are recompiled. Do not run a second gateway
process with the production bot token merely to test local changes.
