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

function loadEventsFromDir(dirPath, ctx) {
	if (!fs.existsSync(dirPath)) return;

	const items = fs.readdirSync(dirPath, { withFileTypes: true });

	for (const item of items) {
		const fullPath = path.join(dirPath, item.name);

		if (item.isDirectory()) {
			loadEventsFromDir(fullPath, ctx);
			continue;
		}

		if (!item.isFile() || !item.name.endsWith(".js")) continue;

		try {
			const event = require(fullPath);
			if (event && event.name && event.execute) {
				ctx.registerEvent(event.name, event.execute, {
					once: event.once,
				});
			}
		} catch (error) {
			ctx.logger.error(`Failed to load event ${fullPath}`, error);
		}
	}
}

async function load(ctx) {
	loadCommandsFromDir(path.join(__dirname, "commands"), ctx);
	loadEventsFromDir(path.join(__dirname, "events"), ctx);
	ctx.logger.info("AI plugin loaded");
}

module.exports = { load };
