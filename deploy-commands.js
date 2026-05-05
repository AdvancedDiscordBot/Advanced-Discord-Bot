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
			// Recursively load commands from subdirectories
			loadCommandsFromDirectory(fullPath);
		} else if (item.isFile() && item.name.endsWith(".js")) {
			// Load command file
			try {
				const command = require(fullPath);

				if ("data" in command && "execute" in command) {
					commands.push(command.data.toJSON());

					// Determine category from folder structure
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
loadCommandsFromDirectory(commandsPath);
loadPluginCommands(pluginsPath);

// 🌐 Initialize REST client
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// 🚀 Deploy commands
(async () => {
	try {
		console.log(`\n🗑️ Clearing existing commands...`);

		// Clear existing commands first to prevent duplicates
		if (process.env.GUILD_ID) {
			await rest.put(
				Routes.applicationGuildCommands(
					process.env.CLIENT_ID,
					process.env.GUILD_ID,
				),
				{ body: [] },
			);
			console.log("✅ Cleared guild commands");
		} else {
			await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
				body: [],
			});
			console.log("✅ Cleared global commands");
		}

		console.log(
			`\n🚀 Started refreshing ${commands.length} application (/) commands.`,
		);

		// Register new commands
		const data = process.env.GUILD_ID
			? await rest.put(
					Routes.applicationGuildCommands(
						process.env.CLIENT_ID,
						process.env.GUILD_ID,
					),
					{ body: commands },
				)
			: await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
					body: commands,
				});

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
		console.error("❌ Error deploying commands:", error);
	}
})();
