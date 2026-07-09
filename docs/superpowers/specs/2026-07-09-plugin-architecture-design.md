# Plugin Architecture Overhaul — Design

Date: 2026-07-09
Status: Approved (brainstorm), pending implementation plan

## Goal

Turn the plugin system into a real managed store: core plugins are protected,
plugins declare the Discord permissions they need, the bot computes the invite
permission integer, the marketplace supports version-aware updates with
dependency warnings, and the Restart button deploys (rebuild + register) before
starting. Also: bring the 10 external `~/Projects/adb-plugin-*` plugins up to
the new manifest shape.

## Non-goals

- Plugin-contributed dashboard **widget backend** — left as-is (frontend
  placeholder in `Dashboard.jsx` stays). Explicitly out of scope.
- Git-source plugin installs — npm registry only.
- Sandboxing/enforcement of `discordPermissions` at runtime — this spec only
  *declares, aggregates, and displays* them. Actual capability enforcement is a
  separate concern.

## Decisions (locked)

| Question | Decision |
|---|---|
| Discord perms field | New manifest array `discordPermissions` (separate from internal `permissions`) |
| Core rule | Location-based: `plugins/*` = core (protected), `node_modules/adb-plugin-*` = installable |
| Install/update source | npm registry (`npmPackage` + `version` in `plugins.json`) |
| Restart | Deploy (`npm run deploy`) then start, streamed over WebSocket |
| Invite integer | Computed from enabled plugins' `discordPermissions` — drop hardcoded Administrator `"8"` |
| Widgets | Out of scope |

---

## 1. Core vs installable

**Rule:** a plugin discovered from `plugins/*` is **core**; one from
`node_modules/adb-plugin-*` is **installable**. No manifest flag, no allowlist —
drop a folder into `plugins/` and it becomes core automatically.

`discoverPlugins()` already tags each with `source: "local"` vs `"package"`.

Changes:
- `PluginManager.initPluginState` / `getPluginList()`: expose `core: source === "local"`.
  (Thread `source` from `discoverPlugins` → `loadPlugin` → `pluginState`.)
- `POST /api/plugins/uninstall`: if the target plugin is core, return
  `403 { error: "Core plugins can't be uninstalled. Delete the plugins/<name> folder to remove." }`
  before touching npm.
- Frontend Core tab (already exists): protected badge, no uninstall button.

## 2. Discord permissions + computed integer

### Manifest field

```json
"discordPermissions": ["BanMembers", "KickMembers", "ModerateMembers", "SendMessages"]
```

Values are exact `discord.js` `PermissionsBitField.Flags` keys. Internal
`permissions` (`db.read`, `commands.register`, …) is unchanged and unrelated.

### New module `core/permissions.js`

- `HUMAN_LABELS`: flag → human string (`BanMembers → "Ban Members"`,
  `ModerateMembers → "Timeout Members"`, `ManageWebhooks → "Manage Webhooks"`, …).
  Any flag not in the map falls back to a spaced-out version of the flag name.
- `computePermissionInteger(plugins)`: OR every enabled plugin's declared flags
  via `new PermissionsBitField(flags).bitfield`, return as string (bigint-safe).
- `validateFlags(flags)`: unknown flag names → returned as errors so the caller
  can surface them (see load-time validation).
- `describe(flags)`: `[{ flag, label }]` for UI.

### Load-time validation

In `loadPlugin`, after reading the manifest, validate `discordPermissions`
against known flags. Unknown flag → append to `pluginState.lastError`
(non-fatal; plugin still loads) so a typo is visible in the UI, not silently
dropped.

### Endpoint

`GET /api/plugins/permissions` →
```json
{
  "integer": "1099511631894",
  "byPlugin": [
    { "name": "adb-plugin-moderation", "permissions": [
        { "flag": "BanMembers", "label": "Ban Members" }, ... ] }
  ]
}
```

### Invite link

`/auth/invite` (server.js ~298): replace `permissions: "8"` with the computed
integer from `computePermissionInteger(enabledPlugins)`.

Fallback toggle: env `INVITE_FORCE_ADMIN=true` → keep `"8"`. Default off (only
what plugins need), per decision.

## 3. Marketplace updates (npm, version-aware)

`plugins.json` entries already carry `version` + `npmPackage`. Installed
plugins expose their manifest `version` via `getPluginList()`.

- **Detect:** in `GET /api/plugins/marketplace` (and a new
  `GET /api/plugins/updates`), for each installed package plugin compare
  registry `version` vs installed `version` via semver. If registry is newer →
  `updateAvailable: true` on the marketplace entry / installed card.
  - Add `semver` dependency (already common; if not present, a minimal
    `a>b` compare of dotted ints — but prefer the `semver` package for
    prerelease correctness).
- **Update:** `POST /api/plugins/update { packageName }` →
  `runNpmInstall(packageName@version)` (reuse existing installer, pin version) →
  `pluginManager.loadAll()`.
- **Permissions refresh is automatic:** install/update re-runs `loadAll()`,
  which re-reads every `plugin.json`, so `discordPermissions` and the computed
  integer refresh with no extra code. (Explicit requirement satisfied for free.)

## 4. Dependency warnings

Load-order dependency graph via `dependsOn` (`getDependencies`) already exists.
Add the reverse direction:

- `PluginManager.getDependents(pluginName)` → installed plugins that list
  `pluginName` in their `dependsOn`.
