const fs = require("fs");
const path = require("path");

function loadCommandsFromDir(dirPath, ctx) {
	if (!fs.existsSync(dirPath)) return;

	const items = fs.readdirSync(dirPath, { withFileTypes: true });

	for (const item of items) {
		const fullPath = path.join(dirPath, item.name);

		if (item.isDirectory()) {
			loadCommandsFromDir(fullPath, ctx);
			continue;
		}

		if (!item.isFile() || !item.name.endsWith(".js")) continue;

		try {
			const command = require(fullPath);
			if (command && command.data && command.execute) {
				ctx.registerCommand(command);
			}
		} catch (error) {
			ctx.logger.error(`Failed to load command ${fullPath}`, error);
		}
	}
}

async function load(ctx) {
	const commandsDir = path.join(__dirname, "commands");
	loadCommandsFromDir(commandsDir, ctx);
	ctx.logger.info("Economy plugin loaded");
}

module.exports = { load };
