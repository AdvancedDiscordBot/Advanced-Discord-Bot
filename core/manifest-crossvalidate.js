/**
 * manifest-crossvalidate.js — Confirm the code doesn't do more than the manifest claims.
 *
 * The risk card is only trustworthy if the manifest is an accurate description of
 * the code. This module is the integrity guarantee the whole install-time trust
 * model rests on: it parses the plugin's source (AST via acorn, NOT regex) and
 * rejects any manifest that under-declares what the code actually reaches for.
 *
 * Two independent checks, both producing hard rejections:
 *   1. Sensitive node built-ins (fs, net, http, child_process, …) referenced in
 *      code but not backed by a corresponding manifest permission.
 *   2. Packages require()'d/import'd but absent from declaredDependencies.
 *
 * A lying manifest (declares nothing scary, code does something scary) fails here.
 */

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const { normalize } = require("./manifest-schema");

// Node core modules whose use must be backed by a manifest permission. Each maps
// to a predicate over the normalized permissions object: if the code imports the
// module and the predicate is false, that's a rejection.
const GATED_BUILTINS = {
	fs: (perm) => perm.filesystem.read.length > 0 || perm.filesystem.write.length > 0,
	"fs/promises": (perm) => perm.filesystem.read.length > 0 || perm.filesystem.write.length > 0,
	net: (perm) => perm.network.outbound.length > 0,
	dgram: (perm) => perm.network.outbound.length > 0,
	tls: (perm) => perm.network.outbound.length > 0,
	http: (perm) => perm.network.outbound.length > 0,
	https: (perm) => perm.network.outbound.length > 0,
	http2: (perm) => perm.network.outbound.length > 0,
	child_process: (perm) => perm.childProcess === true,
	cluster: (perm) => perm.childProcess === true,
	worker_threads: (perm) => perm.childProcess === true,
	vm: () => false, // never allowed from plugin code
	module: () => false,
	repl: () => false,
};

// Reason strings for each gated builtin, used in rejection messages.
const BUILTIN_REASON = {
	fs: 'uses "fs" but declares no filesystem.read/write paths',
	"fs/promises": 'uses "fs/promises" but declares no filesystem.read/write paths',
	net: 'uses "net" but declares no network.outbound hosts',
	dgram: 'uses "dgram" but declares no network.outbound hosts',
	tls: 'uses "tls" but declares no network.outbound hosts',
	http: 'uses "http" but declares no network.outbound hosts',
	https: 'uses "https" but declares no network.outbound hosts',
	http2: 'uses "http2" but declares no network.outbound hosts',
	child_process: 'uses "child_process" but permissions.childProcess is not true',
	cluster: 'uses "cluster" but permissions.childProcess is not true',
	worker_threads: 'uses "worker_threads" but permissions.childProcess is not true',
	vm: 'uses "vm" — not permitted from plugin code',
	module: 'uses "module" — not permitted from plugin code',
	repl: 'uses "repl" — not permitted from plugin code',
};

// Bare specifiers that are provided by the host and never need declaring.
// (These are injected via the capability broker / ctx, not require()'d for real.)
const HOST_PROVIDED = new Set(["discord.js", "mongoose"]);

const NODE_PREFIX = "node:";

/** Strip a subpath from a package specifier: "foo/bar" → "foo", "@a/b/c" → "@a/b". */
function packageRoot(spec) {
	if (spec.startsWith("@")) {
		const parts = spec.split("/");
		return parts.slice(0, 2).join("/");
	}
	return spec.split("/")[0];
}

/** Is this specifier a relative/absolute local path (not a module lookup)? */
function isLocalPath(spec) {
	return spec.startsWith(".") || spec.startsWith("/") || path.isAbsolute(spec);
}

/**
 * Extract every module specifier referenced by a source file via require(),
 * static import, dynamic import(), or export ... from. Uses acorn's AST so
 * string concatenation and comments can't hide or fake an import.
 *
 * @param {string} code
 * @param {string} [filename] - for error messages
 * @returns {{ specifiers: string[], parseError: string|null }}
 */
