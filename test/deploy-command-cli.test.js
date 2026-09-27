const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const clientId = "123456789012345678";
const guildId = "234567890123456789";

function runCli(t, { args = [], empty = false, badPlugin = false, badDatabase = false, missingGuild = false, commandData = {} } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adb-deploy-cli-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(root, "plugins"));
	fs.mkdirSync(path.join(root, "node_modules"));
	const plugin = (name, source, commandName) => {
		const dir = path.join(root, source, name);
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({
			name, capabilities: { storage: ["own-collection"], discord: ["SendMessages"], scheduler: ["cron"] },
		}));
		fs.writeFileSync(path.join(dir, "index.js"), `
			module.exports.load = async (ctx) => {
				const config = await ctx.db.getPluginConfig("${guildId}", "${name}");
				const factory = (description) => ({ data: { name: "${commandName}", description, ...${JSON.stringify(commandData)} }, execute() {} });
				ctx.registerCommand(factory(config.data.description));
				ctx.registerEvent("ready", () => { throw new Error("ready-only work must not run"); });
				if (ctx.client === null) await ctx.scheduler.schedule("* * * * *", () => {}, "ignored-job");
				else ctx.scheduler.schedule("ignored-job", "* * * * *", () => {});
			};
		`);
	};
	if (!empty) {
		plugin("local", "plugins", "local-command");
		plugin("adb-plugin-enabled", "node_modules", "factory-command");
	}
	plugin("adb-plugin-disabled", "node_modules", "hidden-command");
	if (badPlugin) {
		const dir = path.join(root, "plugins", "broken");
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify({ name: "broken" }));
		fs.writeFileSync(path.join(dir, "index.js"), "exports.load = () => { throw new Error('broken load'); };\n");
	}
	const record = path.join(root, "boundary.jsonl");
	const preload = path.join(root, "deploy-boundary.cjs");
	fs.writeFileSync(preload, `
		const fs = require("node:fs");
		const { EventEmitter } = require("node:events");
		const Module = require("node:module");
		const write = (data) => fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(data) + "\\n");
		const discord = require(${JSON.stringify(path.join(repo, "node_modules/discord.js"))});
		const cron = require(${JSON.stringify(path.join(repo, "node_modules/node-cron"))});
		class TestClient extends discord.Client {
			login() { throw new Error("Discord login is forbidden in the deploy collector"); }
			async destroy() { write({ event: "destroy" }); return super.destroy(); }
		}
		class TestREST extends EventEmitter {
			setToken() { return this; }
			async put(route, { body }) { write({ event: "put", route, body }); return body; }
		}
		const Database = require(${JSON.stringify(path.join(repo, "utils/database.js"))});
		Database.getInstance = async () => {
			write({ event: "database" });
			return {
				async getAllEnabledPluginRows() {
					write({ event: "enabled-rows" });
					${badDatabase ? "throw new Error('enable state unavailable');" : `return [{ guildId: "${guildId}", pluginName: "adb-plugin-enabled" }];`}
				},
				async getPluginConfig() { return { data: { description: "DB-backed factory" } }; },
				async close() { write({ event: "close" }); },
			};
		};
		const originalLoad = Module._load;
		Module._load = function (id, ...rest) {
			if (id === "discord.js") return { ...discord, Client: TestClient, REST: TestREST };
			if (id === "node-cron") return { ...cron, schedule() { write({ event: "unexpected-cron" }); throw new Error("Collector started cron"); } };
			return originalLoad.call(this, id, ...rest);
		};
	`);
	const result = spawnSync(process.execPath, ["--require", preload, path.join(repo, "deploy-commands.js"), ...args], {
		cwd: root, encoding: "utf8", timeout: 10000,
		env: {
			PATH: process.env.PATH,
			CLIENT_ID: clientId,
			...(missingGuild ? {} : { GUILD_ID: guildId }),
			DISCORD_TOKEN: "test-only-discord-token", MONGODB_URI: "mongodb://test.invalid/unused",
		},
	});
	const events = fs.existsSync(record) ? fs.readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
	return { ...result, events };
}

