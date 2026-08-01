const { test } = require("node:test");
const assert = require("node:assert");

const { normalize, validateManifestV2 } = require("../core/manifest-schema");
const PluginManager = require("../core/PluginManager").PluginManager;

// ── manifest normalize ────────────────────────────────────────────────────

test("normalize keeps valid memberPages and drops junk entries", () => {
	const m = normalize({
		manifestVersion: 2,
		name: "x",
		webUi: {
			port: 3100,
			memberPages: [
				{ path: "/me/rank", label: "My Rank", icon: "star" },
				{ path: "/me/rank", label: "Dup path" }, // dropped: duplicate path
				{ path: "  ", label: "empty path" }, // dropped
				{ label: "no path" }, // dropped
				{ path: "/x" }, // dropped: no label
				"not-an-object", // dropped
			],
		},
	});
	assert.deepStrictEqual(m.webUi.memberPages, [
		{ path: "/me/rank", label: "My Rank", icon: "star", rendered: false, source: null, view: null },
	]);
});

test("normalize keeps rendered spec (source + view + actions) and marks rendered:true", () => {
	const m = normalize({
		manifestVersion: 2,
		name: "x",
		webUi: {
			memberPages: [
				{
					path: "/me/todos",
					label: "My To-Do",
					source: { model: "todo", scope: "anything", sort: { createdAt: -1 }, limit: 1000 },
					view: {
						type: "list",
						title: "content",
						badge: "done",
						actions: [
							{ id: "toggle", label: "Done", op: "set", field: "done", value: true },
							{ id: "del", label: "Delete", op: "delete" },
							{ id: "bad", label: "No op" }, // dropped: missing op
							{ id: "bad2", label: "set no field", op: "set" }, // dropped: set needs field
						],
					},
				},
			],
		},
	});
	const [p] = m.webUi.memberPages;
	assert.strictEqual(p.rendered, true);
	assert.strictEqual(p.source.model, "todo");
	assert.strictEqual(p.source.scope, "member"); // forced to member regardless of input
	assert.strictEqual(p.source.limit, 500); // capped
	assert.strictEqual(p.view.type, "list");
	assert.deepStrictEqual(
		p.view.actions.map((a) => a.id),
		["toggle", "del"],
	);
});

test("normalize drops rendered spec with bad view.type", () => {
	const m = normalize({
		manifestVersion: 2,
		name: "x",
		webUi: {
			memberPages: [
				{ path: "/me/x", label: "X", source: { model: "m" }, view: { type: "pie" } },
			],
		},
	});
	// Unusable view → not rendered (view nulled, so no server data binding).
	assert.strictEqual(m.webUi.memberPages[0].rendered, false);
	assert.strictEqual(m.webUi.memberPages[0].view, null);
});

test("normalize defaults memberPages to [] when absent", () => {
	const m = normalize({ manifestVersion: 2, name: "x", webUi: { port: 3100 } });
	assert.deepStrictEqual(m.webUi.memberPages, []);
});

// ── manifest validate ─────────────────────────────────────────────────────

function base(webUi) {
	return {
		manifestVersion: 2,
		name: "x",
		version: "1.0.0",
		main: "index.js",
		permissions: { web: ["host-ui"] },
		webUi,
	};
}

test("validate accepts well-formed memberPages", () => {
	const errors = validateManifestV2(
		base({ port: 3100, memberPages: [{ path: "/rank", label: "Rank" }] }),
	);
	assert.deepStrictEqual(
		errors.filter((e) => e.includes("memberPages")),
		[],
	);
});

test("validate rejects non-array, missing path/label, and relative path", () => {
	const notArray = validateManifestV2(base({ port: 3100, memberPages: {} }));
	assert.ok(notArray.some((e) => e.includes("memberPages must be an array")));

	const bad = validateManifestV2(
		base({
			port: 3100,
			memberPages: [{ label: "no path" }, { path: "rank", label: "rel" }],
		}),
	);
	assert.ok(bad.some((e) => e.includes("memberPages[0].path is required")));
	assert.ok(bad.some((e) => e.includes('memberPages[1].path must start with "/"')));
});

