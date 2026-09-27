// Run with: node --test plugins/administration/web/checks/dashboard-runtime.cjs
// Uses the dashboard's existing React/Babel/jsdom toolchain, without a build,
// dotenv, a browser network connection, or any live backend.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { JSDOM } = require("jsdom");
const babel = require("@babel/core");

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "http://dashboard.test/dashboard" });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const sourceRoot = path.resolve(__dirname, "../src") + path.sep;
const originalJs = Module._extensions[".js"];
const originalJsx = Module._extensions[".jsx"];
const originalCss = Module._extensions[".css"];
const compile = (module, filename) => {
	if (!filename.startsWith(sourceRoot)) return originalJs(module, filename);
	const { code } = babel.transformSync(fs.readFileSync(filename, "utf8"), {
		filename, babelrc: false, configFile: false,
		presets: [require.resolve("@babel/preset-react")],
		plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
	});
	module._compile(code, filename);
};
Module._extensions[".js"] = compile;
Module._extensions[".jsx"] = compile;
Module._extensions[".css"] = () => {};
after(() => {
	Module._extensions[".js"] = originalJs;
	if (originalJsx) Module._extensions[".jsx"] = originalJsx;
	else delete Module._extensions[".jsx"];
	if (originalCss) Module._extensions[".css"] = originalCss;
	else delete Module._extensions[".css"];
	dom.window.close();
});

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { Simulate } = require("react-dom/test-utils");
const { MemoryRouter, Routes, Route, Outlet, useNavigate } = require("react-router-dom");
const { PluginSettings } = require("../src/pages/PluginSettings.jsx");
const { Plugins } = require("../src/pages/Plugins.jsx");
const MemberPluginPage = require("../src/pages/MemberPluginPage.jsx").default;
const { useApi } = require("../src/hooks/useApi.js");

const PLUGIN = "adb-plugin-runtime";
const GUILD = "100000000000000001";
const ROLE = "200000000000000001";
const CHANNEL = "300000000000000001";
const guildData = {
	guild: { id: GUILD, name: "Runtime guild" },
	roles: [{ id: ROLE, name: "Staff" }], channels: [{ id: CHANNEL, name: "general" }],
	access: { tier: "GUILD_ADMIN", permissions: ["guild.view", "plugins.manage", `plugin.${PLUGIN}.view`, `plugin.${PLUGIN}.configure`] },
};
const settings = {
	settingsSchema: [{ key: "label", type: "string" }, { key: "role", type: "role" }, { key: "channel", type: "channel" }],
	commandPermissions: true, webUi: { memberPages: [{ path: "/items" }] },
	config: { label: "Original", internal: { cursor: 5 }, _commands: { runtime: { enabled: true } } },
};
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return data; } });
const tick = () => act(async () => { await new Promise(setImmediate); });
const button = (container, label) => [...container.querySelectorAll("button")].find((node) => node.textContent.trim() === label);
const click = (node) => act(async () => {
	assert.ok(node, "button exists");
	node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});

async function mount(t, Component, { fetch: fetchFake, data = guildData, route = `/guild/${GUILD}/plugins/${PLUGIN}/settings`, pattern = "/guild/:guildId/plugins/:pluginName/settings" } = {}) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const calls = [];
	const fetcher = async (url, options = {}) => {
		calls.push({ url, ...options });
		if (fetchFake) return fetchFake(url, options);
		if (options.method === "PUT") return json({ config: { label: "Original" } });
		if (url.endsWith("/settings")) return json(settings);
		if (url.endsWith("/commands")) return json({ commands: [{ name: "runtime", enabled: true, allowedRoles: [ROLE] }] });
		assert.fail(`Unexpected request: ${url}`);
	};
	t.mock.method(global, "fetch", fetcher);
	window.fetch = fetcher;
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	let navigate;
	function Layout() {
		navigate = useNavigate();
		return React.createElement(Outlet, { context: { guildData: data } });
	}
	await act(async () => root.render(
		React.createElement(MemoryRouter, { initialEntries: [route], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
			React.createElement(Routes, null,
				React.createElement(Route, { element: React.createElement(Layout) },
					React.createElement(Route, { path: pattern, element: React.createElement(Component) }))))));
	await tick();
	return { container, calls, navigate: (url) => act(async () => navigate(url)) };
}

