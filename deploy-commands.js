const { Client, Collection, REST, Routes, ApplicationCommandManager } = require("discord.js");
const Database = require("./utils/database");
const { HookBus } = require("./core/HookBus");
const { PluginManager } = require("./core/PluginManager");
const { guildCommandBody } = require("./core/command-sync");
const { createLogger } = require("./core/logger");

async function deployCommands({ clientId, guildId, token, dryRun = false, allowEmpty = false }) {
	if (!/^\d{17,20}$/.test(clientId || "")) throw new Error("A valid CLIENT_ID is required");
	if (!/^\d{17,20}$/.test(guildId || "")) throw new Error("A valid GUILD_ID is required; global overwrites are not supported");
	if (!dryRun && !token) throw new Error("DISCORD_TOKEN is required for deployment");

	const client = new Client({ intents: [] });
	client.commands = new Collection();
	client.hooks = new HookBus(createLogger("DeployHooks"));
	let db;
	let manager;
	try {
		db = await Database.getInstance();
		manager = new PluginManager({ client, db, hooks: client.hooks, config: { commandCollection: true } });
		client.pluginManager = manager;
		// Keep the normal trust boundary: only explicitly raw-client plugins
		// load in-process. No gateway login or ready event is needed to collect.
		manager.enableIsolation();
		await manager.loadAll();
		const commands = guildCommandBody(manager, client, guildId)
			.map((command) => ApplicationCommandManager.transformCommand(command));
		if (!dryRun) {
			if (!commands.length && !allowEmpty) {
				throw new Error("Refusing an empty command overwrite; inspect --dry-run or explicitly pass --allow-empty");
			}
			const rest = new REST({ timeout: 15000 }).setToken(token);
			await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
		}
		return { dryRun, clientId, guildId, count: commands.length, commands };
	} finally {
		try {
			if (manager) await manager.shutdown("command-collection");
		} finally {
			try { await client.destroy(); }
			finally { if (db) await db.close(); }
		}
	}
}

async function main(argv = process.argv.slice(2), env = process.env) {
	if (argv.includes("--help")) {
		console.log("CLIENT_ID=<application> GUILD_ID=<guild> node deploy-commands.js [--dry-run] [--allow-empty]\nRequires the configured MongoDB database; writes require DISCORD_TOKEN. Never performs a global overwrite.");
		return;
	}
	for (const arg of argv) {
		if (!["--dry-run", "--allow-empty"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
	}
	const result = await deployCommands({
		clientId: env.CLIENT_ID, guildId: env.GUILD_ID, token: env.DISCORD_TOKEN,
		dryRun: argv.includes("--dry-run"), allowEmpty: argv.includes("--allow-empty"),
	});
	console.log(JSON.stringify(result, null, 2));
	return result;
}

if (require.main === module) {
	require("dotenv").config();
	main().catch((error) => {
		console.error(`Command deployment failed: ${error.message}`);
		process.exitCode = 1;
	});
}

module.exports = { deployCommands, main };
