const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { isMainThread, workerData } = require("node:worker_threads");
const mongoose = require("mongoose");
const { PluginManager } = require("../core/PluginManager");
const { serializeValue, serializeSchema, rehydrateSchema } = require("../core/rpc/schema-serialize");

module.exports.load = (ctx) => {
	if (workerData.pluginId.startsWith("reject-")) {
		ctx.registerCommand({ data: { name: "partial", description: "Must be cleaned up" }, execute() {} });
		ctx.registerEvent("threadUpdate", () => {});
		ctx.defineModel("rejected", new mongoose.Schema({ content: String }));
		return;
	}
	const Model = ctx.defineModel("entry", new mongoose.Schema({
		content: { type: String, required: true, maxlength: 30 },
		done: { type: Boolean, default: false },
		createdAt: { type: Date, default: Date.now },
		other: mongoose.Schema.Types.ObjectId,
		mixed: mongoose.Schema.Types.Mixed,
		bytes: Buffer,
	}));
	ctx.registerCommand({
		data: { name: "model-roundtrip", description: "Mongoose IPC regression" },
		async execute(interaction) {
			const other = new mongoose.Types.ObjectId("012345678901234567890123");
			const doc = await Model.create({ content: "first", other, mixed: { nested: [other] }, bytes: Buffer.from("bytes") });
			assert.match(doc._id, /^[0-9a-f]{24}$/);
			assert.equal(doc.other, other.toHexString());
			assert.equal(doc.mixed.nested[0], other.toHexString());
			assert.ok(doc.createdAt instanceof Date);
			assert.equal(doc.done, false);
			assert.equal(Buffer.from(doc.bytes).toString(), "bytes");
			doc.content = "saved";
			doc.mixed.counter = 1;
			doc.markModified("mixed");
			assert.equal(await doc.save(), doc);
			const found = await Model.findById(new mongoose.Types.ObjectId(doc._id)).exec();
			assert.equal(found.content, "saved");
			assert.equal(found.mixed.counter, 1);
			await Model.save(found, { done: true });
			const lean = await Model.find({ _id: doc._id }).sort({ createdAt: -1 }).limit(2).skip(0).select("content done").lean().exec();
			assert.equal(lean[0].done, true);
			assert.equal(typeof lean[0].save, "undefined");
			const updated = await Model.findOneAndUpdate({ _id: doc._id }, { $set: { content: "updated" } }, { new: true }).lean();
			assert.equal(updated.content, "updated");
			assert.equal(typeof updated.save, "undefined");
			assert.equal((await Model.deleteOne({ _id: doc._id })).deletedCount, 1);
			await assert.rejects(Model.create({ content: "x".repeat(31) }), /longer than the maximum/);
			await interaction.reply({ content: doc._id, flags: 64 });
		},
	});
	ctx.scheduler.schedule("0 0 1 1 *", () => ctx.discord.sendDM("observer", { content: "tick" }), "model-test-tick");
};