test("dashboard-runtime: settings pickers use channels and roles from the actual guild response", async (t) => {
	const { container } = await mount(t, PluginSettings);
	assert.ok(container.querySelector(`#field-role option[value="${ROLE}"]`));
	assert.ok(container.querySelector(`#field-channel option[value="${CHANNEL}"]`));
	assert.ok(!container.querySelector('a[href^="/plugin-ui/"]'), "rendered-only pages do not host a plugin web server");
});

test("dashboard-runtime: saving settings submits only declared editable fields", async (t) => {
	const { container, calls } = await mount(t, PluginSettings);
	await click(button(container, "Save Settings"));
	const write = calls.find((call) => call.method === "PUT");
	assert.deepEqual(JSON.parse(write.body), { label: "Original" });
	assert.ok(button(container, "Saved!"));
});

test("dashboard-runtime: rejected settings writes show an error, never Saved", async (t) => {
	const { container } = await mount(t, PluginSettings, { fetch: async (url, options) => {
		if (options.method === "PUT") return json({ error: "Permission was revoked" }, 403);
		return json(url.endsWith("/settings") ? settings : { commands: [] });
	} });
	await click(button(container, "Save Settings"));
	assert.ok(!button(container, "Saved!"));
	assert.match(container.querySelector('[role="alert"]')?.textContent || "", /Permission was revoked/);
});

test("dashboard-runtime: failed command saves retain the dirty state for retry", async (t) => {
	const { container } = await mount(t, PluginSettings, { fetch: async (url, options) => {
		if (options.method === "PUT") return json({ error: "Command save failed" }, 500);
		return json(url.endsWith("/settings") ? settings : { commands: [{ name: "runtime", enabled: true, allowedRoles: [ROLE] }] });
	} });
	await act(async () => Simulate.change(container.querySelector('td input[type="checkbox"]'), { target: { checked: false } }));
	await click(button(container, "Save"));
	assert.ok(button(container, "Save"), "failed write must stay retryable");
	assert.match(container.querySelector('[role="alert"]')?.textContent || "", /Command save failed/);
});

test("dashboard-runtime: view-only grants cannot submit settings or command edits", async (t) => {
	const { container } = await mount(t, PluginSettings, { data: { ...guildData, access: { tier: "MEMBER", permissions: [`plugin.${PLUGIN}.view`] } } });
	assert.equal(button(container, "Save Settings").disabled, true);
	assert.equal(container.querySelector('td input[type="checkbox"]').disabled, true);
});

test("dashboard-runtime: scoped plugin names remain a single API path segment", async (t) => {
	const name = "@runtime/adb-plugin-example";
	const { calls } = await mount(t, PluginSettings, { route: `/guild/${GUILD}/plugins/${encodeURIComponent(name)}/settings` });
	assert.equal(calls[0].url, `/api/guild/${GUILD}/plugins/${encodeURIComponent(name)}/settings`);
});

test("dashboard-runtime: late settings responses cannot overwrite the newly selected plugin", async (t) => {
	let resolveOld;
	const old = new Promise((resolve) => { resolveOld = resolve; });
	const { container, navigate } = await mount(t, PluginSettings, { fetch: async (url) => {
		if (url.includes(`/${PLUGIN}/`) && url.endsWith("/settings")) return old;
		return json(url.endsWith("/settings") ? { ...settings, config: { label: "New plugin" } } : { commands: [] });
	} });
	await navigate(`/guild/${GUILD}/plugins/adb-plugin-new/settings`);
	await tick();
	await act(async () => resolveOld(json(settings)));
	assert.equal(container.querySelector("#field-label").value, "New plugin");
});

