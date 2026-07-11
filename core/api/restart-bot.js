/**
 * restart-bot.js — Signals the watchdog to perform a deploy + restart.
 *
 * Previously this script tried to kill the old process and spawn a new one
 * from within the bot itself — a fragile suicide pact. Now it simply tells
 * the independent watchdog (adb-watchdog.js) to handle the restart safely.
 *
 * The watchdog runs as a separate daemon and manages the bot as its child
 * process, so the bot never has to orchestrate its own death.
 */

const http = require("http");

var WATCHDOG_PORT = parseInt(process.env.WATCHDOG_PORT, 10);
if (!WATCHDOG_PORT) {
	console.error("[restart-bot] FATAL: WATCHDOG_PORT not set");
	process.exit(1);
}

function log(msg) {
	var line = "[" + new Date().toISOString() + "] [restart-bot] " + msg + "\n";
	process.stderr.write(line);
}

function main() {
	log("Signalling watchdog to restart...");

	var payload = JSON.stringify({});

	var options = {
		hostname: "127.0.0.1",
		port: WATCHDOG_PORT,
		path: "/restart",
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(payload),
		},
		timeout: 5000,
	};

	var req = http.request(options, function (res) {
		var body = "";
		res.on("data", function (chunk) { body += chunk; });
		res.on("end", function () {
			log("Watchdog responded with " + res.statusCode + ": " + body);
			if (res.statusCode === 200) {
				log("Restart triggered successfully. This process will exit now.");
				process.exit(0);
			} else {
				log("Watchdog returned error: " + body);
				process.exit(1);
			}
		});
	});

	req.on("error", function (err) {
		log("Failed to contact watchdog: " + err.message);
		log("Is adb-watchdog running? Use: ./adb-watchdog.sh start");
		process.exit(1);
	});

	req.on("timeout", function () {
		req.destroy();
		log("Timeout contacting watchdog.");
		process.exit(1);
	});

	req.write(payload);
	req.end();
}

main();
