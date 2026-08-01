/**
 * manifest-schema.js — Manifest v2 schema, validation, and v1 migration.
 *
 * Manifest v2 turns the isolation layer into a contract enforcement system:
 * the manifest is the single source of truth that drives process spawning,
 * permission flags, resource limits, and the install-time risk disclosure.
 * If a capability isn't declared here, the plugin can't do it.
 *
 * This module is additive over core/capabilities.js — the discord/storage/ai/
 * hooks permission *values* are still validated against CAPABILITY_SCHEMA. What
 * v2 adds on top:
 *   - process model + explicit resource limits (maxExecutionMs, memoryMb)
 *   - network.outbound as a host allowlist (not a boolean)
 *   - filesystem read/write path scoping
 *   - childProcess / nativeAddons escape hatches (route to heavy review)
 *   - declaredDependencies for manifest↔code cross-validation
 *
 * A v1 manifest (top-level `capabilities` block, no `manifestVersion`) is
 * migrated to a v2 shape by migrateV1() so existing plugins keep loading.
 */

const semver = require("semver");
const { CAPABILITY_SCHEMA } = require("./capabilities");

const MANIFEST_VERSION = 2;

const PROCESS_MODELS = ["pooled", "persistent", "oneshot"];

// Bounds for author-declared resource limits. Values outside these ranges are
// clamped-with-error at validation time rather than trusted blindly.
const LIMITS = {
	maxExecutionMs: { min: 100, max: 60000, default: 5000 },
	memoryMb: { min: 32, max: 512, default: 128 },
};

// Permission categories that map onto CAPABILITY_SCHEMA value lists.
const CAP_BACKED = ["discord", "storage", "ai", "hooks", "scheduler", "system", "web"];

// Allowed listen range for plugin-hosted web UIs. Avoids the bot's HTTP port
// (3000/3009) and the watchdog (3008). Watchdog only proxies ports in-range.
const WEBUI_PORT = { min: 3100, max: 4999 };

// Settings-schema field types the dashboard knows how to render.
const SETTINGS_FIELD_TYPES = ["string", "number", "boolean", "channel", "role", "select"];

// ── Defaults ────────────────────────────────────────────────────────────────

function defaultProcess() {
	return {
		model: "pooled",
		maxExecutionMs: LIMITS.maxExecutionMs.default,
		memoryMb: LIMITS.memoryMb.default,
		persistentReason: null,
	};
}

function defaultPermissions() {
	return {
		discord: [],
		storage: [],
		ai: [],
		hooks: [],
		scheduler: [],
		system: [],
		web: [],
		network: { outbound: [] },
		filesystem: { read: [], write: [] },
		childProcess: false,
		nativeAddons: false,
	};
}

// ── v1 → v2 migration ─────────────────────────────────────────────────────

/**
 * Migrate a v1 manifest (capabilities-only) into a normalized v2 manifest.
 * Additive and lossless for the fields v2 cares about — everything else on the
 * manifest object is preserved.
 *
 * @param {object} manifest - Raw v1 manifest (parsed plugin.json)
 * @returns {object} A v2-shaped manifest (new object; input is not mutated)
 */
function migrateV1(manifest = {}) {
	const caps = manifest.capabilities || {};
	const permissions = defaultPermissions();

	for (const cat of CAP_BACKED) {
		if (Array.isArray(caps[cat])) permissions[cat] = [...caps[cat]];
	}

	// v1 network was `["outbound-http"]` — a boolean-in-disguise with no host
	// granularity. We cannot invent hosts, so migrate to an empty allowlist and
	// surface it: the plugin must re-declare specific hosts to make net calls.
	// (An empty outbound list means "no outbound", enforced by the broker.)
	if (Array.isArray(caps.network) && caps.network.length) {
		permissions._legacyNetwork = [...caps.network];
	}

	return {
		...manifest,
		manifestVersion: MANIFEST_VERSION,
		process: defaultProcess(),
		permissions,
		declaredDependencies: Array.isArray(manifest.declaredDependencies)
			? manifest.declaredDependencies
			: [],
		engines: normalizeEngines(manifest.engines),
		settings: normalizeSettings(manifest.settings),
		webUi: normalizeWebUi(manifest.webUi),
		_migratedFromV1: true,
	};
}

// ── engines / settings / webUi normalization ────────────────────────────────

