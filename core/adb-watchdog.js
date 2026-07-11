#!/usr/bin/env node
/**
 * adb-watchdog.js — Independent process manager + reverse proxy for ADB.
 *
 * Sits in front of the bot and:
 *   1. Manages the bot's lifecycle (start, stop, restart, crash recovery)
 *   2. Proxies ALL bot traffic (/api/*, /dashboard/*, /ws, /auth/*)
 *   3. Stays alive during bot restarts so the Cloudflare Tunnel never drops
 *
 * Architecture:
 *   Cloudflare Tunnel → Watchdog (port 3008) → proxies to Bot (port 3009)
 *                        ↑ stays alive            ↑ may restart / crash
 *
 * Usage:
 *   node core/adb-watchdog.js          (start watchdog daemon)
 *   curl http://localhost:3008/status   (check bot status)
 *   curl -X POST http://localhost:3008/restart   (deploy + restart)
 *   curl -X POST http://localhost:3008/stop      (stop bot)
 *   curl -X POST http://localhost:3008/start     (start bot)
 */

const http = require("http");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { unsign: unsignCookie } = require("@fastify/cookie");
const MongoStore = require("connect-mongo");

// ── Config ──────────────────────────────────────────────────────────────
const ROOT = process.cwd();
const PID_FILE = path.join(ROOT, "data", "bot.pid");
const LOG_FILE = path.join(ROOT, "logs", "bot.log");
const ENTRY = path.join(ROOT, "index.js");
const WATCHDOG_PORT = parseInt(process.env.WATCHDOG_PORT, 10);
const BOT_PORT = parseInt(process.env.BOT_API_PORT, 10);
const WATCHDOG_PID_FILE = path.join(ROOT, "data", "watchdog.pid");
const BOT_HOST = "127.0.0.1";

if (!WATCHDOG_PORT) {
	console.error("[watchdog] FATAL: WATCHDOG_PORT not set in .env");
	process.exit(1);
}
if (!BOT_PORT) {
	console.error("[watchdog] FATAL: BOT_API_PORT not set in .env");
	process.exit(1);
}

// ── State ───────────────────────────────────────────────────────────────
let botProcess = null;
let botStartedAt = null;
let crashCount = 0;
let restartInProgress = false;
let shuttingDown = false;
let manualStop = false;
let wsClients = new Set();
let wss = null;

// ── Logging ─────────────────────────────────────────────────────────────
function log(level, msg) {
	var line = "[" + new Date().toISOString() + "] [watchdog] [" + level + "] " + msg + "\n";
	process.stderr.write(line);
	try {
		fs.appendFileSync(LOG_FILE, line);
	} catch (_) {}
}

// ── Bot lifecycle ───────────────────────────────────────────────────────
function startBot() {
	if (botProcess) {
		log("warn", "startBot called but bot is already running");
		return;
	}

	fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
	fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });

	var logFd = fs.openSync(LOG_FILE, "a");
	fs.appendFileSync(logFd, "\n[" + new Date().toISOString() + "] ---- Started by watchdog ----\n");
	fs.closeSync(logFd);

	logFd = fs.openSync(LOG_FILE, "a");
	botProcess = spawn("node", [ENTRY], {
		cwd: ROOT,
		env: Object.assign({}, process.env, { WATCHDOG_PORT: String(WATCHDOG_PORT) }),
		stdio: ["ignore", logFd, logFd],
	});
	fs.closeSync(logFd);

	botStartedAt = new Date();
	fs.writeFileSync(PID_FILE, String(botProcess.pid));
	log("info", "Bot started (PID " + botProcess.pid + ")");

	botProcess.on("exit", function (code, signal) {
		var pid = botProcess ? botProcess.pid : "?";
		botProcess = null;
		botStartedAt = null;

		if (shuttingDown || manualStop) {
			manualStop = false;
			log("info", "Bot process " + pid + " exited (" + (shuttingDown ? "shutdown" : "manual stop") + ").");
			return;
		}

		log("warn", "Bot process " + pid + " exited with code=" + code + " signal=" + signal);
		crashCount++;
		var delay = Math.min(1000 * Math.pow(2, crashCount - 1), 30000);
		log("info", "Auto-restart in " + delay + "ms (crash #" + crashCount + ")");
		setTimeout(function () {
			if (!shuttingDown) startBot();
		}, delay);
	});

	setTimeout(function () {
		if (botProcess) crashCount = 0;
	}, 30000);
}

function stopBot() {
	if (!botProcess) {
		cleanupPidFile();
		return;
	}
	var pid = botProcess.pid;
	log("info", "Stopping bot (PID " + pid + ")...");
	botProcess.kill("SIGTERM");
	var waited = 0;
	var interval = setInterval(function () {
		waited++;
		if (waited >= 10) {
			clearInterval(interval);
			if (botProcess) {
				log("warn", "Force-killing bot (PID " + pid + ")");
				botProcess.kill("SIGKILL");
			}
			botProcess = null;
			botStartedAt = null;
			cleanupPidFile();
		} else if (!botProcess) {
			clearInterval(interval);
			cleanupPidFile();
		}
	}, 1000);
}

