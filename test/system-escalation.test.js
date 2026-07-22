/**
 * test/system-escalation.test.js — the owner-approved escalation capabilities
 * (system: env / bot-token / raw-client).
 *
 * These reduce or remove the sandbox, so they must: validate as real
 * capabilities, normalize into permissions, and produce a HIGH-risk disclosure.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { validateCapabilities, CAPABILITY_SCHEMA } = require("../core/capabilities");
const { normalize } = require("../core/manifest-schema");
const { generateRiskCard, generateWithheld } = require("../core/risk-disclosure");

test("system is a known capability category with the three escalations", () => {
	assert.ok(CAPABILITY_SCHEMA.system, "system category exists");
	assert.deepEqual(CAPABILITY_SCHEMA.system.valid, ["env", "bot-token", "raw-client"]);
});

test("valid system capabilities pass validation", () => {
	assert.deepEqual(validateCapabilities({ system: ["raw-client"] }), []);
	assert.deepEqual(validateCapabilities({ system: ["env", "bot-token"] }), []);
});

test("unknown system value is rejected", () => {
	const errs = validateCapabilities({ system: ["root"] });
	assert.equal(errs.length, 1);
	assert.match(errs[0], /Unknown capability: "system:root"/);
});

test("normalize carries system through to permissions", () => {
	const n = normalize({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { system: ["raw-client"] },
	});
	assert.deepEqual(n.permissions.system, ["raw-client"]);
});

test("v1 manifest with system capability migrates into permissions", () => {
	const n = normalize({ capabilities: { system: ["env"] } });
	assert.deepEqual(n.permissions.system, ["env"]);
});

test("each system escalation has a HIGH-risk disclosure statement", () => {
	const card = generateRiskCard({ capabilities: { system: ["env", "bot-token", "raw-client"] } });
	assert.ok(card.some((s) => /environment variables/.test(s)), "env disclosed");
	assert.ok(card.some((s) => /login token/.test(s)), "bot-token disclosed");
	assert.ok(card.some((s) => /WITHOUT the sandbox/.test(s)), "raw-client disclosed");
});

test("a plugin without system withholds the sandbox-escape facets", () => {
	const withheld = generateWithheld({ capabilities: { discord: ["SendMessages"] } });
	assert.ok(withheld.includes("run outside its sandbox with full access to the bot and host machine"));
	assert.ok(withheld.includes("read the bot's environment variables or login token"));
});

test("raw-client plugin no longer withholds the sandbox-escape facet", () => {
	const withheld = generateWithheld({ capabilities: { system: ["raw-client"] } });
	assert.ok(!withheld.includes("run outside its sandbox with full access to the bot and host machine"));
});