test("deploy CLI dry-run uses real local/npm loaders and persisted enablement without Discord writes or cron", (t) => {
	const result = runCli(t, { args: ["--dry-run"] });
	assert.equal(result.events.filter((event) => event.event === "put").length, 0);
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	const output = JSON.parse(result.stdout.slice(result.stdout.indexOf('{\n  "dryRun"')));
	assert.equal(output.dryRun, true);
	assert.deepEqual(output.commands.map((command) => command.name).sort(), ["factory-command", "local-command"]);
	assert.ok(output.commands.every((command) => command.description === "DB-backed factory"));
	assert.equal(result.events.filter((event) => event.event === "database").length, 1);
	assert.ok(result.events.some((event) => event.event === "enabled-rows"));
	assert.equal(result.events.filter((event) => event.event === "close").length, 1);
	assert.equal(result.events.filter((event) => event.event === "destroy").length, 1);
	assert.equal(result.events.some((event) => event.event === "unexpected-cron"), false);
});

test("deploy CLI requires an explicit guild and never falls back to a global overwrite", (t) => {
	const result = runCli(t, { missingGuild: true });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /GUILD_ID/);
	assert.equal(result.events.some((event) => event.event === "put" || event.event === "database"), false);
});

test("deploy CLI sends the gated body to the requested guild using the mocked REST boundary", (t) => {
	const result = runCli(t);
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	const puts = result.events.filter((event) => event.event === "put");
	assert.equal(puts.length, 1);
	assert.equal(puts[0].route, `/applications/${clientId}/guilds/${guildId}/commands`);
	assert.deepEqual(puts[0].body.map((command) => command.name).sort(), ["factory-command", "local-command"]);
});

for (const dryRun of [true, false]) {
	test(`deploy CLI normalizes Discord command data for ${dryRun ? "dry-run" : "REST PUT"}`, (t) => {
		const result = runCli(t, {
			args: dryRun ? ["--dry-run"] : [],
			commandData: {
				defaultMemberPermissions: "ManageMessages", dmPermission: false,
				options: [{ name: "group", description: "Group", type: 2, options: [
					{ name: "edit", description: "Edit", type: 1, options: [
						{ name: "text", description: "Text", type: 3, minLength: 0, maxLength: 80 },
						{ name: "count", description: "Count", type: 4, minValue: 0, maxValue: 10 },
						{ name: "api", description: "API shape", type: 3, min_length: 1, max_length: 20 },
					] },
				] }],
			},
		});
		assert.equal(result.status, 0, result.stderr || result.error?.message);
		const output = JSON.parse(result.stdout.slice(result.stdout.indexOf('{\n  "dryRun"')));
		const puts = result.events.filter((event) => event.event === "put");
		assert.equal(puts.length, dryRun ? 0 : 1);
		if (!dryRun) assert.deepEqual(puts[0].body, output.commands);
		for (const command of output.commands) {
			assert.equal(command.default_member_permissions, "8192");
			assert.equal(command.defaultMemberPermissions, undefined);
			assert.equal(command.dm_permission, false);
			assert.deepEqual(command.options[0].options[0].options, [
				{ name: "text", description: "Text", type: 3, required: false, min_length: 0, max_length: 80 },
				{ name: "count", description: "Count", type: 4, required: false, min_value: 0, max_value: 10 },
				{ name: "api", description: "API shape", type: 3, required: false, min_length: 1, max_length: 20 },
			]);
		}
	});
}

for (const [name, options, error] of [
	["empty collection", { empty: true }, /empty/i],
	["plugin load failure", { badPlugin: true }, /broken load|failed/i],
	["unavailable enable state", { badDatabase: true }, /enable state unavailable/i],
]) {
	test(`deploy CLI refuses destructive writes after ${name}`, (t) => {
		const result = runCli(t, options);
		assert.equal(result.status, 1, result.stderr || result.error?.message);
		assert.match(result.stderr, error);
		assert.equal(result.events.some((event) => event.event === "put"), false);
		assert.equal(result.events.filter((event) => event.event === "close").length, 1);
	});
}
