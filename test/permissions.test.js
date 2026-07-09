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