function cleanupPidFile() {
	try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch (_) {}
}

function isBotRunning() {
	return botProcess !== null && botProcess.exitCode === null;
}

// ── Deploy + restart ────────────────────────────────────────────────────
function deployAndRestart() {
	if (restartInProgress) {
		return { ok: false, error: "Restart already in progress" };
	}
	restartInProgress = true;
	log("info", "Deploy + restart started.");

	return new Promise(function (resolve) {
		log("info", "Running deploy...");
		try {
			execSync("npm run deploy", { cwd: ROOT, stdio: "pipe", timeout: 120000 });
			log("info", "Deploy completed.");
		} catch (err) {
			log("error", "Deploy failed: " + err.message);
			restartInProgress = false;
			resolve({ ok: false, error: "Deploy failed: " + err.message });
			return;
		}

		log("info", "Stopping old bot...");
		if (botProcess) {
			botProcess.removeAllListeners("exit");
			botProcess.kill("SIGTERM");
			var startedNew = false;
			function startOnce() { if (!startedNew) { startedNew = true; startNewBot(); } }
			var ft = setTimeout(function () {
				if (botProcess && botProcess.exitCode === null) {
					try { botProcess.kill("SIGKILL"); } catch (_) {}
					botProcess = null; botStartedAt = null;
				}
				startOnce();
			}, 8000);
			(function poll() {
				if (botProcess && botProcess.exitCode !== null) {
					clearTimeout(ft); botProcess = null; botStartedAt = null; startOnce();
				} else if (botProcess) { setTimeout(poll, 200); } else { startOnce(); }
			})();
		} else { startNewBot(); }

		function startNewBot() {
			log("info", "Starting new bot instance...");
			var np;
			try {
				var lf = fs.openSync(LOG_FILE, "a");
				fs.appendFileSync(lf, "\n[" + new Date().toISOString() + "] ---- Restarted by watchdog ----\n");
				np = spawn("node", [ENTRY], {
					cwd: ROOT,
					env: Object.assign({}, process.env, { WATCHDOG_PORT: String(WATCHDOG_PORT) }),
					stdio: ["ignore", lf, lf],
				});
				fs.closeSync(lf);
			} catch (err) {
				restartInProgress = false;
				resolve({ ok: false, error: err.message });
				return;
			}
			np.on("exit", function (c, s) {
				if (botProcess && botProcess.pid === np.pid) { botProcess = null; botStartedAt = null; }
				if (shuttingDown) return;
				crashCount++;
				var d = Math.min(1000 * Math.pow(2, crashCount - 1), 30000);
				setTimeout(function () { if (!shuttingDown) startBot(); }, d);
			});
			var dl = Date.now() + 15000;
			(function poll() {
				if (np.exitCode !== null) { restartInProgress = false; resolve({ ok: false, error: "New bot crashed on startup" }); return; }
				if (Date.now() >= dl) {
					botProcess = np; botStartedAt = new Date(); crashCount = 0;
					fs.writeFileSync(PID_FILE, String(np.pid));
					restartInProgress = false;
					log("info", "Restart complete. Bot PID " + np.pid);
					resolve({ ok: true });
					return;
				}
				setTimeout(poll, 1000);
			})();
		}
	});
}

