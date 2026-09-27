const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fastify = require("fastify");
const adminPlugin = require("../core/adminPlugin");

test("dashboard-runtime: SPA fallbacks are limited to dashboard and member page GETs", async (t) => {
	const tempRoot = path.join(os.tmpdir(), "opencode");
	fs.mkdirSync(tempRoot, { recursive: true });
	const webDir = fs.mkdtempSync(path.join(tempRoot, "dashboard-runtime-"));
	fs.mkdirSync(path.join(webDir, "static"));
	fs.writeFileSync(path.join(webDir, "index.html"), '<!doctype html><div id="root"></div>');
	fs.writeFileSync(path.join(webDir, "static", "runtime.js"), "window.dashboardLoaded = true;");
	t.after(() => fs.rmSync(webDir, { recursive: true, force: true }));
	const app = fastify();
	t.after(() => app.close());
	await adminPlugin.register(app, { client: {}, db: {}, permissions: {}, webDir });
	for (const url of ["/dashboard", "/dashboard/", "/dashboard/guild/123/plugins/x/settings", "/me", "/me/guild/123"]) {
		await t.test(`serves ${url}`, async () => {
			const response = await app.inject(url);
			assert.equal(response.statusCode, 200);
			assert.match(response.headers["content-type"], /text\/html/);
			assert.match(response.body, /id="root"/);
		});
	}
	await t.test("serves dashboard assets as JavaScript", async () => {
		const response = await app.inject("/dashboard/static/runtime.js");
		assert.equal(response.statusCode, 200);
		assert.match(response.headers["content-type"], /javascript/);
		assert.equal(response.body, "window.dashboardLoaded = true;");
	});
	for (const [method, url] of [["GET", "/dashboard/static/missing.js"], ["GET", "/unknown"], ["GET", "/membership"], ["GET", "/api/missing"], ["POST", "/dashboard/guild/123"]]) {
		await t.test(`${method} ${url} is not an HTML success`, async () => {
			assert.equal((await app.inject({ method, url })).statusCode, 404);
		});
	}
});
