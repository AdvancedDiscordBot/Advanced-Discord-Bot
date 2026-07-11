# Plugin Architecture Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the plugin system into a managed store — protected core plugins, Discord-permission declarations that compute the invite integer, version-aware npm updates, dependency warnings, and a Restart button that deploys before starting.

**Architecture:** Node.js Discord bot (`index.js`) with a `core/PluginManager` that discovers plugins from `plugins/*` (local/core) and `node_modules/adb-plugin-*` (installable). A Fastify API (`core/api/server.js`) serves the React admin dashboard (`plugins/administration/web`) and drives plugin ops. New pure module `core/permissions.js` maps Discord permission flags → labels + aggregate bitfield. Marketplace metadata comes from `core/pluginRegistry.js` (remote `plugins.json`).

**Tech Stack:** Node 22, discord.js 14.26, Fastify, `ws`, `semver`, React 18 (CRA), `lucide-react`, inline-style theme tokens.

## Global Constraints

- `discordPermissions` values MUST be exact `discord.js` `PermissionsBitField.Flags` keys (e.g. `BanMembers`, `SendMessages`). Unknown keys are non-fatal but recorded in `pluginState.lastError`.
- Internal `permissions` field (`db.read`, `commands.register`, …) is UNCHANGED and unrelated to Discord permissions.
- Core = plugin discovered from `plugins/*` (`source === "local"`). Never uninstallable via API.
- Installable = `node_modules/adb-plugin-*` (`source === "package"`).
- Marketplace install/update source = npm registry only (`npmPackage` + `version` from `plugins.json`).
- Invite link uses computed integer; env `INVITE_FORCE_ADMIN=true` forces `"8"` (default off).
- Restart is owner-only (`OWNER_IDS`). Deploy (`npm run deploy`) streams over WS while bot is up, then respawns.
- Tests: `node --test test/` (root `test/` dir). Pure-logic modules only — no network/db in unit tests.
- Commit after every task. Frequent, small commits.

---

## File Structure

**New:**
- `core/permissions.js` — flag→label map, `computePermissionInteger`, `validateFlags`, `describe`.
- `test/permissions.test.js` — unit tests for the above.
- `test/pluginManager.test.js` — unit tests for `getDependents` + core tagging (pure helpers extracted).
- `test/registry-version.test.js` — unit tests for version-compare helper.

**Modified — backend:**
- `core/PluginManager.js` — thread `source`→`core`, expose `version`/`npmPackage`/`core`/`discordPermissions` in `getPluginList()`, add `getDependents()`, validate flags on load.
- `core/pluginRegistry.js` — add `isNewer(installedVersion, registryVersion)` helper; ensure entries expose `version`/`discordPermissions`.
- `core/api/server.js` — core-uninstall guard, `/api/plugins/permissions`, `/api/plugins/update`, dependency-warning on uninstall/update, computed invite integer, deploy-streaming restart.
- `core/api/restart-bot.js` — unchanged logic, but restart endpoint runs deploy first (see Task 9).

**Modified — frontend:**
- `plugins/administration/web/src/pages/Plugins.jsx` — perm chips, Update buttons, integer top bar, Restart drawer, dep-confirm dialog.

**Modified — external plugins + docs:**
- `~/Projects/adb-plugin-*/plugin.json` ×10 — add `discordPermissions`.
- `~/Projects/adb-plugin-template/plugin.json` + `CREATE-PLUGIN.md` — document field.

---

## Task 1: `core/permissions.js` — labels, integer, validate, describe

**Files:**
- Create: `core/permissions.js`
- Test: `test/permissions.test.js`

**Interfaces:**
- Consumes: `discord.js` `PermissionsBitField`.
- Produces:
  - `HUMAN_LABELS: Record<string,string>`
  - `validateFlags(flags: string[]): { valid: string[], invalid: string[] }`
  - `describe(flags: string[]): { flag: string, label: string }[]`
  - `computePermissionInteger(pluginList: { discordPermissions?: string[], enabled?: boolean }[]): string` — OR of all flags from enabled plugins, returned as decimal string ("0" if none).

- [ ] **Step 1: Write the failing test**

