/**
 * Spawned detached by the API restart endpoint.
 * Kills the old bot process, waits for cleanup, then starts a new detached instance.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PID_FILE = path.join(ROOT, "data", "bot.pid");
const LOG_FILE = path.join(ROOT, "logs", "bot.log");
const ENTRY = path.join(ROOT, "index.js");

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg) {
	const line = `[${new Date().toISOString()}] [restart-bot] ${msg}\n`;
	process.stderr.write(line);
	try {
		fs.appendFileSync(LOG_FILE, line);
	} catch (_) { /* best-effort */ }
}

async function main() {
	log("Restart triggered.");

	// Stop old process
	if (fs.existsSync(PID_FILE)) {
		const raw = fs.readFileSync(PID_FILE, "utf8").trim();
		const oldPid = parseInt(raw, 10);
		if (oldPid && !Number.isNaN(oldPid)) {
			log(`Sending SIGTERM to old process (PID ${oldPid})`);
			try {
				process.kill(oldPid, "SIGTERM");
			} catch (_) {
				log("Old process already gone.");
			}
		}
	}

	log("Waiting for cleanup...");
	await sleep(2000);

	// Start new detached process, output to log file
	fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
	fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

	fs.appendFileSync(LOG_FILE, `\n[${new Date().toISOString()}] ──── Restarted by API ────\n`);

	const logFd = fs.openSync(LOG_FILE, "a");
	const child = spawn("node", [ENTRY], {
		cwd: ROOT,
		env: process.env,
		detached: true,
		stdio: ["ignore", logFd, logFd],
	});

	child.unref();
	fs.closeSync(logFd);

	fs.writeFileSync(PID_FILE, String(child.pid));
	log(`New bot started (PID ${child.pid})`);
}

main().catch((err) => {
	log(`Fatal: ${err.message}`);
	process.exit(1);
});
