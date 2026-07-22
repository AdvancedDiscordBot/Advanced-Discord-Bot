const { test } = require("node:test");
const assert = require("node:assert");
const {
	generateRiskCard,
	generateWithheld,
	generateFullRiskCard,
	diffRiskCards,
	UnmappedCapabilityError,
	RISK_TEMPLATES,
} = require("../core/risk-disclosure");

// ── generateRiskCard ──────────────────────────────────────────────────────��

test("generates fixed wording per discord permission", () => {
	const statements = generateRiskCard({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { discord: ["BanMembers", "ReadMessageHistory"] },
	});
	assert.ok(statements.includes("permanently ban any member from your server"));
	assert.ok(statements.includes("read your server's full message history"));
});

test("same permission always yields the identical sentence", () => {
	const a = generateRiskCard({ manifestVersion: 2, process: { model: "pooled" }, permissions: { discord: ["BanMembers"] } });
	const b = generateRiskCard({ manifestVersion: 2, process: { model: "pooled" }, permissions: { discord: ["BanMembers"] } });
	assert.deepStrictEqual(a, b);
});

test("fills filesystem paths and network hosts into the template", () => {
	const statements = generateRiskCard({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: {
			filesystem: { read: [], write: ["./data", "./cache"] },
			network: { outbound: ["api.openweathermap.org"] },
		},
	});
	assert.ok(statements.includes("modify or delete files in: ./data, ./cache"));
	assert.ok(statements.includes("send data from your server to: api.openweathermap.org"));
});

test("persistent process model surfaces the declared reason", () => {
	const statements = generateRiskCard({
		manifestVersion: 2,
		process: { model: "persistent", persistentReason: "maintains voice connection for music playback" },
		permissions: {},
	});
	assert.ok(
		statements.some((s) => s.includes("run continuously in the background") && s.includes("music playback")),
	);
});

test("empty permissions produce an empty (but valid) card", () => {
	const statements = generateRiskCard({ manifestVersion: 2, process: { model: "pooled" }, permissions: {} });
	assert.deepStrictEqual(statements, []);
});

test("v1 manifest still generates a card via migration", () => {
	const statements = generateRiskCard({ capabilities: { discord: ["SendMessages"], storage: ["own-collection"] } });
	assert.ok(statements.includes("send messages in your server's channels"));
	assert.ok(statements.includes("store and retrieve its own data (isolated from other plugins)"));
});

test("childProcess / nativeAddons have explicit worst-case wording", () => {
	const statements = generateRiskCard({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { childProcess: true, nativeAddons: true },
	});
	assert.ok(statements.includes("launch other programs on the host machine"));
	assert.ok(statements.includes("load native code extensions on the host machine"));
});

// ── fail-loud on unmapped capability ────────────────────────────────────────

test("unmapped capability throws UnmappedCapabilityError, never a blank card", () => {
	// Simulate a capability with no template by temporarily removing one.
	const saved = RISK_TEMPLATES["discord.SendMessages"];
	delete RISK_TEMPLATES["discord.SendMessages"];
	try {
		assert.throws(
			() => generateRiskCard({ manifestVersion: 2, process: { model: "pooled" }, permissions: { discord: ["SendMessages"] } }),
			(err) => {
				assert.ok(err instanceof UnmappedCapabilityError);
				assert.deepStrictEqual(err.unmapped, ["discord.SendMessages"]);
				return true;
			},
		);
	} finally {
		RISK_TEMPLATES["discord.SendMessages"] = saved;
	}
});

// ── diffRiskCards ────────────────────────────────────────────────────────────

test("diffRiskCards reports added permissions on a version bump", () => {
	const prev = { manifestVersion: 2, process: { model: "pooled" }, permissions: { discord: ["SendMessages"] } };
	const next = { manifestVersion: 2, process: { model: "pooled" }, permissions: { discord: ["SendMessages", "ReadMessageHistory"] } };
	const diff = diffRiskCards(prev, next);
	assert.ok(diff.changed);
	assert.deepStrictEqual(diff.added, ["read your server's full message history"]);
	assert.deepStrictEqual(diff.removed, []);
});

test("diffRiskCards reports no change for identical permissions", () => {
	const m = { manifestVersion: 2, process: { model: "pooled" }, permissions: { discord: ["SendMessages"] } };
	const diff = diffRiskCards(m, m);
	assert.strictEqual(diff.changed, false);
});

// ── generateWithheld (negative disclosure) ──────────────────────────────────

test("withheld lists powers the plugin was NOT granted", () => {
	// A minimal plugin: only SendMessages + own storage.
	const withheld = generateWithheld({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { discord: ["SendMessages"], storage: ["own-collection"] },
	});
	assert.ok(withheld.includes("manage your server's members (ban, kick, or timeout)"));
	assert.ok(withheld.includes("manage your server's roles"));
	assert.ok(withheld.includes("read your server's message history"));
	assert.ok(withheld.includes("send data anywhere on the internet"));
	// other plugins' data is structurally always withheld
	assert.ok(withheld.includes("any other plugin's data"));
});

test("a granted power does not appear in the withheld list", () => {
	const withheld = generateWithheld({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { discord: ["BanMembers", "ManageRoles"], network: { outbound: ["api.example.com"] } },
	});
	assert.ok(!withheld.includes("manage your server's members (ban, kick, or timeout)"));
	assert.ok(!withheld.includes("manage your server's roles"));
	assert.ok(!withheld.includes("send data anywhere on the internet"));
	// but powers it still lacks remain listed
	assert.ok(withheld.includes("change your server's settings"));
});

test("other plugins' data is always withheld, even for a maximally-permissioned plugin", () => {
	const withheld = generateWithheld({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: {
			discord: ["BanMembers", "KickMembers", "ManageRoles", "ManageChannels", "ManageGuild", "ReadMessageHistory"],
			storage: ["read-profiles", "write-profiles"],
			network: { outbound: ["api.example.com"] },
			filesystem: { read: ["./assets"], write: ["./data"] },
		},
	});
	assert.deepStrictEqual(withheld, [
		"run outside its sandbox with full access to the bot and host machine",
		"read the bot's environment variables or login token",
		"any other plugin's data",
	]);
});

test("generateFullRiskCard returns both granted and withheld", () => {
	const card = generateFullRiskCard({
		manifestVersion: 2,
		process: { model: "pooled" },
		permissions: { discord: ["SendMessages"], network: { outbound: ["api.openweathermap.org"] } },
	});
	assert.ok(Array.isArray(card.granted));
	assert.ok(Array.isArray(card.withheld));
	assert.ok(card.granted.includes("send data from your server to: api.openweathermap.org"));
	assert.ok(card.withheld.includes("manage your server's members (ban, kick, or timeout)"));
});
