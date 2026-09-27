/**
 * test/command-sync.test.js — the per-guild command set respects the plugin
 * enable gate: gated-off plugins' commands are excluded, ungated plugins'
 * commands always included.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { guildCommandBody } = require("../core/command-sync");

function fakeManager({ enabled = [], gateable = [], plugins = {} } = {}) {
	return {
		plugins: new Map(
			Object.entries(plugins).map(([name, commandNames]) => [
				name,
				{ commandNames: new Set(commandNames) },
			]),
		),
		isGuildGateable: (name) => gateable.includes(name),
		isEnabledForGuild: (guildId, name) => enabled.includes(`${guildId}:${name}`),
		getCommandOwner: (command) => Object.entries(plugins).find(([, names]) => names.includes(command.data.name))?.[0] || null,
	};
}

function fakeClient(commandDefs) {
	return { commands: new Map(Object.entries(commandDefs)) };
}

describe("command-sync", () => {
	it("includes commands from ungated plugins regardless of enable state", () => {
		const pm = fakeManager({
			gateable: [],
			plugins: { administration: ["logs", "plugins"] },
		});
		const client = fakeClient({
			logs: { data: { name: "logs" } },
			plugins: { data: { name: "plugins" } },
		});

		const body = guildCommandBody(pm, client, "g1");
		assert.deepEqual(body.map((c) => c.name), ["logs", "plugins"]);
	});

	it("excludes gated-off plugins' commands, includes enabled ones", () => {
		const pm = fakeManager({
			enabled: ["g1:adb-plugin-todo"],
			gateable: ["adb-plugin-todo", "adb-plugin-welcome"],
			plugins: {
				"adb-plugin-todo": ["todo"],
				"adb-plugin-welcome": ["welcome"],
				administration: ["logs"],
			},
		});
		const client = fakeClient({
			todo: { data: { name: "todo" } },
			welcome: { data: { name: "welcome" } },
			logs: { data: { name: "logs" } },
		});

		const body = guildCommandBody(pm, client, "g1");
		assert.deepEqual(body.map((c) => c.name).sort(), ["logs", "todo"]);
	});

	it("gate is per-guild — same plugin enabled in one guild only", () => {
		const pm = fakeManager({
			enabled: ["g1:adb-plugin-todo"],
			gateable: ["adb-plugin-todo"],
			plugins: { "adb-plugin-todo": ["todo"] },
		});
		const client = fakeClient({ todo: { data: { name: "todo" } } });

		assert.equal(guildCommandBody(pm, client, "g1").length, 1);
		assert.equal(guildCommandBody(pm, client, "g2").length, 0);
	});

	it("serializes SlashCommandBuilder-style data via toJSON", () => {
		const pm = fakeManager({ plugins: { administration: ["logs"] } });
		const client = fakeClient({
			logs: { data: { name: "logs", toJSON: () => ({ name: "logs", description: "x" }) } },
		});

		const body = guildCommandBody(pm, client, "g1");
		assert.deepEqual(body, [{ name: "logs", description: "x" }]);
	});
});