test("dashboard-runtime: useApi refetch performs a request rather than leaving loading stuck", async (t) => {
	function View() {
		const { data, loading, refetch } = useApi("/api/runtime");
		return React.createElement("button", { onClick: refetch }, loading ? "Loading" : data.value);
	}
	let sequence = 0;
	const { container } = await mount(t, View, { fetch: async () => json({ value: `result-${++sequence}` }) });
	await click(button(container, "result-1"));
	await tick();
	assert.ok(button(container, "result-2"));
});

test("dashboard-runtime: a failed member action is visible and remains retryable", async (t) => {
	window.history.replaceState(null, "", "/me?path=%2Fitems");
	const view = { type: "list", title: "label", actions: [{ id: "done", label: "Done", op: "set" }] };
	const { container } = await mount(t, MemberPluginPage, {
		route: `/guild/${GUILD}/p/${PLUGIN}`, pattern: "/guild/:guildId/p/:pluginName",
		fetch: async (_url, options) => options.method === "POST" ? json({ error: "Action denied" }, 403) : json({ view, rows: [{ id: "row1", label: "My item" }] }),
	});
	await click(button(container, "Done"));
	assert.match(container.querySelector('[role="alert"]')?.textContent || "", /Action denied/);
	assert.ok(button(container, "Done"));
	assert.match(container.textContent, /My item/);
});

test("dashboard-runtime: installing from the details drawer still requires risk disclosure", async (t) => {
	const { container, calls } = await mount(t, Plugins, { fetch: async (url) => {
		if (url === "/api/me") return json({ isOwner: true });
		if (url.endsWith("/risk-card")) return json({ granted: ["read its own data"], withheld: ["read secrets"] });
		if (url === "/api/plugins/marketplace") return json({ plugins: [{ name: PLUGIN, npmPackage: PLUGIN, version: "1.0.0", description: "Test", author: "Tests" }] });
		if (url.startsWith("https://registry.npmjs.org/")) return json({ readme: "Plugin documentation" });
		if (url === "/api/plugins/permissions") return json({ integer: "0", byPlugin: [] });
		if (url.endsWith("/categories")) return json({ categories: [] });
		return json({ plugins: [] });
	} });
	await click(button(container, "Details"));
	await click(button(container, "Install Plugin"));
	assert.equal(calls.some((call) => call.url === "/api/plugins/install"), false);
	assert.match(container.textContent, /What this plugin can do/);
});

test("dashboard-runtime: brochure links cannot create executable attributes or script URLs", async (t) => {
	const { container } = await mount(t, Plugins, { fetch: async (url) => {
		if (url === "/api/me") return json({ isOwner: true });
		if (url === "/api/plugins/marketplace") return json({ plugins: [{ name: PLUGIN, npmPackage: PLUGIN }] });
		if (url.startsWith("https://registry.npmjs.org/")) return json({ readme: '[Docs](https://docs.test/" onclick="bad)\n[Bad](javascript:bad)' });
		if (url === "/api/plugins/permissions") return json({ integer: "0", byPlugin: [] });
		if (url.endsWith("/categories")) return json({ categories: [] });
		return json({ plugins: [] });
	} });
	await click(button(container, "Details"));
	assert.ok(!container.querySelector(".brochure [onclick]"));
	assert.ok(!container.querySelector('.brochure a[href^="javascript:"]'));
});

test("dashboard-runtime: member page navigation ignores the previous guild's late response", async (t) => {
	window.history.replaceState(null, "", "/me?path=%2Fitems");
	let resolveOld;
	const pending = new Promise((resolve) => { resolveOld = resolve; });
	const view = { type: "list", title: "label", actions: [] };
	const { container, navigate } = await mount(t, MemberPluginPage, {
		route: `/guild/${GUILD}/p/${PLUGIN}`, pattern: "/guild/:guildId/p/:pluginName",
		fetch: async (url) => url.includes(`/${GUILD}/`) ? pending : json({ view, rows: [{ id: "new", label: "New guild" }] }),
	});
	await navigate(`/guild/100000000000000002/p/${PLUGIN}`);
	await tick();
	await act(async () => resolveOld(json({ view, rows: [{ id: "old", label: "Old guild" }] })));
	assert.match(container.textContent, /New guild/);
	assert.doesNotMatch(container.textContent, /Old guild/);
});