test("validate: rendered page needs no host-ui or port", () => {
	// No permissions.web:["host-ui"], no webUi.port — only a rendered page.
	const errors = validateManifestV2({
		manifestVersion: 2,
		name: "x",
		version: "1.0.0",
		main: "index.js",
		permissions: {},
		process: { mode: "in-process" },
		webUi: {
			memberPages: [
				{
					path: "/me/todos",
					label: "My To-Do",
					source: { model: "todo" },
					view: { type: "list", title: "content" },
				},
			],
		},
	});
	// A rendered page must not demand host-ui or a port.
	assert.ok(!errors.some((e) => e.toLowerCase().includes("host-ui")), errors.join("; "));
	assert.ok(!errors.some((e) => e.includes("webUi.port")), errors.join("; "));
	assert.deepStrictEqual(
		errors.filter((e) => e.includes("memberPages")),
		[],
	);
});

test("validate: iframe page (port, no rendered spec) still requires host-ui", () => {
	const errors = validateManifestV2({
		manifestVersion: 2,
		name: "x",
		version: "1.0.0",
		main: "index.js",
		permissions: {}, // missing web:host-ui
		webUi: { port: 3100, memberPages: [{ path: "/rank", label: "Rank" }] },
	});
	assert.ok(errors.some((e) => e.toLowerCase().includes("host-ui")));
});

// ── getMemberPages gating ──────────────────────────────────────────────────

function makeManager(plugins = []) {
	const pm = new PluginManager({ client: {}, db: {}, scheduler: {}, hooks: {} });
	pm.plugins = new Map(plugins.map((p) => [p.name, p]));
	pm._enableIndexAt = Date.now(); // freeze index; no db refresh
	return pm;
}

function pluginWithPages(name, pages, { source = "package", raw = false } = {}) {
	return {
		name,
		source,
		manifest: {
			capabilities: { system: raw ? ["raw-client"] : [] },
			webUi: { port: 3100, memberPages: pages },
		},
	};
}

test("getMemberPages only returns pages for plugins enabled in that guild", () => {
	const pm = makeManager([
		pluginWithPages("ranks", [{ path: "/rank", label: "My Rank" }]),
	]);
	// Gateable package plugin: off until enabled.
	assert.deepStrictEqual(pm.getMemberPages("g1"), []);

	pm.setEnabledForGuild("g1", "ranks", true);
	assert.deepStrictEqual(pm.getMemberPages("g1"), [
		{ pluginName: "ranks", port: 3100, path: "/rank", label: "My Rank", icon: null, rendered: false },
	]);
	// Still off for another guild.
	assert.deepStrictEqual(pm.getMemberPages("g2"), []);
});

test("getMemberPages includes always-on (non-gateable) plugins", () => {
	const pm = makeManager([
		pluginWithPages("core-portal", [{ path: "/p", label: "P" }], { source: "local" }),
	]);
	assert.deepStrictEqual(pm.getMemberPages("g1"), [
		{ pluginName: "core-portal", port: 3100, path: "/p", label: "P", icon: null, rendered: false },
	]);
});

test("getMemberPages skips plugins with no memberPages", () => {
	const pm = makeManager([
		{ name: "noui", source: "local", manifest: { capabilities: {} } },
		{
			name: "uinopages",
			source: "local",
			manifest: { capabilities: {}, webUi: { port: 3100, memberPages: [] } },
		},
	]);
	assert.deepStrictEqual(pm.getMemberPages("g1"), []);
});

test("getMemberPages carries rendered view/source and needs no port", () => {
	const rendered = normalize({
		manifestVersion: 2,
		name: "todos",
		webUi: {
			memberPages: [
				{
					path: "/me/todos",
					label: "My To-Do",
					source: { model: "todo", sort: { createdAt: -1 } },
					view: { type: "list", title: "content", badge: "done" },
				},
			],
		},
	});
	const pm = makeManager([
		{ name: "todos", source: "local", manifest: { capabilities: { system: [] }, webUi: rendered.webUi } },
	]);
	const pages = pm.getMemberPages("g1");
	assert.strictEqual(pages.length, 1);
	const [p] = pages;
	assert.strictEqual(p.rendered, true);
	assert.strictEqual(p.port, null); // no port for a purely rendered plugin
	assert.strictEqual(p.view.type, "list");
	assert.strictEqual(p.source.model, "todo");
	assert.strictEqual(p.source.scope, "member");
});
