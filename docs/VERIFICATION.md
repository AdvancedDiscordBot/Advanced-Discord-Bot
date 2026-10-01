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

## Known limitations of the integration check

`scripts/check-plugin-runtime.js` builds its own **in-memory stand-in for
discord.js** so the check can run without a gateway. That stand-in implements
only the parts of the discord.js surface the shipped scenarios happened to touch.
Anything outside it is missing, and that has two consequences you must understand
before you act on a result:

1. **False failures.** A plugin that calls a perfectly valid discord.js method
   will crash the check with the host's generic
   *"An error occurred while processing your request. Please try again later."*
   The plugin is fine; the mock is incomplete.
2. **Silent coverage holes.** A missing mock method is never called, so whole code
   paths report as "passing" without having been exercised at all.

Always read the underlying exception in the test output — the generic reply text
tells you nothing. If the stack ends in `scripts/check-plugin-runtime.js` rather
than in your plugin, it is a mock gap.

### Confirmed mock gaps (as of the plugin sweep)

Missing from the mock boundary, each hiding or breaking real plugin code:

| Missing API | Real plugin code it breaks/hides |
|---|---|
| `interaction.deleteReply()` | `adb-plugin-levels` `commands/level.js` → `/level` fails the check for users with no XP |
| `interaction.getSubcommandGroup()` (hardcoded to `null`) | every subcommand-group dispatch — `/automod rule add\|remove\|edit`, `/welcome background\|social\|button` |
| `interaction.values`, `isStringSelectMenu()` → `false` | select-menu handlers, e.g. `adb-plugin-reaction-roles` dropdowns |
| `interaction.deferUpdate()`, `update()`, `showModal()` | component and modal flows |
| `channel.messages.fetch({ limit })` (only single-id fetch) | `adb-plugin-moderation` `commands/purge.js` and the `commands/ticket.js` transcript |
| `channel.bulkDelete()` | the `/purge` deletion path |
| `channel.setRateLimitPerUser()` | `/slowmode` |
| `message.mentions` | `adb-plugin-automod` `checkMention()` — the mention filter |
| `client.guilds.fetch()` | `adb-plugin-invite-tracker` `/invites-admin codes` |
| `guild.channels.fetch()` with no argument (returns `null`) | `adb-plugin-aegis` `lib/lockdown.js` — the whole raid-lockdown path |
| `guild.members.ban()` / `unban()` / `kick()` | `/ban`, `/unban`, `/kick` |
| `channel.pins`, `setTopic`, `setUserLimit`, `setBitrate`, `setParent`, `setNSFW` | moderation and tempvoice channel management |

Because of this, **"the integration check passed" is not by itself evidence that a
command works.** The three-layer rule for a plugin change is:

1. `npm test` in the plugin repo (offline, both load modes);
2. `npm run test:integration` in the bot checkout (real models, real MongoDB);
3. the feature exercised by a human in a real test server.

### Filling a gap

If you need coverage the mock does not provide, extend the boundary in
`scripts/check-plugin-runtime.js` (`discordBoundary()`) rather than weakening the
plugin. Keep the additions faithful to real discord.js semantics — notably:

- `channel.messages.fetch({ limit })` returns a `Collection` ordered **oldest →
  newest** (this is why `/purge` must reverse before slicing);
- `bulkDelete()` returns a `Collection` of what it actually deleted, and its
  second argument means *filter out messages older than 14 days* — it does **not**
  reorder anything;
- a **required** user/channel option still resolves to `null` when the member
  left or the channel was deleted, so plugin code must null-check
  `getUser()` / `getChannel()` results.

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
