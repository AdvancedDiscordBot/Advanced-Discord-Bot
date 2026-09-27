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
 * ADB plugins use are supported. Unsupported definitions fail explicitly rather
 * than registering a model that silently drops fields or validation.
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
		if (def === Date.now) return { __fn: "Date.now" };
		throw new Error("Function defaults other than Date.now require direct mode");
	}
	return { __val: serializeValue(def) };
}

// Shared by both sides of IPC: BSON prototypes and document methods do not
// survive structured clone. IDs travel as strings that Mongoose can cast back.
function serializeValue(value, omitKeys = new Set(), seen = new WeakSet()) {
	if (typeof value === "function" || typeof value === "symbol") return undefined;
	if (value === null || typeof value !== "object") return value;
	if (value instanceof Date || value instanceof RegExp) return value;
	if (Buffer.isBuffer(value)) return Buffer.from(value);
	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (value._bsontype === "ObjectId") return value.toHexString();
	if (value._bsontype === "Decimal128") return value.toString();
	if (value._bsontype === "Binary") return Buffer.from(value.buffer);
	if (seen.has(value)) return undefined;
	seen.add(value);
	try {
		if (typeof value.toObject === "function") {
			const plain = value.toObject({ flattenMaps: true, transform: false, virtuals: false });
			if (plain !== value) return serializeValue(plain, omitKeys, seen);
		}
		if (typeof value.toJSON === "function") {
			const plain = value.toJSON();
			if (plain !== value) return serializeValue(plain, omitKeys, seen);
		}
		if (Array.isArray(value) || value instanceof Set) {
			return Array.from(value, (item) => serializeValue(item, omitKeys, seen));
		}
		const entries = value instanceof Map ? [...value] : Object.entries(value);
		return Object.fromEntries(entries
			.filter(([key, item]) => !omitKeys.has(String(key).toLowerCase()) && typeof item !== "function" && typeof item !== "symbol")
			.map(([key, item]) => [key, serializeValue(item, omitKeys, seen)]));
	} finally {
		seen.delete(value);
	}
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

	for (const [pathName, schemaType] of Object.entries(schema.paths)) {
		if (pathName === "_id" || pathName === "__v") continue;

		const instance = schemaType.instance;
		if (!Object.hasOwn(INSTANCE_TO_TYPE, instance)) {
			throw new Error(`Unsupported isolated schema field: ${pathName}:${instance}`);
		}

		const opts = schemaType.options || {};
		const field = { type: instance };

		if (typeof opts.required === "function" || opts.validate || opts.get || opts.set) {
			throw new Error(`Custom validation/accessors require direct mode: ${pathName}`);
		}
		if (opts.required) field.required = opts.required;
		if (Array.isArray(opts.enum)) field.enum = opts.enum;
		for (const key of ["min", "max", "minlength", "maxlength", "minLength", "maxLength", "match", "trim", "lowercase", "uppercase"]) {
			if (opts[key] !== undefined) field[key] = opts[key];
		}
		if (opts.default !== undefined) {
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

	// __adbSchema marks the payload as a serialized descriptor (not a raw
	// Schema) so the broker knows to rehydrate it before calling mongoose.model.
	const descriptor = { fields, indexes, options, __adbSchema: 1 };
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
		if (!field || !Object.hasOwn(INSTANCE_TO_TYPE, field.type)) {
			throw new Error(`Unsupported isolated schema field: ${pathName}:${field?.type}`);
		}
		const typeFactory = INSTANCE_TO_TYPE[field.type];

		const pathDef = { type: typeFactory() };
		if (field.required) pathDef.required = field.required;
		if (Array.isArray(field.enum)) pathDef.enum = field.enum;
		for (const key of ["min", "max", "minlength", "maxlength", "minLength", "maxLength", "match", "trim", "lowercase", "uppercase"]) {
			if (field[key] !== undefined) pathDef[key] = field[key];
		}
		if (field.default && typeof field.default === "object") {
			if ("__fn" in field.default && Object.hasOwn(FUNC_DEFAULTS, field.default.__fn)) {
				pathDef.default = FUNC_DEFAULTS[field.default.__fn]();
			} else if ("__val" in field.default) {
				pathDef.default = field.default.__val;
			} else {
				throw new Error(`Unsupported isolated schema default: ${pathName}`);
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

module.exports = { serializeSchema, rehydrateSchema, serializeValue };