function normalizeEngines(engines) {
	if (!engines || typeof engines !== "object") return { core: null, plugins: {} };
	const plugins = {};
	if (engines.plugins && typeof engines.plugins === "object") {
		for (const [name, range] of Object.entries(engines.plugins)) {
			if (typeof range === "string") plugins[name] = range;
		}
	}
	return {
		core: typeof engines.core === "string" ? engines.core : null,
		plugins,
	};
}

function normalizeSettings(settings) {
	if (!settings || typeof settings !== "object") return { schema: [], commandPermissions: false };
	return {
		schema: Array.isArray(settings.schema) ? settings.schema : [],
		commandPermissions: settings.commandPermissions === true,
	};
}

function normalizeWebUi(webUi) {
	if (!webUi || typeof webUi !== "object") return null;
	return {
		port: webUi.port,
		label: typeof webUi.label === "string" ? webUi.label : null,
		icon: typeof webUi.icon === "string" ? webUi.icon : null,
		memberPages: normalizeMemberPages(webUi.memberPages),
	};
}

// Member-facing pages a plugin exposes in the member portal (/me). Each entry
// is a self-service page a guild member can open for their OWN data — distinct
// from the admin dashboard settings page.
//
// Two flavors:
//   - Rendered (source + view, no plugin web server): the platform reads the
//     declared plugin-scoped model — force-scoped to {guildId, userId} — and
//     renders it with the built-in member-view library. `rendered: true`.
//     This is the default path for base plugins; no `webUi.port` required.
//   - Custom (no source/view): `path` is resolved against the plugin's own
//     webUi server (iframe-proxied at /plugin-ui/<name><path>). `rendered:
//     false`. For plugins that need arbitrary UI.
function normalizeMemberPages(memberPages) {
	if (!Array.isArray(memberPages)) return [];
	const out = [];
	const seen = new Set();
	for (const entry of memberPages) {
		if (!entry || typeof entry !== "object") continue;
		const path = typeof entry.path === "string" ? entry.path.trim() : "";
		const label = typeof entry.label === "string" ? entry.label.trim() : "";
		if (!path || !label) continue;
		if (seen.has(path)) continue;
		seen.add(path);
		const source = normalizeMemberSource(entry.source);
		const view = normalizeMemberView(entry.view);
		out.push({
			path,
			label,
			icon: typeof entry.icon === "string" ? entry.icon : null,
			// A page is platform-rendered iff it declares both a data source and
			// a view. Otherwise it falls back to the plugin-hosted iframe path.
			rendered: !!(source && view),
			source,
			view,
		});
	}
	return out;
}

// A rendered page's data source: which plugin-scoped model to read and how.
// `scope: "member"` is the only value the platform will honor for /me — it
// force-scopes every query and action to {guildId, userId} of the caller so a
// member can never read or mutate another member's rows.
function normalizeMemberSource(source) {
	if (!source || typeof source !== "object") return null;
	if (typeof source.model !== "string" || !source.model.trim()) return null;
	const out = {
		model: source.model.trim(),
		scope: source.scope === "member" ? "member" : "member", // only member is allowed
	};
	if (source.sort && typeof source.sort === "object") out.sort = source.sort;
	if (Number.isInteger(source.limit) && source.limit > 0) {
		out.limit = Math.min(source.limit, 500);
	}
	return out;
}

const MEMBER_VIEW_TYPES = ["list", "table", "stat"];
const MEMBER_ACTION_OPS = ["set", "delete"];

// A rendered page's view spec, consumed by the SPA member-view library. Only
// declarative field references + a whitelist of own-row actions — no code.
function normalizeMemberView(view) {
	if (!view || typeof view !== "object") return null;
	if (!MEMBER_VIEW_TYPES.includes(view.type)) return null;
	const out = { type: view.type };
	if (typeof view.title === "string") out.title = view.title;
	if (typeof view.subtitle === "string") out.subtitle = view.subtitle;
	if (typeof view.badge === "string") out.badge = view.badge;
	if (typeof view.empty === "string") out.empty = view.empty;
	if (Array.isArray(view.columns)) {
		out.columns = view.columns
			.filter((c) => c && typeof c.field === "string")
			.map((c) => ({ field: c.field, label: typeof c.label === "string" ? c.label : c.field }));
	}
	if (Array.isArray(view.stats)) {
		out.stats = view.stats
			.filter((st) => st && typeof st.field === "string")
			.map((st) => ({ field: st.field, label: typeof st.label === "string" ? st.label : st.field }));
	}
	if (Array.isArray(view.actions)) {
		out.actions = [];
		for (const a of view.actions) {
			if (!a || typeof a !== "object") continue;
			if (typeof a.id !== "string" || !a.id.trim()) continue;
			if (!MEMBER_ACTION_OPS.includes(a.op)) continue;
			const action = { id: a.id.trim(), label: typeof a.label === "string" ? a.label : a.id, op: a.op };
			if (a.op === "set") {
				if (typeof a.field !== "string" || !a.field.trim()) continue;
				action.field = a.field.trim();
				action.value = a.value; // literal; applied verbatim to the member's own row
			}
			out.actions.push(action);
		}
	}
	return out;
}