- On **uninstall** and **update** of a plugin with dependents: unless the
  request body carries `confirm: true`, return
  `409 { warning: true, dependents: ["adb-plugin-levels"], message: "..." }`
  instead of acting.
- Frontend catches the warning, shows a confirm dialog
  (*"adb-plugin-levels depends on this. Updating/removing may break it.
  Continue?"*), then re-sends with `confirm: true`.

Current 10 plugins declare no cross-deps, so this is infrastructure for the
general case (and validated against a synthetic dep in tests).

## 5. Restart = deploy + start, streamed

`core/api/restart-bot.js` currently just respawns `node index.js`. New flow,
run in sequence with output streamed to the existing `/ws` WebSocket:

1. `npm run deploy` — `build-plugins.js` (rebuild plugin dashboards) then
   `deploy-commands.js` (register slash commands). Stream stdout/stderr line by
   line as WS messages `{ type: "deploy-log", line }` (reuse the
   `broadcastInstallLog` pattern in server.js).
2. Respawn bot (existing detached SIGTERM-old → spawn-new logic).

- Restart endpoint (`POST /api/plugins/restart`) stays **owner-only**.
- Because the API process is inside the bot process, the restart script is
  already spawned detached and the parent exits — the WS streaming for the
  *deploy* phase happens from the detached script writing to a location the new
  bot's WS can replay, OR (simpler, ponytail) the endpoint runs `npm run deploy`
  **before** spawning the killer script, streaming live over the still-open WS,
  then triggers the respawn. Chosen: **deploy first (streamed, bot still up),
  then restart.** Bot down only during the final respawn (~a few seconds),
  dashboard rebuild happens while it's still serving.
- Frontend: Restart & Deploy button (owner-only) opens a live log drawer;
  reconnects when the bot returns.

## 6. Frontend (`plugins/administration/web/src/pages/Plugins.jsx`)

Existing `Installed / Browse / Core` tabs stay.

- **Installed cards:** Update button when `updateAvailable`; Discord-permission
  chips ("Ban Members", "Send Messages") from `describe()`.
- **Core tab:** protected badge, no uninstall button.
- **Browse:** already wired to `/api/plugins/marketplace`; add a permission
  preview to the detail modal.
- **Top bar (new):** computed permission integer + "Copy for Dev Portal"
  button; Restart & Deploy button (owner-only) with live-log drawer.
- Dependency confirm dialog (shared) for uninstall/update warnings.

Styling follows the existing inline-`styles`/`s` object convention in the file —
no new styling system.

## 7. External plugin migration (`~/Projects/adb-plugin-*`)

Bring all 10 up to the new manifest shape. For each, add a `discordPermissions`
array derived from what the plugin actually does (verify against each plugin's
command/event code at implementation time — do not guess blindly). Starting
map, to be confirmed against code:

| Plugin | Likely `discordPermissions` |
|---|---|
| adb-plugin-aegis | BanMembers, KickMembers, ModerateMembers, ManageMessages, ManageRoles |
| adb-plugin-moderation | BanMembers, KickMembers, ModerateMembers, ManageMessages, ManageChannels |
| adb-plugin-confessions | ManageWebhooks, SendMessages |
| adb-plugin-counting | SendMessages, ManageMessages |
| adb-plugin-giveaways | SendMessages, AddReactions, ManageMessages |
| adb-plugin-invite-tracker | ManageGuild (view invites) |
| adb-plugin-levels | SendMessages, ManageRoles (role rewards) |
| adb-plugin-reminders | SendMessages |
| adb-plugin-todo | SendMessages |
| adb-plugin-template | SendMessages (documented example) |

- `adb-plugin-template`: also update `CREATE-PLUGIN.md` / template so new
  plugins document `discordPermissions`.
- Leave `dependsOn` empty (none cross-depend today).
- Keep internal `permissions` untouched.

## Files touched (summary)

Core:
- `core/PluginManager.js` — thread `source`/`core`, `getDependents`,
  expose `version`/`npmPackage`/`core`/`discordPermissions` in `getPluginList`.
- `core/permissions.js` — **new** (labels, integer, validate, describe).
- `core/pluginRegistry.js` — version-compare helper for updates.
- `core/api/server.js` — core-uninstall guard, `/api/plugins/permissions`,
  `/api/plugins/update`, `/api/plugins/updates`, dependency-warning on
  uninstall/update, deploy-streaming restart, computed invite integer.
- `core/api/restart-bot.js` — deploy-then-start (or endpoint-side deploy).

Frontend:
- `plugins/administration/web/src/pages/Plugins.jsx` — perm chips, update
  buttons, integer top bar, restart drawer, dep-confirm dialog.

Docs/plugins:
- `~/Projects/adb-plugin-*/plugin.json` ×10 — add `discordPermissions`.
- `adb-plugin-template` + `CREATE-PLUGIN.md` — document the field.

## Testing

- `core/permissions.js`: unit test `computePermissionInteger` (empty → "0";
  known set → expected bitfield; unknown flag → validation error).
- `getDependents`: synthetic manifest set with a dep → correct reverse lookup.
- Version compare: `1.0.0` vs `1.1.0` → updateAvailable; equal → false.
- Core guard: uninstall of a `plugins/*` plugin → 403.
- Manual/e2e: install a plugin, confirm integer changes; click Restart, confirm
  deploy log streams then bot returns.
