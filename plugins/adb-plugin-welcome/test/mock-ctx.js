"use strict";

/**
 * mock-ctx.js — a bot-faithful, in-memory stand-in for the real ADB
 * PluginContext (core/PluginContext.js) + HookBus (core/HookBus.js) +
 * Database (utils/database.js) in the Advanced-Discord-Bot repo.
 *
 * The bot is the source of truth. This mock mirrors, as closely as is useful
 * for offline testing:
 *   - ctx shape from PluginContext.build(): client, db, scheduler, commands,
 *     registerCommand, overrideCommand, registerEvent, defineModel, models
 *     (pre-declared null + writable), hooks, config, logger.
 *   - ctx is Object.preventExtensions'd, and every field is read-only EXCEPT
 *     `models` (writable) — exactly like the real build().
 *   - hooks: HookBus semantics — on(name, handler, priority) returns an
 *     unsubscribe fn; emitHook(name, payload) is async, supports onAny,
 *     cancel, and payload merge.
 *   - db: the Database plugin-config surface (getPluginConfig /
 *     updatePluginConfig / getAllPluginConfigs), matching the real signatures.
 *
 * No Discord connection or MongoDB required. `defineModel` returns a small
 * fake mongoose model backed by an in-memory array, supporting the query
 * chains ADB plugins actually use.
 *
 * Test-only introspection (registeredCommands, registeredEvents, emitEvent,
 * stores, ...) is returned as a SECOND object alongside the frozen ctx, so the
 * ctx itself stays faithful to what the bot hands a plugin.
 */

