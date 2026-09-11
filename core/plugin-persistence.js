/**
 * plugin-persistence.js — keep dashboard-installed plugins across rebuilds.
 *
 * Dashboard installs run `npm install <pkg>` inside the running container.
 * Every `docker compose up -d --build` recreates the container from the image,
 * which only carries the packages pinned in package.json — in-container
 * installs vanish. The manifest (data/installed-plugins.json, on a mounted
 * volume) records the dashboard-managed desired state; on boot, reconcile()
 * re-installs anything the image doesn't provide (and re-removes anything the
 * admin uninstalled, including image-pinned packages).
 *
 * Manifest entry shapes:
 *   { package: "adb-plugin-todo", version: "1.3.0" } — ensure installed at version
 *   { package: "adb-plugin-x", removed: true }       — ensure NOT installed
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createLogger } = require("./logger");

const logger = createLogger("PluginPersistence");

const MANIFEST_PATH = path.join(process.cwd(), "data", "installed-plugins.json");

function readManifest() {
	try {
		const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
		return data && typeof data === "object" && Array.isArray(data.plugins)
			? data.plugins
			: [];
	} catch {
		return [];
	}
}

function writeManifest(plugins) {
	fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
	fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ plugins }, null, 2));
}

/** Version currently present in node_modules, or null. */
function installedVersion(packageName) {
	try {
		const pkg = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), "node_modules", packageName, "package.json"), "utf8"),
		);
		return pkg.version || null;
	} catch {
		return null;
	}
}

/**
 * Record a successful dashboard install. Called after npm install finishes,
 * so the version on disk is the truth.
 */
function recordInstall(packageName) {
	const version = installedVersion(packageName);
	const plugins = readManifest().filter((p) => p.package !== packageName);
	plugins.push({ package: packageName, version });
	writeManifest(plugins);
	logger.info(`Recorded install ${packageName}@${version || "?"}`);
}

/**
 * Record a dashboard uninstall as desired-absent (covers image-pinned
 * packages too — a rebuild would otherwise bring them back).
 */
function recordUninstall(packageName) {
	const plugins = readManifest().filter((p) => p.package !== packageName);
	plugins.push({ package: packageName, removed: true });
	writeManifest(plugins);
	logger.info(`Recorded uninstall ${packageName}`);
}

/**
 * Pure decision step — what npm actions does the manifest require, given a
 * version lookup? Exported for tests.
 *
 * @param {Array} entries - manifest entries
 * @param {Function} lookup - packageName → installed version or null
 * @returns {Array<{action: "install"|"uninstall", package: string, spec?: string}>}
 */
function planReconcile(entries, lookup) {
	const actions = [];
	for (const entry of entries) {
		const current = lookup(entry.package);
		if (entry.removed) {
			if (current) actions.push({ action: "uninstall", package: entry.package });
		} else if (!current || (entry.version && current !== entry.version)) {
			actions.push({
				action: "install",
				package: entry.package,
				spec: entry.version ? `${entry.package}@${entry.version}` : entry.package,
			});
		}
	}
	return actions;
}

function runNpm(args) {
	return new Promise((resolve) => {
		const child = spawn("npm", args, { cwd: process.cwd() });
		child.stdout.on("data", (d) => process.stdout.write(d));
		child.stderr.on("data", (d) => process.stderr.write(d));
		// ponytail: fixed 5-minute ceiling per package; raise if a plugin
		// legitimately needs a huge dependency tree to install.
		const timer = setTimeout(() => child.kill("SIGKILL"), 5 * 60 * 1000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(code === 0);
		});
	});
}

/**
 * Bring node_modules in line with the manifest. Called once at boot, before
 * plugins load. No-op when the manifest is empty or everything already matches.
 */
async function reconcileInstalledPlugins() {
	const entries = readManifest();
	if (!entries.length) return { changed: 0 };

	const actions = planReconcile(entries, installedVersion);
	if (!actions.length) return { changed: 0 };

	for (const action of actions) {
		logger.info(`Reconciling: npm ${action.action} ${action.spec || action.package}`);
		const ok = await runNpm([action.action, action.spec || action.package]);
		if (!ok) {
			logger.error(`npm ${action.action} ${action.spec || action.package} failed — plugin will be missing until reinstalled from the dashboard`);
		}
	}
	return { changed: actions.length };
}

module.exports = {
	readManifest,
	recordInstall,
	recordUninstall,
	planReconcile,
	reconcileInstalledPlugins,
};
