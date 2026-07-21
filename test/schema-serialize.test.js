/**
 * test/schema-serialize.test.js — Verifies mongoose Schema round-trips
 * across the worker→core IPC boundary as a structured-clone-safe descriptor.
 *
 * Regression: isolated plugins call ctx.defineModel(name, schema) where
 * `schema` is a compiled mongoose.Schema whose field types are the String /
 * Number / Date constructors. Those functions cannot be structured-cloned
 * over worker_threads IPC, so defineModel failed for every isolated plugin.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { Schema } = require("mongoose");
const { serializeSchema, rehydrateSchema } = require("../core/rpc/schema-serialize");

describe("schema-serialize", () => {
	it("produces a structured-clone-safe descriptor (no functions)", () => {
		const schema = new Schema({
			guildId: { type: String, required: true, index: true },
			xp: { type: Number, default: 0 },
			lastMessageAt: { type: Date, default: Date.now },
		});

		const descriptor = serializeSchema(schema);

		// structuredClone throws (DataCloneError) if any function survives.
		assert.doesNotThrow(() => structuredClone(descriptor));
	});

	it("maps constructor field types to string tokens", () => {
		const schema = new Schema({
			name: { type: String },
			count: { type: Number },
			when: { type: Date },
			ok: { type: Boolean },
		});

		const d = serializeSchema(schema);
		assert.equal(d.fields.name.type, "String");
		assert.equal(d.fields.count.type, "Number");
		assert.equal(d.fields.when.type, "Date");
		assert.equal(d.fields.ok.type, "Boolean");
	});

	it("preserves validators, defaults, enum and Date.now sentinel", () => {
		const schema = new Schema({
			guildId: { type: String, required: true, unique: true },
			status: { type: String, enum: ["open", "closed"], default: "open" },
			createdAt: { type: Date, default: Date.now },
		});

		const d = serializeSchema(schema);
		assert.equal(d.fields.guildId.required, true);
		assert.deepEqual(d.fields.status.enum, ["open", "closed"]);
		// Scalar defaults are wrapped in a clone-safe { __val } envelope.
		assert.deepEqual(d.fields.status.default, { __val: "open" });
		// Date.now is serialized as a sentinel, not a raw (unclonable) function.
		assert.deepEqual(d.fields.createdAt.default, { __fn: "Date.now" });
		// unique is carried as an index, not a field flag.
		const uniqueIdx = d.indexes.find(([keys]) => keys.guildId);
		assert.ok(uniqueIdx && uniqueIdx[1].unique, "guildId unique index preserved");
	});

	it("rehydrates into a working Schema with correct paths and defaults", () => {
		const original = new Schema({
			guildId: { type: String, required: true },
			xp: { type: Number, default: 0 },
			createdAt: { type: Date, default: Date.now },
		});

		const rebuilt = rehydrateSchema(serializeSchema(original));
		assert.ok(rebuilt instanceof Schema);
		assert.equal(rebuilt.path("guildId").instance, "String");
		assert.equal(rebuilt.path("xp").instance, "Number");
		assert.equal(rebuilt.path("xp").defaultValue, 0);
		// Date.now sentinel rehydrates back to the actual function.
		assert.equal(typeof rebuilt.path("createdAt").defaultValue, "function");
	});

	it("round-trips through JSON (the real IPC transport) losslessly", () => {
		const schema = new Schema({
			guildId: { type: String, required: true, index: true },
			level: { type: Number, default: 0 },
		});

		const overWire = JSON.parse(JSON.stringify(serializeSchema(schema)));
		const rebuilt = rehydrateSchema(overWire);
		assert.equal(rebuilt.path("guildId").instance, "String");
		assert.equal(rebuilt.path("level").defaultValue, 0);
	});
});