// --- Fake mongoose model ----------------------------------------------------
// Backed by an in-memory array. Returns thenable query builders so the common
// chains work: find(q).sort().limit().lean(), findOne(q).catch(), etc.
// `schema` (a real mongoose Schema) is used to apply field defaults on create,
// mirroring mongoose so tests see the same documents the bot would persist.
function createFakeModel(fullName, schema) {
	const store = [];
	let idCounter = 1;

	// Extract simple `default` values from the schema definition (schema.obj).
	const defaults = {};
	const shapeObj = schema && (schema.obj || (schema.tree && schema.tree));
	if (shapeObj) {
		for (const [field, def] of Object.entries(shapeObj)) {
			if (def && typeof def === "object" && "default" in def) {
				defaults[field] = def.default;
			}
		}
	}
	function applyDefaults(doc) {
		for (const [field, val] of Object.entries(defaults)) {
			if (doc[field] === undefined) {
				doc[field] = typeof val === "function" ? val() : val;
			}
		}
		return doc;
	}

	const matches = (doc, query = {}) =>
		Object.keys(query).every((k) => {
			if (k === "_id") return String(doc._id) === String(query[k]);
			return doc[k] === query[k];
		});

	// A thenable query builder over a snapshot array.
	function query(resultFactory) {
		const builder = {
			sort() {
				return builder;
			},
			limit(n) {
				builder._limit = n;
				return builder;
			},
			skip(n) {
				builder._skip = n;
				return builder;
			},
			lean() {
				return builder;
			},
			populate() {
				return builder;
			},
			select() {
				return builder;
			},
			then(resolve, reject) {
				try {
					let out = resultFactory();
					if (Array.isArray(out)) {
						if (builder._skip) out = out.slice(builder._skip);
						if (builder._limit != null) out = out.slice(0, builder._limit);
					}
					return Promise.resolve(out).then(resolve, reject);
				} catch (err) {
					return Promise.reject(err).then(resolve, reject);
				}
			},
			catch(onRej) {
				return builder.then((v) => v, onRej);
			},
		};
		return builder;
	}

	function wrapDoc(doc) {
		// Give each stored doc a save() like a mongoose document.
		Object.defineProperty(doc, "save", {
			value: async function () {
				if (!store.includes(doc)) store.push(doc);
				return doc;
			},
			enumerable: false,
		});
		return doc;
	}

	const model = {
		modelName: fullName,
		find(q = {}) {
			return query(() => store.filter((d) => matches(d, q)));
		},
		findOne(q = {}) {
			return query(() => store.find((d) => matches(d, q)) || null);
		},
		findById(id) {
			return query(() => store.find((d) => String(d._id) === String(id)) || null);
		},
		async findOneAndUpdate(q = {}, update = {}, opts = {}) {
			let doc = store.find((d) => matches(d, q));
			if (!doc && opts.upsert) {
				doc = wrapDoc(applyDefaults({ _id: idCounter++, ...q }));
				store.push(doc);
			}
			if (!doc) return null;
			applyUpdate(doc, update);
			return opts.new === false ? doc : doc;
		},
		async updateOne(q = {}, update = {}, opts = {}) {
			let doc = store.find((d) => matches(d, q));
			if (!doc && opts.upsert) {
				doc = wrapDoc(applyDefaults({ _id: idCounter++, ...q }));
				store.push(doc);
			}
			if (doc) applyUpdate(doc, update);
			return { acknowledged: true, modifiedCount: doc ? 1 : 0 };
		},
		async updateMany(q = {}, update = {}) {
			const docs = store.filter((d) => matches(d, q));
			docs.forEach((d) => applyUpdate(d, update));
			return { acknowledged: true, modifiedCount: docs.length };
		},
		async create(doc) {
			const entry = wrapDoc(applyDefaults({ _id: idCounter++, ...doc }));
			store.push(entry);
			return entry;
		},
		async deleteOne(q = {}) {
			const idx = store.findIndex((d) => matches(d, q));
			if (idx >= 0) store.splice(idx, 1);
			return { acknowledged: true, deletedCount: idx >= 0 ? 1 : 0 };
		},
		async deleteMany(q = {}) {
			const before = store.length;
			for (let i = store.length - 1; i >= 0; i--) {
				if (matches(store[i], q)) store.splice(i, 1);
			}
			return { acknowledged: true, deletedCount: before - store.length };
		},
		async countDocuments(q = {}) {
			return store.filter((d) => matches(d, q)).length;
		},
		// constructor-style: new Model(doc) then doc.save()
		// exposed as .build() to avoid needing `new`
		build(doc) {
			return wrapDoc({ _id: idCounter++, ...doc });
		},
		_store: store,
	};

	function applyUpdate(doc, update) {
		if (update.$set) Object.assign(doc, update.$set);
		if (update.$inc) {
			for (const [k, v] of Object.entries(update.$inc)) {
				doc[k] = (doc[k] || 0) + v;
			}
		}
		if (update.$push) {
			for (const [k, v] of Object.entries(update.$push)) {
				if (!Array.isArray(doc[k])) doc[k] = [];
				doc[k].push(v);
			}
		}
		// bare fields (no operator)
		for (const [k, v] of Object.entries(update)) {
			if (!k.startsWith("$")) doc[k] = v;
		}
	}

	return model;
}

