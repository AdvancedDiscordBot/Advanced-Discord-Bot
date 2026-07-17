const { test } = require("node:test");
const assert = require("node:assert");
const {
	CAPABILITY_SCHEMA,
	validateCapabilities,
	hasCapability,
	describeCapabilities,
	emptyCapabilities,
} = require("../core/capabilities");

// ── validateCapabilities ──────────────────────────────────────────────────

test("validateCapabilities returns empty for valid caps", () => {
	const errors = validateCapabilities({
		discord: ["SendMessages"],
		storage: ["own-collection"],
	});
	assert.deepStrictEqual(errors, []);
});

test("validateCapabilities returns empty for empty object", () => {
	assert.deepStrictEqual(validateCapabilities({}), []);
});

test("validateCapabilities returns empty for undefined", () => {
	assert.deepStrictEqual(validateCapabilities(undefined), []);
});

test("validateCapabilities rejects unknown category", () => {
	const errors = validateCapabilities({ nuclear: ["launch"] });
	assert.strictEqual(errors.length, 1);
	assert.ok(errors[0].includes("nuclear"));
	assert.ok(errors[0].includes("Unknown capability category"));
});

test("validateCapabilities rejects unknown value in valid category", () => {
	const errors = validateCapabilities({ discord: ["ObliterateServer"] });
	assert.strictEqual(errors.length, 1);
	assert.ok(errors[0].includes("ObliterateServer"));
	assert.ok(errors[0].includes("Unknown capability"));
});

test("validateCapabilities rejects non-array category value", () => {
	const errors = validateCapabilities({ discord: "SendMessages" });
	assert.strictEqual(errors.length, 1);
	assert.ok(errors[0].includes("must be an array"));
});

test("validateCapabilities rejects non-string capability value", () => {
	const errors = validateCapabilities({ discord: [42] });
	assert.strictEqual(errors.length, 1);
	assert.ok(errors[0].includes("must be a string"));
});

test("validateCapabilities collects multiple errors", () => {
	const errors = validateCapabilities({
		nuclear: ["launch"],
		discord: ["FakeFlag"],
	});
	assert.strictEqual(errors.length, 2);
});

test("validateCapabilities accepts all valid discord capabilities", () => {
	const allDiscord = CAPABILITY_SCHEMA.discord.valid;
	const errors = validateCapabilities({ discord: allDiscord });
	assert.deepStrictEqual(errors, []);
});

test("validateCapabilities accepts all valid storage capabilities", () => {
	const allStorage = CAPABILITY_SCHEMA.storage.valid;
	const errors = validateCapabilities({ storage: allStorage });
	assert.deepStrictEqual(errors, []);
});

test("validateCapabilities accepts multiple categories", () => {
	const errors = validateCapabilities({
		discord: ["SendMessages", "EmbedLinks"],
		storage: ["own-collection"],
		hooks: ["subscribe"],
	});
	assert.deepStrictEqual(errors, []);
});

// ── hasCapability ─────────────────────────────────────────────────────────

test("hasCapability returns true when capability is declared", () => {
	const caps = { discord: ["SendMessages", "EmbedLinks"] };
	assert.strictEqual(hasCapability(caps, "discord:SendMessages"), true);
});

test("hasCapability returns false when capability is not declared", () => {
	const caps = { discord: ["SendMessages"] };
	assert.strictEqual(hasCapability(caps, "discord:BanMembers"), false);
});

test("hasCapability returns false for empty caps", () => {
	assert.strictEqual(hasCapability({}, "discord:SendMessages"), false);
});

test("hasCapability returns false for undefined caps", () => {
	assert.strictEqual(hasCapability(null, "discord:SendMessages"), false);
});

test("hasCapability returns true for wildcard", () => {
	const caps = { discord: ["*"] };
	assert.strictEqual(hasCapability(caps, "discord:BanMembers"), true);
	assert.strictEqual(hasCapability(caps, "discord:SendMessages"), true);
});

test("hasCapability handles malformed requiredCap (no colon)", () => {
	const caps = { discord: ["SendMessages"] };
	assert.strictEqual(hasCapability(caps, "SendMessages"), false);
});

test("hasCapability checks correct category", () => {
	const caps = { storage: ["own-collection"] };
	assert.strictEqual(hasCapability(caps, "storage:own-collection"), true);
	assert.strictEqual(hasCapability(caps, "discord:SendMessages"), false);
});

// ── describeCapabilities ──────────────────────────────────────────────────

test("describeCapabilities returns entries for non-empty categories", () => {
	const result = describeCapabilities({
		discord: ["SendMessages"],
		storage: [],
	});
	assert.strictEqual(result.length, 1);
	assert.strictEqual(result[0].category, "discord");
	assert.deepStrictEqual(result[0].values, ["SendMessages"]);
	assert.ok(result[0].description.length > 0);
});

test("describeCapabilities returns empty for empty caps", () => {
	assert.deepStrictEqual(describeCapabilities({}), []);
});

test("describeCapabilities returns empty for undefined", () => {
	assert.deepStrictEqual(describeCapabilities(undefined), []);
});

// ── emptyCapabilities ─────────────────────────────────────────────────────

test("emptyCapabilities returns empty object", () => {
	const caps = emptyCapabilities();
	assert.deepStrictEqual(caps, {});
});