// ── HTTP Proxy to bot ───────────────────────────────────────────────────
function proxyToBot(req, res) {
	if (!isBotRunning()) {
		res.writeHead(502, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Bot is not running" }));
		return;
	}

	var options = {
		hostname: BOT_HOST,
		port: BOT_PORT,
		path: req.url,
		method: req.method,
		headers: Object.assign({}, req.headers),
		// Remove hop-by-hop headers that shouldn't be forwarded
	};

	delete options.headers["connection"];
	delete options.headers["upgrade"];

	var proxyReq = http.request(options, function (proxyRes) {
		// Forward status code and headers
		var headers = Object.assign({}, proxyRes.headers);
		res.writeHead(proxyRes.statusCode, headers);
		proxyRes.pipe(res);
	});

	proxyReq.on("error", function (err) {
		log("error", "Proxy error: " + err.message);
		if (!res.headersSent) {
			res.writeHead(502, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Bot unreachable: " + err.message }));
		}
	});

	req.pipe(proxyReq);
}

// ── WebSocket server (native — survives bot restarts) ─────────────────
function wsBroadcast(event) {
	var data = JSON.stringify(event);
	wsClients.forEach(function (socket) {
		if (socket.readyState !== socket.OPEN) return;
		var sessionData = socket.sessionData || {};
		var guildId = event.guildId;
		if (guildId) {
			var ownerIds = sessionData.ownerIds || [];
			var allowed = sessionData.adminGuildIds || [];
			if (
				!ownerIds.includes(sessionData.user?.id) &&
				!allowed.includes(guildId)
			) return;
		}
		socket.send(data);
	});
}

function setupWebSocket() {
	wss = new WebSocketServer({ server: server, path: "/ws" });
	wss.on("connection", function (socket, req) {
		// Parse session cookie
		var cookies = {};
		(req.headers.cookie || "").split(";").forEach(function (part) {
			var p = part.trim().split("=");
			var k = p.shift();
			if (k) cookies[k] = p.join("=");
		});
		var rawSid = cookies["adb.sid"];
		var sessionSecret = process.env.SESSION_SECRET;
		if (!rawSid || !sessionSecret) { socket.close(); return; }

		var unsigned = unsignCookie(rawSid, sessionSecret);
		if (!unsigned.valid) { socket.close(); return; }

		var store = MongoStore.create({
			mongoUrl: process.env.MONGODB_URI,
			collectionName: "adb_sessions",
		});
		store.get(unsigned.value, function (err, sessionData) {
			if (err || !sessionData || !sessionData.user) {
				store.close();
				socket.close();
				return;
			}
			socket.sessionData = sessionData;
			wsClients.add(socket);
			store.close();
			socket.on("close", function () { wsClients.delete(socket); });
		});
	});
	log("info", "WebSocket server ready on /ws");
}

// ── HTTP Server ─────────────────────────────────────────────────────────
var server = http.createServer(function (req, res) {
	var url = new URL(req.url, "http://localhost:" + WATCHDOG_PORT);
	var pathname = url.pathname;

	// ── Watchdog's own endpoints (always available, independent of bot) ──
	if (pathname === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
		return;
	}

	if (pathname === "/status") {
		var running = isBotRunning();
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({
			running: running,
			pid: running ? botProcess.pid : null,
			uptime: running && botStartedAt ? Math.floor((Date.now() - botStartedAt.getTime()) / 1000) : 0,
			crashes: crashCount,
			restartInProgress: restartInProgress,
			watchdogPort: WATCHDOG_PORT,
			botPort: BOT_PORT,
		}));
		return;
	}

	if (req.method === "POST" && pathname === "/start") {
		if (isBotRunning()) {
			res.writeHead(409, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Bot already running" }));
		} else {
			startBot();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, message: "Bot starting" }));
		}
		return;
	}

	if (req.method === "POST" && pathname === "/stop") {
		manualStop = true;
		stopBot();
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, message: "Bot stopping" }));
		return;
	}

	if (req.method === "POST" && pathname === "/restart") {
		// Respond immediately so the HTTP client doesn't time out.
		// The deploy+restart runs in the background; the dashboard is
		// notified via WebSocket when it completes.
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, message: "Restarting…" }));

		log("info", "Deploy + restart started (background).");
		wsBroadcast({ type: "bot-restart", status: "started" });

		deployAndRestart().then(function (r) {
			wsBroadcast({
				type: "bot-restart",
				status: r.ok ? "complete" : "failed",
				error: r.error,
			});
		});
		return;
	}

	// ── Bot push-broadcast endpoint ─────────────────────────────────────
	if (req.method === "POST" && pathname === "/api/ws-broadcast") {
		var body = "";
		req.on("data", function (chunk) { body += chunk; });
		req.on("end", function () {
			try {
				wsBroadcast(JSON.parse(body));
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
			} catch (e) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid JSON" }));
			}
		});
		return;
	}

	// ── Everything else → proxy to bot ──────────────────────────────────
	proxyToBot(req, res);
});

// ── Signal handling ─────────────────────────────────────────────────────
process.on("SIGINT", function () { shutdown("SIGINT"); });
process.on("SIGTERM", function () { shutdown("SIGTERM"); });

function shutdown(signal) {
	shuttingDown = true;
	log("info", "Received " + signal + ", shutting down watchdog...");
	if (botProcess) {
		stopBot();
		var deadline = Date.now() + 12000;
		var check = setInterval(function () {
			if (!botProcess || Date.now() > deadline) {
				clearInterval(check);
				cleanup();
			}
		}, 100);
	} else { cleanup(); }
	function cleanup() {
		try { fs.unlinkSync(WATCHDOG_PID_FILE); } catch (_) {}
		server.close(function () { process.exit(0); });
	}
}

// ── Startup ─────────────────────────────────────────────────────────────
server.on("listening", function () {
	fs.writeFileSync(WATCHDOG_PID_FILE, String(process.pid));
	log("info", "Watchdog listening on 0.0.0.0:" + WATCHDOG_PORT);
	log("info", "Proxying to bot at " + BOT_HOST + ":" + BOT_PORT);
	log("info", "PID file: " + PID_FILE);
	setupWebSocket();
	startBot();
});

// Listen on ALL interfaces so Cloudflare Tunnel can reach it
server.listen(WATCHDOG_PORT);