function createMockCtx({ pluginName = "adb-plugin-REPLACE_ME" } = {}) {
	const logger = {
		info: (...a) => console.log("[INFO]", `[${pluginName}]`, ...a),
		warn: (...a) => console.warn("[WARN]", `[${pluginName}]`, ...a),
		error: (...a) => console.error("[ERROR]", `[${pluginName}]`, ...a),
	};

	// --- test-side registries (NOT on the real ctx) ---
	const registeredCommands = new Map();
	const registeredEvents = new Map();
	const models = new Map();

	// --- HookBus mirror ---
	const handlers = new Map();
	const anyHandlers = [];
	const hooks = {
		on(hookName, handler, priority = 0) {
			if (!handlers.has(hookName)) handlers.set(hookName, []);
			const list = handlers.get(hookName);
			list.push({ handler, priority });
			list.sort((a, b) => b.priority - a.priority);
			return () => hooks.off(hookName, handler);
		},
		onAny(handler) {
			anyHandlers.push(handler);
			return () => {
				const i = anyHandlers.indexOf(handler);
				if (i >= 0) anyHandlers.splice(i, 1);
			};
		},
		off(hookName, handler) {
			const list = handlers.get(hookName);
			if (!list) return;
			handlers.set(
				hookName,
				list.filter((e) => e.handler !== handler),
			);
		},
		async emitHook(hookName, payload) {
			let current = payload || {};
			for (const h of anyHandlers) {
				try {
					await h(hookName, current);
				} catch (e) {
					logger.warn(`onAny failed: ${hookName}`, e);
				}
			}
			for (const { handler } of handlers.get(hookName) || []) {
				try {
					const result = await handler(current);
					if (result && typeof result === "object") {
						if (result.cancel === true) {
							return { cancelled: true, payload: current };
						}
						current = { ...current, ...result };
					}
				} catch (e) {
					logger.warn(`hook failed: ${hookName}`, e);
				}
			}
			return { cancelled: false, payload: current };
		},
	};

	// --- Database plugin-config surface (matches utils/database.js) ---
	const pluginConfigs = new Map(); // key `${guildId}:${pluginName}` -> { guildId, pluginName, data }
	const db = {
		async getPluginConfig(guildId, pName) {
			const key = `${guildId}:${pName}`;
			if (!pluginConfigs.has(key)) {
				pluginConfigs.set(key, { guildId, pluginName: pName, data: {} });
			}
			return pluginConfigs.get(key);
		},
		async updatePluginConfig(guildId, pName, data) {
			const key = `${guildId}:${pName}`;
			// real bot does $set: { data } — a full replace of `data`
			const config = { guildId, pluginName: pName, data };
			pluginConfigs.set(key, config);
			return config;
		},
		async getAllPluginConfigs(guildId) {
			return [...pluginConfigs.values()].filter((c) => c.guildId === guildId);
		},
	};

	// --- Fake discord.js client ---
	const clientCommands = new Map();
	const client = {
		commands: clientCommands,
		guilds: { cache: new Map() },
		channels: { fetch: async () => null, cache: new Map() },
		user: { id: "mock-bot-id" },
		once: () => {},
		on: () => {},
	};

	// --- ctx methods (bot-faithful) ---
	function registerCommand(command) {
		if (!command || !command.data || !command.execute) {
			throw new Error("Invalid command: needs data and execute()");
		}
		registeredCommands.set(command.data.name, command);
		clientCommands.set(command.data.name, command);
	}
	function overrideCommand(name, overrideFn) {
		const command = registeredCommands.get(name);
		if (!command) throw new Error(`Command not found: ${name}`);
		command.execute = overrideFn(command.execute, command);
	}
	function registerEvent(name, handler, options = {}) {
		if (!registeredEvents.has(name)) registeredEvents.set(name, []);
		registeredEvents.get(name).push({ handler, options });
	}
	function defineModel(modelName, schema) {
		const fullName = `plugin_${pluginName}_${modelName}`;
		if (!models.has(fullName)) models.set(fullName, createFakeModel(fullName, schema));
		return models.get(fullName);
	}

	// --- Build the frozen, preventExtensions ctx exactly like build() ---
	const ctx = {
		client,
		db,
		scheduler: null, // real ADB core has no generic .schedule() — see README
		commands: clientCommands,
		registerCommand,
		overrideCommand,
		registerEvent,
		defineModel,
		models: null, // writable, like the real ctx
		hooks,
		config: { env: process.env },
		logger,
	};
	Object.keys(ctx).forEach((k) => {
		Object.defineProperty(ctx, k, {
			writable: k === "models",
			configurable: false,
		});
	});
	Object.preventExtensions(ctx);

	// --- test helper: trigger a registered event ---
	async function emitEvent(name, ...args) {
		for (const { handler } of registeredEvents.get(name) || []) {
			await handler(...args, client);
		}
	}

	return {
		ctx,
		// test-only introspection / drivers
		registeredCommands,
		registeredEvents,
		models,
		pluginConfigs,
		emitEvent,
		hooks,
	};
}

module.exports = { createMockCtx };