/**
 * Normalize any manifest to v2 shape. v1 manifests (no manifestVersion, or
 * manifestVersion < 2) are migrated; v2 manifests are filled with defaults for
 * any omitted optional fields.
 *
 * @param {object} manifest
 * @returns {object} v2-shaped manifest
 */
function normalize(manifest = {}) {
	if (!manifest.manifestVersion || manifest.manifestVersion < 2) {
		return migrateV1(manifest);
	}

	const proc = { ...defaultProcess(), ...(manifest.process || {}) };
	const permIn = manifest.permissions || {};
	const permissions = defaultPermissions();
	for (const cat of CAP_BACKED) {
		if (Array.isArray(permIn[cat])) permissions[cat] = [...permIn[cat]];
	}
	if (permIn.network && Array.isArray(permIn.network.outbound)) {
		permissions.network.outbound = [...permIn.network.outbound];
	}
	if (permIn.filesystem) {
		if (Array.isArray(permIn.filesystem.read)) permissions.filesystem.read = [...permIn.filesystem.read];
		if (Array.isArray(permIn.filesystem.write)) permissions.filesystem.write = [...permIn.filesystem.write];
	}
	permissions.childProcess = permIn.childProcess === true;
	permissions.nativeAddons = permIn.nativeAddons === true;

	return {
		...manifest,
		manifestVersion: MANIFEST_VERSION,
		process: proc,
		permissions,
		declaredDependencies: Array.isArray(manifest.declaredDependencies)
			? manifest.declaredDependencies
			: [],
		engines: normalizeEngines(manifest.engines),
		settings: normalizeSettings(manifest.settings),
		webUi: normalizeWebUi(manifest.webUi),
	};
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a v2 manifest. Operates on the raw manifest (does NOT normalize
 * first) so that missing required fields are reported rather than defaulted.
 *
 * @param {object} manifest - Raw v2 manifest
 * @returns {string[]} Array of error messages. Empty if valid.
 */
function validateManifestV2(manifest = {}) {
	const errors = [];

	if (manifest.manifestVersion !== MANIFEST_VERSION) {
		errors.push(`manifestVersion must be ${MANIFEST_VERSION}, got ${JSON.stringify(manifest.manifestVersion)}`);
	}

	// ── process ──
	const proc = manifest.process;
	if (!proc || typeof proc !== "object") {
		errors.push(`"process" block is required`);
	} else {
		if (!PROCESS_MODELS.includes(proc.model)) {
			errors.push(`process.model must be one of ${PROCESS_MODELS.join(", ")}, got ${JSON.stringify(proc.model)}`);
		}
		errors.push(...validateLimit("process.maxExecutionMs", proc.maxExecutionMs, LIMITS.maxExecutionMs));
		errors.push(...validateLimit("process.memoryMb", proc.memoryMb, LIMITS.memoryMb));
		if (proc.model === "persistent") {
			if (typeof proc.persistentReason !== "string" || !proc.persistentReason.trim()) {
				errors.push(`process.persistentReason is required (non-empty string) when process.model is "persistent"`);
			}
		}
	}

	// ── permissions ──
	const perm = manifest.permissions;
	if (!perm || typeof perm !== "object") {
		errors.push(`"permissions" block is required`);
		return errors;
	}

	// Capability-backed categories reuse CAPABILITY_SCHEMA value validation.
	for (const cat of CAP_BACKED) {
		if (perm[cat] === undefined) continue;
		if (!Array.isArray(perm[cat])) {
			errors.push(`permissions.${cat} must be an array`);
			continue;
		}
		const schema = CAPABILITY_SCHEMA[cat];
		for (const value of perm[cat]) {
			if (typeof value !== "string") {
				errors.push(`permissions.${cat} values must be strings`);
				continue;
			}
			if (schema && !schema.valid.includes(value)) {
				errors.push(`Unknown permission "${cat}:${value}". Valid: ${schema.valid.join(", ")}`);
			}
		}
	}

	// network.outbound: host allowlist
	if (perm.network !== undefined) {
		if (typeof perm.network !== "object" || perm.network === null || Array.isArray(perm.network)) {
			errors.push(`permissions.network must be an object with an "outbound" array`);
		} else if (perm.network.outbound !== undefined) {
			if (!Array.isArray(perm.network.outbound)) {
				errors.push(`permissions.network.outbound must be an array of hostnames`);
			} else {
				for (const host of perm.network.outbound) {
					if (!isValidHost(host)) errors.push(`permissions.network.outbound has invalid host: ${JSON.stringify(host)}`);
				}
			}
		}
	}

	// filesystem
	if (perm.filesystem !== undefined) {
		if (typeof perm.filesystem !== "object" || perm.filesystem === null || Array.isArray(perm.filesystem)) {
			errors.push(`permissions.filesystem must be an object with "read"/"write" arrays`);
		} else {
			for (const mode of ["read", "write"]) {
				if (perm.filesystem[mode] === undefined) continue;
				if (!Array.isArray(perm.filesystem[mode])) {
					errors.push(`permissions.filesystem.${mode} must be an array of paths`);
					continue;
				}
				for (const p of perm.filesystem[mode]) {
					if (typeof p !== "string" || !p) errors.push(`permissions.filesystem.${mode} has invalid path: ${JSON.stringify(p)}`);
				}
			}
		}
	}

	if (perm.childProcess !== undefined && typeof perm.childProcess !== "boolean") {
		errors.push(`permissions.childProcess must be a boolean`);
	}
	if (perm.nativeAddons !== undefined && typeof perm.nativeAddons !== "boolean") {
		errors.push(`permissions.nativeAddons must be a boolean`);
	}

	// ── declaredDependencies ──
	if (manifest.declaredDependencies !== undefined) {
		if (!Array.isArray(manifest.declaredDependencies)) {
			errors.push(`declaredDependencies must be an array`);
		} else {
			for (const dep of manifest.declaredDependencies) {
				if (!dep || typeof dep !== "object" || typeof dep.package !== "string" || !dep.package) {
					errors.push(`declaredDependencies entries must be { package, version } objects`);
				}
			}
		}
	}

	// ── engines (core + plugin version constraints) ──
	if (manifest.engines !== undefined) {
		const eng = manifest.engines;
		if (typeof eng !== "object" || eng === null || Array.isArray(eng)) {
			errors.push(`engines must be an object`);
		} else {
			if (eng.core !== undefined) {
				if (typeof eng.core !== "string" || semver.validRange(eng.core) === null) {
					errors.push(`engines.core must be a valid semver range, got ${JSON.stringify(eng.core)}`);
				}
			}
			if (eng.plugins !== undefined) {
				if (typeof eng.plugins !== "object" || eng.plugins === null || Array.isArray(eng.plugins)) {
					errors.push(`engines.plugins must be an object of { pluginName: semverRange }`);
				} else {
					for (const [name, range] of Object.entries(eng.plugins)) {
						if (typeof range !== "string" || semver.validRange(range) === null) {
							errors.push(`engines.plugins.${name} must be a valid semver range, got ${JSON.stringify(range)}`);
						}
					}
				}
			}
		}
	}

	// ── settings (dashboard-exposed config schema) ──
	if (manifest.settings !== undefined) {
		const st = manifest.settings;
		if (typeof st !== "object" || st === null || Array.isArray(st)) {
			errors.push(`settings must be an object`);
		} else {
			if (st.commandPermissions !== undefined && typeof st.commandPermissions !== "boolean") {
				errors.push(`settings.commandPermissions must be a boolean`);
			}
			if (st.schema !== undefined) {
				if (!Array.isArray(st.schema)) {
					errors.push(`settings.schema must be an array of field objects`);
				} else {
					for (const f of st.schema) {
						if (!f || typeof f !== "object" || typeof f.key !== "string" || !f.key) {
							errors.push(`settings.schema entries need a non-empty string "key"`);
							continue;
						}
						if (!SETTINGS_FIELD_TYPES.includes(f.type)) {
							errors.push(`settings.schema field "${f.key}" has invalid type ${JSON.stringify(f.type)}. Valid: ${SETTINGS_FIELD_TYPES.join(", ")}`);
						}
						if (f.type === "select" && !Array.isArray(f.options)) {
							errors.push(`settings.schema field "${f.key}" is type "select" but has no options array`);
						}
					}
				}
			}
		}
	}

	// ── webUi (plugin-hosted frontend and/or platform-rendered member pages) ──
	if (manifest.webUi !== undefined && manifest.webUi !== null) {
		const w = manifest.webUi;
		if (typeof w !== "object" || Array.isArray(w)) {
			errors.push(`webUi must be an object`);
		} else {
			const pages = Array.isArray(w.memberPages) ? w.memberPages : [];
			// A page is platform-rendered when it declares both source.model and
			// a view.type — the platform reads the model and renders it, so the
			// plugin hosts no server. Any other page is iframe-proxied and needs
			// a real hosted port.
			const isRendered = (p) =>
				p && typeof p === "object" &&
				p.source && typeof p.source === "object" && typeof p.source.model === "string" &&
				p.view && typeof p.view === "object" && MEMBER_VIEW_TYPES.includes(p.view.type);
			const hasIframePage = pages.some((p) => !isRendered(p));
			// A port is only meaningful (and only required) when the plugin
			// actually hosts a server: it declared a port, or has iframe pages.
			const needsServer = w.port !== undefined || hasIframePage;

			if (needsServer) {
				if (!Number.isInteger(w.port) || w.port < WEBUI_PORT.min || w.port > WEBUI_PORT.max) {
					errors.push(`webUi.port must be an integer in ${WEBUI_PORT.min}–${WEBUI_PORT.max}, got ${JSON.stringify(w.port)}`);
				}
				// Hosting a server requires the web:host-ui capability so the owner
				// approves it. Purely platform-rendered pages need no such approval.
				const webCaps = (manifest.permissions && manifest.permissions.web) || [];
				if (!Array.isArray(webCaps) || !webCaps.includes("host-ui")) {
					errors.push(`webUi requires permissions.web to include "host-ui"`);
				}
			}
			if (w.memberPages !== undefined) {
				if (!Array.isArray(w.memberPages)) {
					errors.push(`webUi.memberPages must be an array`);
				} else {
					w.memberPages.forEach((page, i) => {
						if (!page || typeof page !== "object" || Array.isArray(page)) {
							errors.push(`webUi.memberPages[${i}] must be an object`);
							return;
						}
						if (typeof page.path !== "string" || !page.path.trim()) {
							errors.push(`webUi.memberPages[${i}].path is required`);
						} else if (!page.path.startsWith("/")) {
							errors.push(`webUi.memberPages[${i}].path must start with "/"`);
						}
						if (typeof page.label !== "string" || !page.label.trim()) {
							errors.push(`webUi.memberPages[${i}].label is required`);
						}
						// Rendered pages: validate the view type and action ops so
						// authors get a clear error instead of a silently-dropped view.
						if (page.view !== undefined && page.view !== null) {
							if (typeof page.view !== "object" || !MEMBER_VIEW_TYPES.includes(page.view.type)) {
								errors.push(`webUi.memberPages[${i}].view.type must be one of ${MEMBER_VIEW_TYPES.join(", ")}`);
							} else if (Array.isArray(page.view.actions)) {
								page.view.actions.forEach((a, j) => {
									if (a && typeof a === "object" && !MEMBER_ACTION_OPS.includes(a.op)) {
										errors.push(`webUi.memberPages[${i}].view.actions[${j}].op must be one of ${MEMBER_ACTION_OPS.join(", ")}`);
									}
								});
							}
						}
						if (page.source !== undefined && page.source !== null) {
							if (typeof page.source !== "object" || typeof page.source.model !== "string" || !page.source.model.trim()) {
								errors.push(`webUi.memberPages[${i}].source.model is required for a rendered page`);
							}
						}
					});
				}
			}
		}
	}

	return errors;
}

function validateLimit(field, value, bounds) {
	if (value === undefined) return []; // defaulted at normalize time
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return [`${field} must be a number`];
	}
	if (value < bounds.min || value > bounds.max) {
		return [`${field} must be between ${bounds.min} and ${bounds.max}, got ${value}`];
	}
	return [];
}

// Hostnames only — no scheme, no path, no port, no wildcards. The broker
// matches request URL hosts exactly against this list.
function isValidHost(host) {
	if (typeof host !== "string" || !host) return false;
	// Reject anything that looks like a URL or contains a path/port/wildcard.
	if (/[/:*\s]/.test(host)) return false;
	return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(host);
}

module.exports = {
	MANIFEST_VERSION,
	PROCESS_MODELS,
	LIMITS,
	CAP_BACKED,
	WEBUI_PORT,
	SETTINGS_FIELD_TYPES,
	defaultProcess,
	defaultPermissions,
	migrateV1,
	normalize,
	validateManifestV2,
	isValidHost,
};
