const { REST, Routes } = require("discord.js");
const { readdirSync, existsSync } = require("fs");
const path = require("path");
require("dotenv").config();

// 🚀 Initialize commands array
const commands = [];

// 📁 Load all command files
const commandsPath = path.join(__dirname, "commands");
const pluginsPath = path.join(__dirname, "plugins");

console.log("🔄 Loading commands...");

// Function to recursively load commands from folders
function loadCommandsFromDirectory(dirPath) {
	const items = readdirSync(dirPath, { withFileTypes: true });

	for (const item of items) {
		const fullPath = path.join(dirPath, item.name);

		if (item.isDirectory()) {
			loadCommandsFromDirectory(fullPath);
		} else if (item.isFile() && item.name.endsWith(".js")) {
			try {
				const command = require(fullPath);

				if ("data" in command && "execute" in command) {
					commands.push(command.data.toJSON());

					const relativePath = path.relative(commandsPath, fullPath);
					const category =
						path.dirname(relativePath) === "."
							? "root"
							: path.dirname(relativePath);

					console.log(`✅ Loaded: ${command.data.name} (${category})`);
				} else {
					console.log(
						`⚠️ Skipped: ${fullPath} (missing "data" or "execute" property)`,
					);
				}
			} catch (error) {
				console.error(`❌ Error loading command ${fullPath}:`, error.message);
			}
		}
	}
}

function loadPluginCommands(pluginsDir) {
	if (!pluginsDir) return;

	if (!existsSync(pluginsDir)) {
		return;
	}

	const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true });

	for (const pluginDir of pluginDirs) {
		if (!pluginDir.isDirectory()) continue;

		const pluginCommandsPath = path.join(
			pluginsDir,
			pluginDir.name,
			"commands",
		);

		if (!existsSync(pluginCommandsPath)) {
			continue;
		}

		loadCommandsFromDirectory(pluginCommandsPath);
	}
}

// Load all commands
if (existsSync(commandsPath)) {
	loadCommandsFromDirectory(commandsPath);
}
loadPluginCommands(pluginsPath);

// 🌐 Initialize REST client
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// ⏱️ Timeout wrapper — forces rejection if Discord hangs instead of responding
const withTimeout = (promise, ms = 15000) =>
	Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(
				() =>
					reject(
						Object.assign(new Error("timeout"), {
							status: 429,
							retryAfter: 60,
						}),
					),
				ms,
			),
		),
	]);

// 🔁 Retry wrapper — waits on rate limit and retries automatically
const deployWithRetry = async (route, body, retries = 5) => {
	for (let i = 0; i < retries; i++) {
		try {
			return await withTimeout(rest.put(route, { body }));
		} catch (error) {
			if (error.status === 429) {
				const wait = (error.retryAfter ?? 60) * 1000;
				console.log(
					`⏳ Rate limited. Waiting ${wait / 1000}s before retry ${i + 1}/${retries}...`,
				);
				await new Promise((r) => setTimeout(r, wait));
			} else {
				throw error;
			}
		}
	}
	throw new Error("Max retries exceeded");
};

// 🚀 Deploy commands
(async () => {
	try {
		console.log(
			`\n🚀 Started refreshing ${commands.length} application (/) commands.`,
		);

		// Optional: log REST responses for debugging
		rest.on("response", (req, res) => {
			console.log(`[REST] ${req.method} ${req.path} → ${res.status}`);
		});

		// Single PUT replaces all existing commands — no need to clear first
		const data = await deployWithRetry(
			process.env.GUILD_ID
				? Routes.applicationGuildCommands(
						process.env.CLIENT_ID,
						process.env.GUILD_ID,
					)
				: Routes.applicationCommands(process.env.CLIENT_ID),
			commands,
		);

		console.log(
			`✅ Successfully reloaded ${data.length} application (/) commands.`,
		);
		console.log(
			`📍 Deployment: ${
				process.env.GUILD_ID
					? "Guild-specific (Development)"
					: "Global (Production)"
			}`,
		);

		// 📋 List deployed commands
		console.log("\n📋 Deployed commands:");
		commands.forEach((cmd, index) => {
			console.log(`${index + 1}. /${cmd.name} - ${cmd.description}`);
		});

		console.log("\n🎉 Command deployment completed successfully!");
	} catch (error) {
		console.error("❌ Error deploying commands:", error.message);
		process.exit(1);
	}
})();
