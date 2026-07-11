# Task 1: core/permissions.js — labels, integer, validate, describe

**Files:**
- Create: `core/permissions.js`
- Test: `test/permissions.test.js`

**Produces (exact signatures later tasks depend on):**
- `HUMAN_LABELS: Record<string,string>`
- `validateFlags(flags: string[]): { valid: string[], invalid: string[] }`
- `describe(flags: string[]): { flag: string, label: string }[]`
- `computePermissionInteger(pluginList: { discordPermissions?: string[], enabled?: boolean }[]): string` — OR of all flags from enabled plugins as decimal string ("0" if none).

## Step 1: Write the failing test at `test/permissions.test.js`

```js
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
  const r = describeFlags(["AddReactions"]);
  assert.strictEqual(r[0].flag, "AddReactions");
  assert.ok(r[0].label.length > 0);
});
```

## Step 2: Run test, verify it FAILS

Run: `node --test test/permissions.test.js`
Expected: FAIL — `Cannot find module '../core/permissions'`.

## Step 3: Implement `core/permissions.js`

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

## Step 4: Run test, verify it PASSES

Run: `node --test test/permissions.test.js`
Expected: PASS (7 tests).

## Step 5: Commit

```bash
git add core/permissions.js test/permissions.test.js
git commit -m "feat: add core/permissions — flag labels, aggregate integer, validation"
```