```js
// test/permissions.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const {
  computePermissionInteger,
  validateFlags,
  describe: describeFlags,
  HUMAN_LABELS,
} = require("../core/permissions");
const { PermissionsBitField } = require("discord.js");

test("computePermissionInteger empty -> '0'", () => {
  assert.strictEqual(computePermissionInteger([]), "0");
});

test("computePermissionInteger ORs enabled plugin flags", () => {
  const plugins = [
    { enabled: true, discordPermissions: ["BanMembers"] },
    { enabled: true, discordPermissions: ["KickMembers", "BanMembers"] },
  ];
  const expected = new PermissionsBitField([
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers,
  ]).bitfield.toString();
  assert.strictEqual(computePermissionInteger(plugins), expected);
});

test("computePermissionInteger ignores disabled plugins", () => {
  const plugins = [{ enabled: false, discordPermissions: ["BanMembers"] }];
  assert.strictEqual(computePermissionInteger(plugins), "0");
});

test("computePermissionInteger skips unknown flags", () => {
  const plugins = [{ enabled: true, discordPermissions: ["NotARealFlag"] }];
  assert.strictEqual(computePermissionInteger(plugins), "0");
});

test("validateFlags splits valid/invalid", () => {
  const r = validateFlags(["BanMembers", "Nope"]);
  assert.deepStrictEqual(r.valid, ["BanMembers"]);
  assert.deepStrictEqual(r.invalid, ["Nope"]);
});

test("describe maps flags to human labels", () => {
  const r = describeFlags(["BanMembers"]);
  assert.deepStrictEqual(r, [{ flag: "BanMembers", label: "Ban Members" }]);
});

test("describe falls back to spaced flag name for unmapped-but-valid flag", () => {
  // pick a real flag not in HUMAN_LABELS if any; else this asserts label is non-empty
  const r = describeFlags(["AddReactions"]);
  assert.strictEqual(r[0].flag, "AddReactions");
  assert.ok(r[0].label.length > 0);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/permissions.test.js`
Expected: FAIL — `Cannot find module '../core/permissions'`.

- [ ] **Step 3: Implement `core/permissions.js`**

```js
const { PermissionsBitField } = require("discord.js");

const FLAGS = PermissionsBitField.Flags;

// Human-readable labels for the permissions plugins commonly request.
// Any valid flag not listed here falls back to a spaced-out flag name.
const HUMAN_LABELS = {
  BanMembers: "Ban Members",
  KickMembers: "Kick Members",
  ModerateMembers: "Timeout Members",
  ManageMessages: "Manage Messages",
  ManageChannels: "Manage Channels",
  ManageRoles: "Manage Roles",
  ManageGuild: "Manage Server",
  ManageWebhooks: "Manage Webhooks",
  ManageNicknames: "Manage Nicknames",
  ViewAuditLog: "View Audit Log",
  SendMessages: "Send Messages",
  SendMessagesInThreads: "Send Messages in Threads",
  EmbedLinks: "Embed Links",
  AttachFiles: "Attach Files",
  AddReactions: "Add Reactions",
  ReadMessageHistory: "Read Message History",
  MentionEveryone: "Mention Everyone",
  MuteMembers: "Mute Members (Voice)",
  DeafenMembers: "Deafen Members (Voice)",
  MoveMembers: "Move Members (Voice)",
  ViewChannel: "View Channels",
};

function spaceFlag(flag) {
  return flag.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function validateFlags(flags = []) {
  const valid = [];
  const invalid = [];
  for (const flag of flags) {
    if (Object.prototype.hasOwnProperty.call(FLAGS, flag)) valid.push(flag);
    else invalid.push(flag);
  }
  return { valid, invalid };
}

function describe(flags = []) {
  return validateFlags(flags).valid.map((flag) => ({
    flag,
    label: HUMAN_LABELS[flag] || spaceFlag(flag),
  }));
}

function computePermissionInteger(pluginList = []) {
  const bits = new PermissionsBitField();
  for (const plugin of pluginList) {
    if (plugin.enabled === false) continue;
    const { valid } = validateFlags(plugin.discordPermissions || []);
    for (const flag of valid) bits.add(FLAGS[flag]);
  }
  return bits.bitfield.toString();
}

module.exports = { HUMAN_LABELS, validateFlags, describe, computePermissionInteger };
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/permissions.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add core/permissions.js test/permissions.test.js
git commit -m "feat: add core/permissions — flag labels, aggregate integer, validation"
```

---

## Task 2: Thread `core` flag + version/npmPackage/discordPermissions through PluginManager

**Files:**
- Modify: `core/PluginManager.js` (`initPluginState`, `loadPlugin`, `loadCore`, `getPluginList`)

**Interfaces:**
- Consumes: `discoverPlugins()` items already carry `source` ("local" | "package") and `packageName`.
- Produces: each `getPluginList()` entry gains `core: boolean`, `version: string`, `npmPackage: string|null`, `discordPermissions: string[]`, `source: string`.

- [ ] **Step 1: Add `source`/`packageName` to plugin state**

In `initPluginState(pluginName, manifest)` add fields to the returned object:

```js
			path: null,
			entryPath: null,
			source: null,
			packageName: null,
```

- [ ] **Step 2: Set them in `loadPlugin`**

In `loadPlugin(plugin)`, after `pluginState.entryPath = plugin.entryPath;` add:

```js
		pluginState.source = plugin.source || "local";
		pluginState.packageName = plugin.packageName || null;
```

- [ ] **Step 3: Tag core explicitly in `loadCore`**

