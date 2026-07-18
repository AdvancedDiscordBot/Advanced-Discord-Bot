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
const CAP_BACKED = ["discord", "storage", "ai", "hooks", "scheduler"];

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
		_migratedFromV1: true,
	};
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
	defaultProcess,
	defaultPermissions,
	migrateV1,
	normalize,
	validateManifestV2,
	isValidHost,
};
