const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateCapabilities } = require("../core/capabilities");
const { generateFullRiskCard } = require("../core/risk-disclosure");

test("voice plugins can declare and disclose Speak permission", () => {
	assert.deepEqual(validateCapabilities({ discord: ["Connect", "Speak"] }), []);
	const card = generateFullRiskCard({ capabilities: { discord: ["Connect", "Speak"] } });
	assert.ok(card.granted.some((statement) => statement.includes("speak")));
});

test("raw-client disclosure never promises file, network or other-plugin isolation", () => {
	const card = generateFullRiskCard({ capabilities: { system: ["raw-client"] } });
	assert.ok(card.granted.some((statement) => statement.includes("WITHOUT the sandbox")));
	assert.deepEqual(card.withheld, []);
});