In `loadCore()`, after `this.plugins.set(pluginName, pluginState);` add:

```js
		pluginState.source = "builtin";
```

(The `core` plugin is neither local nor package but must count as protected — handled in `getPluginList` below.)

- [ ] **Step 4: Expose new fields in `getPluginList`**

Replace the object returned inside `getPluginList()`'s `.map(...)` so it includes:

```js
		return Array.from(this.plugins.values()).map((plugin) => ({
			name: plugin.name,
			displayName: plugin.manifest?.displayName,
			author: plugin.manifest?.author,
			version: plugin.manifest?.version || "0.0.0",
			description: plugin.manifest?.description,
			requiresRestart: !!plugin.manifest?.requiresRestart,
			category: plugin.manifest?.category || null,
			npmPackage: plugin.manifest?.npmPackage || plugin.packageName || null,
			discordPermissions: plugin.manifest?.discordPermissions || [],
			core: plugin.source === "local" || plugin.source === "builtin",
			enabled: plugin.enabled,
			hotReloadEligible: plugin.hotReloadEligible,
			lastError: plugin.lastError,
			overrides: Array.from(plugin.overrides.keys()),
			commands: Array.from(plugin.commandNames),
			hasBrochure: !!(plugin.path && require("fs").existsSync(require("path").join(plugin.path, "Brochure.md"))),
		}));
```

