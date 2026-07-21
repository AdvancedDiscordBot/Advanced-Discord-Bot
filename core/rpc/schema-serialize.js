/**
 * schema-serialize.js — IPC-safe Mongoose schema transport.
 *
 * Plugins define models by passing a *compiled* `mongoose.Schema` to
 * `ctx.defineModel()`. Inside an isolated worker that schema cannot be sent to
 * the Core process directly: its field types are the `String`/`Number`/`Date`
 * constructors and its defaults may be functions (e.g. `Date.now`), none of
 * which survive the structured-clone algorithm used by `worker_threads` IPC.
 *
 * `serializeSchema()` (worker side) walks a compiled schema and emits a plain,
 * clone-safe descriptor. `rehydrateSchema()` (Core side) rebuilds an equivalent
 * `mongoose.Schema` from that descriptor. Only the flat scalar field shapes the
 * ADB plugins use are supported; anything unrecognized is skipped with a note
 * rather than throwing, so a partially-understood schema still yields a usable
 * model instead of a hard failure.
 */

// Mongoose SchemaType `.instance` name → the constructor used in a definition.
const INSTANCE_TO_TYPE = {
	String: () => String,
	Number: () => Number,
	Date: () => Date,
	Boolean: () => Boolean,
	Buffer: () => Buffer,
	ObjectID: () => require("mongoose").Schema.Types.ObjectId,
	ObjectId: () => require("mongoose").Schema.Types.ObjectId,
	Decimal128: () => require("mongoose").Schema.Types.Decimal128,
	Mixed: () => require("mongoose").Schema.Types.Mixed,
};

// Function defaults can't be cloned; map the ones plugins actually use to a
// sentinel string and restore them on the far side.
const FUNC_DEFAULTS = {
	"Date.now": () => Date.now,
};

function serializeDefault(def) {
	if (typeof def === "function") {
		if (def === Date.now || def.name === "now") return { __fn: "Date.now" };
		return undefined; // arbitrary functions are dropped (no safe transport)
	}
	// primitives, arrays and plain objects clone fine
	return { __val: def };
}

/**
 * Convert a compiled mongoose Schema into a plain, IPC-safe descriptor.
 * @param {import('mongoose').Schema} schema
 * @returns {{fields: object, indexes: Array, options: object}}
 */
function serializeSchema(schema) {
	if (!schema || !schema.paths) {
		throw new Error("serializeSchema expects a compiled mongoose Schema");
	}

	const fields = {};
	const skipped = [];

	for (const [pathName, schemaType] of Object.entries(schema.paths)) {
		if (pathName === "_id" || pathName === "__v") continue;

		const instance = schemaType.instance;
		if (!INSTANCE_TO_TYPE[instance]) {
			skipped.push(`${pathName}:${instance}`);
			continue;
		}

		const opts = schemaType.options || {};
		const field = { type: instance };

		if (opts.required) field.required = true;
		if (Array.isArray(opts.enum)) field.enum = opts.enum;
		if ("default" in opts) {
			const d = serializeDefault(opts.default);
			if (d !== undefined) field.default = d;
		}

		fields[pathName] = field;
	}

	// `schema.indexes()` returns every index — those declared via path options
	// (index/unique) AND via explicit `schema.index()` calls, including compound
	// ones — so index creation is driven entirely from here.
	const indexes = [];
	try {
		for (const [keys, indexOpts] of schema.indexes()) {
			const cleanOpts = {};
			if (indexOpts && indexOpts.unique) cleanOpts.unique = true;
			if (indexOpts && indexOpts.sparse) cleanOpts.sparse = true;
			indexes.push([keys, cleanOpts]);
		}
	} catch {
		/* no indexes */
	}

	const options = {};
	if (schema.options) {
		if (schema.options.collection) options.collection = schema.options.collection;
		if (schema.options.timestamps) options.timestamps = schema.options.timestamps;
	}

	const descriptor = { fields, indexes, options };
	if (skipped.length) descriptor.skipped = skipped;
	return descriptor;
}

/**
 * Rebuild a mongoose Schema from a descriptor produced by serializeSchema().
 * @param {{fields: object, indexes: Array, options: object}} descriptor
 * @returns {import('mongoose').Schema}
 */
function rehydrateSchema(descriptor) {
	const { Schema } = require("mongoose");
	if (!descriptor || !descriptor.fields) {
		throw new Error("rehydrateSchema expects a schema descriptor");
	}

	const def = {};
	for (const [pathName, field] of Object.entries(descriptor.fields)) {
		const typeFactory = INSTANCE_TO_TYPE[field.type];
		if (!typeFactory) continue;

		const pathDef = { type: typeFactory() };
		if (field.required) pathDef.required = true;
		if (Array.isArray(field.enum)) pathDef.enum = field.enum;
		if (field.default && typeof field.default === "object") {
			if ("__fn" in field.default && FUNC_DEFAULTS[field.default.__fn]) {
				pathDef.default = FUNC_DEFAULTS[field.default.__fn]();
			} else if ("__val" in field.default) {
				pathDef.default = field.default.__val;
			}
		}
		def[pathName] = pathDef;
	}

	const schema = new Schema(def, descriptor.options || {});

	for (const [keys, indexOpts] of descriptor.indexes || []) {
		try {
			schema.index(keys, indexOpts || {});
		} catch {
			/* ignore malformed index */
		}
	}

	return schema;
}

module.exports = { serializeSchema, rehydrateSchema };