// Replace only Mongo's collection I/O. Mongoose schemas, casting, query chains,
// hydration, defaults, validation and document.save() all execute for real.
function fakeCollection(Model) {
	const documents = new Map();
	const queries = [];
	const raw = (doc) => new Model(serializeValue(doc)).toObject();
	const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
		if (key === "$or") return value.some((alternative) => matches(doc, alternative));
		if (value === null) return doc[key] == null;
		if (value && Object.hasOwn(value, "$lte")) return doc[key] <= value.$lte;
		return String(doc[key]) === String(value);
	});
	const matching = (filter) => [...documents.values()].filter((doc) => matches(doc, filter));
	const collection = Model.collection;
	collection.buffer = false;
	collection.insertOne = async (doc) => {
		documents.set(String(doc._id), raw(doc));
		return { acknowledged: true, insertedId: doc._id };
	};
	collection.findOne = async (filter, options) => {
		queries.push({ operation: "findOne", filter, options });
		const doc = matching(filter)[0];
		return doc ? raw(doc) : null;
	};
	collection.find = (filter, options) => {
		queries.push({ operation: "find", filter, options });
		return { toArray: async () => matching(filter).map(raw) };
	};
	collection.updateOne = async (filter, update) => {
		queries.push({ operation: "updateOne", filter, update });
		const doc = matching(filter)[0];
		if (doc) {
			Object.assign(doc, update.$set || {});
			for (const [key, amount] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + amount;
			for (const key of Object.keys(update.$unset || {})) delete doc[key];
		}
		return { acknowledged: true, matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
	};
	collection.findOneAndUpdate = async (filter, update) => {
		await collection.updateOne(filter, update);
		return collection.findOne(filter, {});
	};
	collection.deleteOne = async (filter) => {
		const doc = matching(filter)[0];
		if (doc) documents.delete(String(doc._id));
		return { acknowledged: true, deletedCount: doc ? 1 : 0 };
	};
	collection.deleteMany = async (filter) => {
		const found = matching(filter);
		for (const doc of found) documents.delete(String(doc._id));
		return { acknowledged: true, deletedCount: found.length };
	};
	collection.countDocuments = async (filter) => matching(filter).length;
	return { documents, queries, Model };
}

function setup(t) {
	const client = new EventEmitter();
	client.commands = new Map();
	client.users = { fetch: async () => ({ send: async (payload) => { client.emit("test:dm", payload); return { id: "dm" }; } }) };
	const hooks = { onAny: () => () => {}, emitHook: async () => {} };
	const manager = new PluginManager({ client, db: {}, scheduler: {}, hooks });
	manager.enableIsolation();
	const collections = new Map();
	const originalRegister = manager.broker.registerModel.bind(manager.broker);
	manager.broker.registerModel = (pluginId, name, schema) => {
		if (name === "rejected") throw new Error("injected model registration failure");
		originalRegister(pluginId, name, schema);
		collections.set(`${pluginId}:${name}`, fakeCollection(manager.broker._getModel(pluginId, name)));
	};
	t.after(async () => {
		await manager.workerManager.shutdown();
		for (const { Model } of collections.values()) mongoose.deleteModel(Model.modelName);
	});
	return { manager, client, collections };
}

async function loadFixture(f, name, capabilities = { storage: ["own-collection"], discord: ["SendMessages"], scheduler: ["cron"] }) {
	await f.manager.loadPlugin({ name, source: "package", entryPath: __filename, manifest: { capabilities } });
	return f.manager.plugins.get(name);
}

module.exports.fakeCollection = fakeCollection;

if (isMainThread && require.main === module) {
	test("real worker preserves BSON IDs, defaults, validation, query chaining and document/model saves", { timeout: 15000 }, async (t) => {
		const f = setup(t);
		const state = await loadFixture(f, "model-worker");
		assert.equal(state.enabled, true, state.lastError);
		let reply;
		await f.client.commands.get("model-roundtrip").execute({
			id: "model-interaction", type: 2, options: { data: [] }, user: { id: "user" },
			async reply(payload) { reply = payload; this.replied = true; },
		});
		assert.match(reply.content, /^[0-9a-f]{24}$/);
		const { queries, documents } = f.collections.get("model-worker:entry");
		assert.equal(documents.size, 0);
		assert.ok(queries.find((q) => q.filter._id instanceof mongoose.Types.ObjectId));
		const find = queries.find((q) => q.operation === "find");
		assert.deepEqual(find.options.sort, { createdAt: -1 });
		assert.equal(find.options.limit, 2);
		assert.deepEqual(find.options.projection, { content: 1, done: 1 });
	});

	test("ignored model registration failures prevent ready and remove partial registrations", { timeout: 10000 }, async (t) => {
		const f = setup(t);
		const state = await loadFixture(f, "reject-worker");
		assert.equal(state.enabled, false);
		assert.match(state.lastError, /injected model registration failure/);
		assert.equal(f.client.commands.has("partial"), false);
		assert.equal(f.client.listenerCount("threadUpdate"), 0);
		assert.equal(f.manager.workerManager.hasWorker("reject-worker"), false);
	});

	test("model registration cannot bypass storage capabilities", { timeout: 10000 }, async (t) => {
		const f = setup(t);
		const state = await loadFixture(f, "reject-no-storage", { discord: ["SendMessages"] });
		assert.equal(state.enabled, false);
		assert.match(state.lastError, /Missing capability: storage:own-collection/);
		assert.equal(f.collections.size, 0);
	});

	test("scheduler forwards broker-issued task IDs and teardown stops owned tasks", { timeout: 10000 }, async (t) => {
		const f = setup(t);
		assert.equal((await loadFixture(f, "scheduled-worker")).enabled, true);
		const [taskId, entry] = [...f.manager.broker._scheduledTasks][0];
		const delivery = once(f.client, "test:dm");
		f.manager.broker.emit("cron:tick", { pluginId: "scheduled-worker", taskId, name: "model-test-tick" });
		assert.equal((await delivery)[0].content, "tick");
		let stopped = false;
		const stop = entry.task.stop.bind(entry.task);
		entry.task.stop = () => { stopped = true; stop(); };
		await f.manager.unloadPlugin("scheduled-worker");
		assert.equal(stopped, true);
		assert.equal(f.manager.broker._scheduledTasks.size, 0);
	});

	test("unsupported schema fields and defaults fail instead of silently changing models", () => {
		assert.throws(() => serializeSchema(new mongoose.Schema({ list: [String] })), /Unsupported isolated schema field/);
		assert.throws(() => serializeSchema(new mongoose.Schema({ date: { type: Date, default: () => new Date() } })), /Function defaults/);
		assert.throws(() => rehydrateSchema({ fields: { broken: { type: "NotAType" } } }), /Unsupported isolated schema field/);
	});
}