test("dashboard-runtime: install completion explicitly tells the owner when activation requires restart", async (t) => {
	const alerts = [];
	t.mock.method(window, "alert", (message) => alerts.push(message));
	const { container } = await mount(t, Plugins, { fetch: async (url) => {
		if (url === "/api/me") return json({ isOwner: true });
		if (url.endsWith("/risk-card")) return json({ granted: ["read data"], withheld: ["read secrets"] });
		if (url === "/api/plugins/install") return json({ ok: true, restartRequired: true });
		if (url === "/api/plugins/marketplace") return json({ plugins: [{ name: PLUGIN, npmPackage: PLUGIN }] });
		if (url === "/api/plugins/permissions") return json({ integer: "0", byPlugin: [] });
		if (url.endsWith("/categories")) return json({ categories: [] });
		return json({ plugins: [] });
	} });
	await click(button(container, "Install"));
	await click(button(container, "Install Plugin"));
	assert.equal(alerts.length, 1);
	assert.match(alerts[0], /restart/i);
});

test("dashboard-runtime: secret inputs never display stored/default values or submit untouched secrets", async (t) => {
	const secretSettings = { ...settings, settingsSchema: [...settings.settingsSchema, { key: "lavalink_password", type: "string", secret: true, default: "secret-default" }], config: { label: "Original", lavalink_password: "stored-secret" }, configuredSecrets: { lavalink_password: true } };
	const fetch = async (url) => json(url.endsWith("/settings") ? secretSettings : { commands: [] });
	const { container, calls } = await mount(t, PluginSettings, { fetch });
	const input = container.querySelector("#field-lavalink_password");
	assert.equal(input.type, "password");
	assert.equal(input.value, "");
	assert.match(input.placeholder, /configured/i);
	await act(async () => Simulate.change(container.querySelector("#field-label"), { target: { value: "Changed" } }));
	await click(button(container, "Save Settings"));
	assert.deepEqual(JSON.parse(calls.find((call) => call.method === "PUT").body), { label: "Changed" });
	const viewer = await mount(t, PluginSettings, { fetch, data: { ...guildData, access: { permissions: [`plugin.${PLUGIN}.view`] } } });
	assert.equal(viewer.container.querySelector("#field-lavalink_password").disabled, true);
	assert.equal(button(viewer.container, "Save Settings").disabled, true);
});

test("dashboard-runtime: secret replacements and explicit clears work without treating a blank input as a clear", async (t) => {
	let configured = true;
	const { container, calls } = await mount(t, PluginSettings, { fetch: async (url, options) => {
		if (options.method === "PUT") {
			const data = JSON.parse(options.body);
			if (Object.hasOwn(data, "lavalink_password")) configured = data.lavalink_password !== "";
		}
		return json(url.endsWith("/settings") ? { settingsSchema: [{ key: "lavalink_password", type: "string", secret: true }], config: {}, configuredSecrets: { lavalink_password: configured } } : { commands: [] });
	} });
	const input = container.querySelector("#field-lavalink_password");
	await act(async () => Simulate.change(input, { target: { value: "draft-secret" } }));
	await act(async () => Simulate.change(input, { target: { value: "" } }));
	await click(button(container, "Save Settings"));
	assert.deepEqual(JSON.parse(calls.filter((call) => call.method === "PUT").at(-1).body), {});
	await act(async () => Simulate.change(input, { target: { value: "replacement-secret" } }));
	await click(button(container, "Saved!") || button(container, "Save Settings"));
	assert.deepEqual(JSON.parse(calls.filter((call) => call.method === "PUT").at(-1).body), { lavalink_password: "replacement-secret" });
	assert.equal(input.value, "");
	await click(button(container, "Clear"));
	await click(button(container, "Saved!") || button(container, "Save Settings"));
	assert.deepEqual(JSON.parse(calls.filter((call) => call.method === "PUT").at(-1).body), { lavalink_password: "" });
	assert.match(input.placeholder, /not configured/i);
});