(Keep the existing `fs`/`path` top-of-file requires — they're already imported; the inline `require` above is only if you prefer not to rely on them, but PREFER the existing top-level `fs`/`path`. Use `fs.existsSync(path.join(...))` as the original did.)

- [ ] **Step 5: Manual smoke — list shape**

Run: `node -e "const {PluginManager}=require('./core/PluginManager'); const pm=new PluginManager({client:{commands:new Map(),on(){},once(){},off(){}},db:{},scheduler:{},hooks:{emitHook:async()=>{}}}); pm.plugins.set('administration',pm.initPluginState('administration',{version:'1.0.0',discordPermissions:['BanMembers']})); pm.plugins.get('administration').source='local'; console.log(JSON.stringify(pm.getPluginList()[0],null,0));"`
Expected: JSON containing `"core":true`, `"version":"1.0.0"`, `"discordPermissions":["BanMembers"]`.

- [ ] **Step 6: Commit**

```bash
git add core/PluginManager.js
git commit -m "feat: expose core/version/npmPackage/discordPermissions in plugin list"
```

---

## Task 3: `getDependents` + flag validation on load

**Files:**
- Modify: `core/PluginManager.js` (add `getDependents`, validate flags in `loadPlugin`)
- Test: `test/pluginManager.test.js`

**Interfaces:**
- Produces: `getDependents(pluginName: string): string[]` — names of loaded plugins whose manifest `dependsOn`/`dependencies` includes `pluginName`.

- [ ] **Step 1: Write the failing test**

```js
// test/pluginManager.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { PluginManager } = require("../core/PluginManager");

function makePM() {
  return new PluginManager({
    client: { commands: new Map(), on() {}, once() {}, off() {} },
    db: {}, scheduler: {}, hooks: { emitHook: async () => {} },
  });
}

test("getDependents finds plugins depending on target", () => {
  const pm = makePM();
  const a = pm.initPluginState("adb-plugin-a", { dependsOn: [] });
  const b = pm.initPluginState("adb-plugin-b", { dependsOn: ["adb-plugin-a"] });
  pm.plugins.set("adb-plugin-a", a);
  pm.plugins.set("adb-plugin-b", b);
  assert.deepStrictEqual(pm.getDependents("adb-plugin-a"), ["adb-plugin-b"]);
});

test("getDependents empty when none depend", () => {
  const pm = makePM();
  pm.plugins.set("adb-plugin-a", pm.initPluginState("adb-plugin-a", {}));
  assert.deepStrictEqual(pm.getDependents("adb-plugin-a"), []);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/pluginManager.test.js`
Expected: FAIL — `pm.getDependents is not a function`.

- [ ] **Step 3: Implement `getDependents`**

Add this method to `PluginManager` (near `getDependencies`):

```js
	getDependents(pluginName) {
		const dependents = [];
		for (const [name, state] of this.plugins.entries()) {
			if (name === pluginName) continue;
			const deps = this.getDependencies(state.manifest);
			if (deps.includes(pluginName)) dependents.push(name);
		}
		return dependents;
	}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/pluginManager.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Validate Discord flags on load (non-fatal)**

In `loadPlugin`, inside the `try` block after `await loadFn(ctx);`, add:

```js
			const { validateFlags } = require("./permissions");
			const { invalid } = validateFlags(plugin.manifest?.discordPermissions || []);
			if (invalid.length) {
				pluginState.lastError = `Unknown discordPermissions: ${invalid.join(", ")}`;
				this.logger.warn(`${plugin.name} declares unknown flags: ${invalid.join(", ")}`);
			}
```

- [ ] **Step 6: Commit**

```bash
git add core/PluginManager.js test/pluginManager.test.js
git commit -m "feat: getDependents reverse lookup + non-fatal discordPermissions validation"
```

---

## Task 4: Registry version-compare helper

**Files:**
- Modify: `core/pluginRegistry.js` (add `isNewer`)
- Test: `test/registry-version.test.js`

**Interfaces:**
- Produces: `PluginRegistry.isNewer(installed: string, candidate: string): boolean` — true when `candidate` semver-greater than `installed`. Invalid inputs → false.

- [ ] **Step 1: Write the failing test**

```js
// test/registry-version.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { PluginRegistry } = require("../core/pluginRegistry");

const r = new PluginRegistry();

test("isNewer true when candidate greater", () => {
  assert.strictEqual(r.isNewer("1.0.0", "1.1.0"), true);
});
test("isNewer false when equal", () => {
  assert.strictEqual(r.isNewer("1.0.0", "1.0.0"), false);
});
test("isNewer false when candidate older", () => {
  assert.strictEqual(r.isNewer("2.0.0", "1.9.9"), false);
});
test("isNewer false on garbage input", () => {
  assert.strictEqual(r.isNewer("x", "y"), false);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/registry-version.test.js`
Expected: FAIL — `r.isNewer is not a function`.

- [ ] **Step 3: Implement `isNewer`**

Add `const semver = require("semver");` to the top requires of `core/pluginRegistry.js`, then add the method to `PluginRegistry`:

```js
	isNewer(installed, candidate) {
		const a = semver.valid(semver.coerce(installed));
		const b = semver.valid(semver.coerce(candidate));
		if (!a || !b) return false;
		return semver.gt(b, a);
	}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node --test test/registry-version.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add core/pluginRegistry.js test/registry-version.test.js
git commit -m "feat: registry isNewer semver comparison helper"
```

---

## Task 5: Core-uninstall guard + dependency warning on uninstall

**Files:**
- Modify: `core/api/server.js` (`POST /api/plugins/uninstall`)

**Interfaces:**
- Consumes: `pluginManager.getPluginList()` (has `core`, `name`), `pluginManager.getDependents(name)`.
- Produces: uninstall endpoint returns `403` for core, `409 { warning, dependents, message }` when dependents exist and `confirm` not set.

- [ ] **Step 1: Rewrite the uninstall handler**

Replace the body of `fastify.post("/api/plugins/uninstall", ...)` with:

```js
	fastify.post("/api/plugins/uninstall", async (request, reply) => {
		const { packageName, confirm } = request.body || {};
		if (!packageName) {
			return reply.code(400).send({ error: "Package name required" });
		}

		const pluginList = pluginManager.getPluginList();
		const plugin = pluginList.find(
			(p) => p.name === packageName || p.npmPackage === packageName,
		);

		if (plugin?.core) {
			return reply.code(403).send({
				error: `Core plugins can't be uninstalled. Delete the plugins/${plugin.name} folder to remove it.`,
			});
		}

		if (plugin && !confirm) {
			const dependents = pluginManager.getDependents(plugin.name);
			if (dependents.length) {
				return reply.code(409).send({
					warning: true,
					dependents,
					message: `${dependents.join(", ")} depend on ${plugin.name} and may break.`,
				});
			}
		}

		if (plugin) {
			await pluginManager.unloadPlugin(plugin.name, "uninstall");
		}

		const result = await runNpmUninstall(packageName, logger, broadcastInstallLog);
		if (!result.ok) {
			return reply.code(500).send({ error: result.error });
		}

		await pluginManager.loadAll();
		return { ok: true };
	});
```

- [ ] **Step 2: Manual smoke — core guard**

Start the bot API (or unit-invoke the handler mentally); with the `administration` core plugin present, a POST to `/api/plugins/uninstall {packageName:"administration"}` must return 403 with the delete-folder message. Verify by reading the handler back — no automated test (needs live Fastify+db).

Run (syntax check only): `node -c core/api/server.js`
Expected: no output (valid syntax).

- [ ] **Step 3: Commit**

```bash
git add core/api/server.js
git commit -m "feat: block core-plugin uninstall + warn on dependents"
```

---

## Task 6: Update endpoint + updateAvailable flag in marketplace

**Files:**
- Modify: `core/api/server.js` (`GET /api/plugins/marketplace`, add `POST /api/plugins/update`)

**Interfaces:**
- Consumes: `registry.isNewer`, `runNpmInstall`, `pluginManager.getPluginList()`, `pluginManager.getDependents`.
- Produces:
  - marketplace entries gain `updateAvailable: boolean`, `installedVersion: string|null`.
  - `POST /api/plugins/update { packageName, confirm? }` → installs `packageName@registryVersion`, honors dependent warning (409), returns `{ ok: true }`.

- [ ] **Step 1: Add updateAvailable to marketplace handler**

Replace the `map` in `fastify.get("/api/plugins/marketplace", ...)` return with:

```js
		return {
			plugins: plugins.map((p) => {
				const installedPlugin = installed.find(
					(ip) => ip.npmPackage === p.npmPackage || ip.name === p.name,
				);
				const installedVersion = installedPlugin?.version || null;
				return {
					...p,
					installed: !!installedPlugin,
					installedVersion,
					updateAvailable:
						!!installedVersion && registry.isNewer(installedVersion, p.version),
				};
			}),
		};
```

- [ ] **Step 2: Add the update endpoint**

Immediately after the marketplace handler, add:

```js
	fastify.post("/api/plugins/update", async (request, reply) => {
		const { packageName, confirm } = request.body || {};
		if (!packageName) {
			return reply.code(400).send({ error: "Package name required" });
		}

		const details = await registry.getPluginDetails(packageName);
		if (!details) {
			return reply.code(404).send({ error: "Plugin not found in registry" });
		}

		const installed = pluginManager.getPluginList();
		const current = installed.find(
			(p) => p.npmPackage === packageName || p.name === packageName,
		);

		if (current && !confirm) {
			const dependents = pluginManager.getDependents(current.name);
			if (dependents.length) {
				return reply.code(409).send({
					warning: true,
					dependents,
					message: `${dependents.join(", ")} depend on ${current.name} and may break after this update.`,
				});
			}
		}

		const target = `${details.npmPackage}@${details.version}`;
		const result = await runNpmInstall(target, pluginManager, logger, broadcastInstallLog);
		if (!result.ok) {
			return reply.code(500).send({ error: result.error });
		}
		return { ok: true };
	});
```

- [ ] **Step 3: Syntax check**

Run: `node -c core/api/server.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add core/api/server.js
git commit -m "feat: version-aware update endpoint + updateAvailable in marketplace"
```

---

## Task 7: `/api/plugins/permissions` endpoint + computed invite integer

**Files:**
- Modify: `core/api/server.js` (add permissions endpoint, rewrite `/auth/invite`)

**Interfaces:**
- Consumes: `computePermissionInteger`, `describe` from `core/permissions.js`, `pluginManager.getPluginList()`.
- Produces:
  - `GET /api/plugins/permissions` → `{ integer, byPlugin: [{ name, permissions:[{flag,label}] }] }`.
  - `/auth/invite` uses computed integer unless `INVITE_FORCE_ADMIN=true`.

- [ ] **Step 1: Import the permissions helpers**

At the top of `core/api/server.js` add after the `registry` require:

```js
const { computePermissionInteger, describe: describePermissions } = require("../permissions");
```

- [ ] **Step 2: Add the permissions endpoint**

Near the other `/api/plugins/*` routes (e.g. after `/api/plugins/categories`), add:

```js
	fastify.get("/api/plugins/permissions", async () => {
		const plugins = pluginManager.getPluginList();
		return {
			integer: computePermissionInteger(plugins),
			byPlugin: plugins
				.filter((p) => (p.discordPermissions || []).length)
				.map((p) => ({
					name: p.displayName || p.name,
					permissions: describePermissions(p.discordPermissions),
				})),
		};
	});
```

- [ ] **Step 3: Rewrite `/auth/invite`**

Replace the `params` block in `fastify.get("/auth/invite", ...)`:

```js
	fastify.get("/auth/invite", async (request, reply) => {
		const forceAdmin = process.env.INVITE_FORCE_ADMIN === "true";
		const permissions = forceAdmin
			? "8"
			: computePermissionInteger(pluginManager.getPluginList());
		const params = new URLSearchParams({
			client_id: discordClientId,
			permissions,
			scope: "bot applications.commands",
			integration_type: "0",
		});
		const redirectUrl = `https://discord.com/api/oauth2/authorize?${params}`;
		logger.info(`Redirecting to Bot Invite (perms=${permissions}): ${redirectUrl}`);
		return reply.redirect(redirectUrl);
	});
```

- [ ] **Step 4: Syntax check**

Run: `node -c core/api/server.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add core/api/server.js
git commit -m "feat: permissions endpoint + computed invite integer (INVITE_FORCE_ADMIN fallback)"
```

---

## Task 8: Deploy-then-restart (streamed)

**Files:**
- Modify: `core/api/server.js` (`POST /api/plugins/restart`)

**Interfaces:**
- Consumes: `broadcastInstallLog` (WS emitter), `spawn`, existing `restart-bot.js`.
- Produces: restart runs `npm run deploy` streaming `{ type: "deploy-log", ... }` over WS while the bot is up, then spawns `restart-bot.js` and exits.

**Design note:** deploy runs FIRST while the current process still serves the WS, so the log streams live. Only the final respawn causes downtime.

- [ ] **Step 1: Rewrite the restart handler**

Replace `fastify.post("/api/plugins/restart", ...)` with:

```js
	fastify.post("/api/plugins/restart", async (request, reply) => {
		const ownerIds = parseOwnerIds();
		const isOwner = ownerIds.includes(request.session.user?.id);
		if (!isOwner) {
			return reply.code(403).send({ error: "Only bot owners can restart" });
		}

		logger.info("Deploy + restart requested.");

		// Run deploy while still up, streaming logs over WS.
		const deploy = spawn("npm", ["run", "deploy"], {
			cwd: process.cwd(),
			shell: true,
		});
		const emitDeploy = (message) =>
			broadcastInstallLog({ type: "deploy-log", message });

		deploy.stdout.on("data", (d) => emitDeploy(d.toString()));
		deploy.stderr.on("data", (d) => emitDeploy(d.toString()));

		deploy.on("close", (code) => {
			emitDeploy(`\n── deploy exited with code ${code}; restarting bot ──\n`);
			const restartScript = path.join(__dirname, "restart-bot.js");
			spawn("node", [restartScript], {
				detached: true,
				stdio: "ignore",
				cwd: process.cwd(),
			});
			setTimeout(() => process.exit(0), 500);
		});

		return { ok: true, message: "Deploying, then restarting..." };
	});
```

- [ ] **Step 2: Syntax check**

Run: `node -c core/api/server.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add core/api/server.js
git commit -m "feat: restart runs npm run deploy (streamed) before respawn"
```

---

## Task 9: Frontend — permission chips, integer bar, update buttons, dep-confirm, restart drawer

**Files:**
- Modify: `plugins/administration/web/src/pages/Plugins.jsx`

**Interfaces:**
- Consumes: `useApiFetch().request`, endpoints `/api/plugins`, `/api/plugins/marketplace`, `/api/plugins/permissions`, `/api/plugins/update`, `/api/plugins/uninstall`, `/api/plugins/restart`. WS at `/ws` emitting `{ type:"install-log", payload:{type,message} }` and `{ type:"deploy-log", message }`.
- Produces: UI only.

**Note:** This is a UI task — one deliverable (the updated page), tested manually via `npm run build` + visual check. No unit test framework for CRA components here; keep steps concrete.

- [ ] **Step 1: Fetch permissions integer alongside plugins**

In the `load` callback (~line 44), add a permissions fetch:

```js
      const permsRes = await request("/api/plugins/permissions").catch(() => ({ integer: "0", byPlugin: [] }));
      setPermissions(permsRes);
```

Add state near the other `useState` calls:

```js
  const [permissions, setPermissions] = useState({ integer: "0", byPlugin: [] });
  const [restarting, setRestarting] = useState(false);
  const [deployLog, setDeployLog] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }
```

- [ ] **Step 2: Permission integer top bar**

Above the tab bar (before `{/* Tabs */}`), add:

```jsx
      {permissions.integer !== "0" && (
        <div style={s.permBar}>
          <div>
            <div style={s.permBarLabel}>Required bot permissions</div>
            <code style={s.permInt}>{permissions.integer}</code>
          </div>
          <Button
            onClick={() => navigator.clipboard.writeText(permissions.integer)}
          >
            Copy for Dev Portal
          </Button>
        </div>
      )}
```

Add styles to the `s` object:

```js
  permBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.md, marginBottom: 16 },
  permBarLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  permInt: { fontFamily: fonts.mono, fontSize: fontSize.lg, color: colors.text },
```

(If `colors.surface`/`textMuted`/`fonts.mono` don't exist, use the nearest existing token — check `theme.js` and match. Do not invent tokens.)

- [ ] **Step 3: Restart & Deploy button + WS deploy log**

Add a Restart button in the header area (next to the install button). On click:

```jsx
      <Button
        variant="danger"
        disabled={restarting}
        onClick={handleRestart}
      >
        {restarting ? "Deploying…" : "Restart & Deploy"}
      </Button>
```

Add the handler + WS listener:

```js
  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setDeployLog([]);
    const ws = new window.WebSocket(
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`,
    );
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "deploy-log") {
          setDeployLog((prev) => [...prev, msg.message]);
        }
      } catch { /* ignore */ }
    };
    try {
      await request("/api/plugins/restart", { method: "POST" });
    } catch (err) {
      setDeployLog((prev) => [...prev, `Error: ${err.message}`]);
      setRestarting(false);
    }
  }, [request]);
```

Render a log drawer when `restarting`:

```jsx
      {restarting && (
        <div style={s.deployDrawer}>
          <div style={s.deployHeader}>Deploying & restarting…</div>
          <pre style={s.deployLog}>{deployLog.join("")}</pre>
        </div>
      )}
```

Styles:

```js
  deployDrawer: { position: "fixed", bottom: 16, right: 16, width: 420, maxHeight: 320, background: "#0b0b0b", color: "#d4d4d4", borderRadius: radius.md, overflow: "hidden", zIndex: 50, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" },
  deployHeader: { padding: "8px 12px", fontSize: fontSize.sm, borderBottom: "1px solid #222" },
  deployLog: { margin: 0, padding: 12, fontFamily: fonts.mono, fontSize: 11, overflow: "auto", maxHeight: 260, whiteSpace: "pre-wrap" },
```

- [ ] **Step 4: Permission chips on cards**

Where each installed plugin card renders (the `PluginCard`/detail region), add chips from `plugin.discordPermissions`:

```jsx
      {plugin.discordPermissions?.length > 0 && (
        <div style={s.chipRow}>
          {plugin.discordPermissions.map((flag) => (
            <span key={flag} style={s.permChip}>{humanizeFlag(flag)}</span>
          ))}
        </div>
      )}
```

Add a small local humanizer (mirror of backend labels; keep short — only the common ones, fallback to spacing):

```js
const FLAG_LABELS = {
  BanMembers: "Ban Members", KickMembers: "Kick Members", ModerateMembers: "Timeout Members",
  ManageMessages: "Manage Messages", ManageChannels: "Manage Channels", ManageRoles: "Manage Roles",
  ManageGuild: "Manage Server", ManageWebhooks: "Manage Webhooks", SendMessages: "Send Messages",
  AddReactions: "Add Reactions", EmbedLinks: "Embed Links", AttachFiles: "Attach Files",
};
function humanizeFlag(flag) {
  return FLAG_LABELS[flag] || flag.replace(/([a-z])([A-Z])/g, "$1 $2");
}
```

Styles:

```js
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  permChip: { fontSize: fontSize.xs, padding: "2px 8px", borderRadius: radius.sm, background: colors.border, color: colors.text },
```

- [ ] **Step 5: Update button on installed cards**

For marketplace/installed entries carrying `updateAvailable`, render:

```jsx
      {plugin.updateAvailable && (
        <Button onClick={() => handleUpdate(plugin.npmPackage)}>
          Update to {plugin.version}
        </Button>
      )}
```

Handler with dep-confirm:

```js
  const handleUpdate = useCallback(async (pkg, confirm = false) => {
    setOperating(pkg);
    try {
      await request("/api/plugins/update", {
        method: "POST",
        body: JSON.stringify({ packageName: pkg, confirm }),
      });
      await load();
    } catch (err) {
      // 409 warning path: useApiFetch throws with message; refetch dependents via re-call
      if (err.message && err.message.includes("depend")) {
        setConfirmDialog({
          message: err.message,
          onConfirm: () => { setConfirmDialog(null); handleUpdate(pkg, true); },
        });
      }
    } finally {
      setOperating(null);
    }
  }, [request, load]);
```

**Note:** `useApiFetch` throws `new Error(data.error || 'Request failed')` — the 409 body has `message`, not `error`. Update `useApi.js` to prefer `data.message` when present, OR read the warning inline. Simplest: in `useApiFetch`, change the throw to `throw new Error(data.error || data.message || 'Request failed')`. Apply that one-line change in `plugins/administration/web/src/hooks/useApi.js`.

- [ ] **Step 6: Wire the same dep-confirm into uninstall**

In the existing uninstall handler, wrap with the same 409 pattern: on error containing "depend", set `confirmDialog` whose `onConfirm` re-calls uninstall with `{ ...body, confirm: true }`. Render the dialog:

```jsx
      {confirmDialog && (
        <div style={s.confirmOverlay}>
          <div style={s.confirmBox}>
            <AlertCircle size={20} />
            <p>{confirmDialog.message}</p>
            <div style={s.confirmActions}>
              <Button onClick={() => setConfirmDialog(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirmDialog.onConfirm}>Continue anyway</Button>
            </div>
          </div>
        </div>
      )}
```

Styles:

```js
  confirmOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 },
  confirmBox: { background: colors.surface, padding: 24, borderRadius: radius.md, maxWidth: 420, textAlign: "center" },
  confirmActions: { display: "flex", gap: 12, justifyContent: "center", marginTop: 16 },
```

- [ ] **Step 7: Build the dashboard**

Run: `cd plugins/administration/web && npm run build`
Expected: `Compiled successfully` (warnings OK, no errors). Fix any missing-token references by matching real names in `theme.js`.

- [ ] **Step 8: Commit**

```bash
git add plugins/administration/web/src/pages/Plugins.jsx plugins/administration/web/src/hooks/useApi.js
git commit -m "feat: plugins UI — perm chips, integer bar, update buttons, dep-confirm, restart drawer"
```

---

## Task 10: Migrate external plugins' manifests

**Files:**
- Modify: `~/Projects/adb-plugin-*/plugin.json` ×10
- Modify: `~/Projects/adb-plugin-template/plugin.json`, `Advanced-Discord-Bot/CREATE-PLUGIN.md`

**Interfaces:** none (data + docs).

**Process per plugin:** read the plugin's commands/events to confirm what Discord actions it performs, THEN add a `discordPermissions` array. Do NOT guess blindly — verify against code. Starting map (confirm each):

| Plugin | discordPermissions (verify vs code) |
|---|---|
| adb-plugin-aegis | `["BanMembers","KickMembers","ModerateMembers","ManageMessages","ManageRoles"]` |
| adb-plugin-moderation | `["BanMembers","KickMembers","ModerateMembers","ManageMessages","ManageChannels"]` |
| adb-plugin-confessions | `["ManageWebhooks","SendMessages"]` |
| adb-plugin-counting | `["SendMessages","ManageMessages"]` |
| adb-plugin-giveaways | `["SendMessages","AddReactions","ManageMessages"]` |
| adb-plugin-invite-tracker | `["ManageGuild"]` |
| adb-plugin-levels | `["SendMessages","ManageRoles"]` |
| adb-plugin-reminders | `["SendMessages"]` |
| adb-plugin-todo | `["SendMessages"]` |
| adb-plugin-template | `["SendMessages"]` |

- [ ] **Step 1: For each plugin, inspect then edit**

For each `adb-plugin-X`:
1. `grep -rniE "ban|kick|timeout|\.delete\(|webhook|roles\.(add|set)|reactions|invites" ~/Projects/adb-plugin-X/` to confirm actions.
2. Add the `discordPermissions` key to its `plugin.json` (place after `permissions`), using the verified set.

Example edit (`adb-plugin-moderation/plugin.json`):

```json
  "permissions": ["db.read", "db.write", "commands.register"],
  "discordPermissions": ["BanMembers", "KickMembers", "ModerateMembers", "ManageMessages", "ManageChannels"],
```

- [ ] **Step 2: Validate each JSON**

Run: `for d in ~/Projects/adb-plugin-*; do node -e "JSON.parse(require('fs').readFileSync('$d/plugin.json','utf8')); console.log('ok $d')"; done`
Expected: `ok` for all 10.

- [ ] **Step 3: Document the field in the template + CREATE-PLUGIN.md**

In `CREATE-PLUGIN.md`, add a section explaining `discordPermissions`: exact `PermissionsBitField.Flags` keys, used to compute the invite integer, shown to users as human labels. Reference the flag list.

- [ ] **Step 4: Commit (each repo separately)**

Each external plugin is its own git repo. For each:

```bash
cd ~/Projects/adb-plugin-X && git add plugin.json && git commit -m "feat: declare discordPermissions"
```

Then in the main repo:

```bash
cd ~/Projects/Advanced-Discord-Bot && git add CREATE-PLUGIN.md && git commit -m "docs: document discordPermissions manifest field"
```

---

## Task 11: Full verification pass

**Files:** none (verification).

- [ ] **Step 1: Run all unit tests**

Run: `node --test test/`
Expected: all tests pass (permissions, pluginManager, registry-version).

- [ ] **Step 2: Syntax-check touched backend files**

Run: `node -c core/api/server.js && node -c core/PluginManager.js && node -c core/pluginRegistry.js && node -c core/permissions.js`
Expected: no output.

- [ ] **Step 3: Build dashboard**

Run: `cd plugins/administration/web && npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 4: Manual e2e (documented, run if a live bot+db is available)**

1. Start bot: `npm run start`.
2. Open dashboard → Plugins. Confirm: integer bar shows a non-zero number; core plugin (`administration`) has no uninstall button; installed cards show perm chips.
3. Trigger Restart & Deploy → confirm deploy log streams in the drawer, bot returns.
4. Hit `/auth/invite` → confirm the `permissions=` query param equals the shown integer (not `8`).

- [ ] **Step 5: Final commit if any fixes**

```bash
git add -A && git commit -m "chore: verification fixes for plugin architecture overhaul"
```

---

## Self-Review vs Spec

- §1 Core vs installable → Tasks 2, 5. ✓
- §2 discordPermissions + integer → Tasks 1, 2, 3 (validation), 7 (endpoint + invite). ✓
- §3 Marketplace updates → Tasks 4, 6. ✓
- §4 Dependency warnings → Tasks 3 (getDependents), 5, 6 (409 path), 9 (UI confirm). ✓
- §5 Restart = deploy → Task 8, UI in 9. ✓
- §6 Frontend → Task 9. ✓
- §7 External plugin migration → Task 10. ✓
- Testing → Tasks 1,3,4 (unit) + 11 (integration/manual). ✓

No unresolved placeholders; types (`computePermissionInteger`, `getDependents`, `isNewer`, `describe`) consistent across tasks.