function extractSpecifiers(code, filename = "<plugin>") {
	let ast;
	try {
		ast = acorn.parse(code, {
			ecmaVersion: "latest",
			sourceType: "module", // superset — also parses CommonJS require() calls
			allowReturnOutsideFunction: true,
			allowAwaitOutsideFunction: true,
			allowHashBang: true,
		});
	} catch (err) {
		return { specifiers: [], parseError: `${filename}: ${err.message}` };
	}

	const found = new Set();

	const visit = (node) => {
		if (!node || typeof node !== "object") return;

		// require("x")
		if (node.type === "CallExpression") {
			const callee = node.callee;
			const isRequire = callee && callee.type === "Identifier" && callee.name === "require";
			if (isRequire) {
				const arg = node.arguments && node.arguments[0];
				if (arg && arg.type === "Literal" && typeof arg.value === "string") {
					found.add(arg.value);
				}
			}
		}

		// dynamic import("x") — acorn emits an ImportExpression node
		if (node.type === "ImportExpression" && node.source && node.source.type === "Literal" && typeof node.source.value === "string") {
			found.add(node.source.value);
		}

		// import ... from "x"  /  export ... from "x"  /  import "x"
		if (
			(node.type === "ImportDeclaration" ||
				node.type === "ExportNamedDeclaration" ||
				node.type === "ExportAllDeclaration") &&
			node.source &&
			typeof node.source.value === "string"
		) {
			found.add(node.source.value);
		}

		for (const key of Object.keys(node)) {
			const child = node[key];
			if (Array.isArray(child)) {
				for (const c of child) visit(c);
			} else if (child && typeof child === "object" && typeof child.type === "string") {
				visit(child);
			}
		}
	};

	visit(ast);
	return { specifiers: [...found], parseError: null };
}

/**
 * Recursively collect .js/.mjs/.cjs files under a plugin directory, skipping
 * node_modules, test folders, and dotfiles.
 */
function collectSourceFiles(dir, acc = []) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return acc;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.name === "node_modules" || entry.name === "test" || entry.name === "tests") continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectSourceFiles(full, acc);
		} else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
			acc.push(full);
		}
	}
	return acc;
}

/**
 * Cross-validate a manifest against a set of source strings.
 *
 * @param {object} manifest - Raw or normalized v2 manifest
 * @param {Array<{ filename: string, code: string }>} sources
 * @returns {{ ok: boolean, errors: string[], imports: { builtins: string[], packages: string[] } }}
 */
function crossValidateSources(manifest, sources) {
	const m = normalize(manifest);
	const perm = m.permissions;
	const errors = [];

	const declared = new Set(
		(m.declaredDependencies || []).map((d) => d.package).filter(Boolean),
	);

	const usedBuiltins = new Set();
	const usedPackages = new Set();

	for (const { filename, code } of sources) {
		const { specifiers, parseError } = extractSpecifiers(code, filename);
		if (parseError) {
			errors.push(`Parse error (rejected): ${parseError}`);
			continue;
		}
		for (const raw of specifiers) {
			if (isLocalPath(raw)) continue; // local file, not a module dependency
			const spec = raw.startsWith(NODE_PREFIX) ? raw.slice(NODE_PREFIX.length) : raw;

			if (Object.prototype.hasOwnProperty.call(GATED_BUILTINS, spec)) {
				usedBuiltins.add(spec);
			} else if (isBuiltin(spec)) {
				// non-gated builtin (path, url, crypto, util…) — allowed, not tracked
			} else {
				usedPackages.add(packageRoot(raw));
			}
		}
	}

	// Check 1: gated builtins must be backed by a permission.
	for (const b of usedBuiltins) {
		const allow = GATED_BUILTINS[b];
		if (!allow(perm)) {
			errors.push(`Manifest mismatch: code ${BUILTIN_REASON[b]}`);
		}
	}

	// Check 2: every external package used must be declared.
	for (const pkg of usedPackages) {
		if (HOST_PROVIDED.has(pkg)) continue;
		if (!declared.has(pkg)) {
			errors.push(`Undeclared dependency: code imports "${pkg}" but it is not in declaredDependencies`);
		}
	}

	return {
		ok: errors.length === 0,
		errors,
		imports: { builtins: [...usedBuiltins], packages: [...usedPackages] },
	};
}

/**
 * Cross-validate a manifest against a plugin directory on disk.
 *
 * @param {object} manifest
 * @param {string} pluginDir - absolute path to the plugin's source directory
 * @returns {{ ok: boolean, errors: string[], imports: object }}
 */
function crossValidatePlugin(manifest, pluginDir) {
	const files = collectSourceFiles(pluginDir);
	const sources = [];
	for (const f of files) {
		try {
			sources.push({ filename: path.relative(pluginDir, f), code: fs.readFileSync(f, "utf8") });
		} catch (err) {
			return { ok: false, errors: [`Unable to read ${f}: ${err.message}`], imports: { builtins: [], packages: [] } };
		}
	}
	return crossValidateSources(manifest, sources);
}

// Node builtin detection — module.isBuiltin is available on Node 18+.
function isBuiltin(spec) {
	if (typeof require("module").isBuiltin === "function") {
		return require("module").isBuiltin(spec);
	}
	return require("module").builtinModules.includes(spec);
}

module.exports = {
	GATED_BUILTINS,
	HOST_PROVIDED,
	extractSpecifiers,
	collectSourceFiles,
	crossValidateSources,
	crossValidatePlugin,
};
