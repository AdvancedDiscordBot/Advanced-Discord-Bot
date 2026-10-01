/**
 * worker-bootstrap.js — Worker thread entry point for sandboxed plugins.
 *
 * This file runs inside a worker_threads Worker. It:
 *   1. Receives plugin metadata via workerData (entry path, plugin ID)
 *   2. Creates an RpcClient connected to the parent (Core) process
 *   3. Builds a shim ctx that looks like the old plugin context but routes
 *      all calls through RPC — the worker never touches the real DB or client
 *   4. Requires and executes the plugin's load() function
 *   5. Signals readiness back to Core
 *
 * IMPORTANT: This file must be self-contained. It cannot import from the
 * project root because worker_threads run in a separate V8 isolate with
 * its own module resolution. All required modules must be either:
 *   - Node.js built-ins (path, util)
 *   - Relative to this file (./protocol.js, ./worker-client.js)
 *   - Passed via workerData (the plugin's entry path)
 */

const path = require("path");
const workerThreads = require("worker_threads");
const { parentPort, workerData } = workerThreads;
const { RpcClient } = require("./worker-client");
const { INTERACTION_METHODS } = require("./methods");
const { serializeSchema, serializeValue } = require("./schema-serialize");

// ── Guard: only run inside a worker thread ───────────────────────────────
// When required from the main process (e.g. for tests), parentPort and
// workerData are undefined.  We export createShimContext for testing and
// skip auto-execution.
const IS_WORKER = !!(parentPort && workerData);

if (IS_WORKER) {
	// Validate workerData
	if (!workerData.entryPath || !workerData.pluginId) {
		const msg = "worker-bootstrap: missing required workerData (entryPath, pluginId)";
		parentPort.postMessage({ type: "worker:error", error: msg });
		process.exit(1);
	}
}

const { entryPath, pluginId } = workerData || {};

// ── Build Shim Context ───────────────────────────────────────────────────
//
// This context object has the same shape as the old ctx, but every
// method that touches real resources goes through RPC instead of
// direct access.

function createShimContext(rpc, grantedEnv = {}, registrations = { pending: new Set(), error: null }) {
	const trackRegistration = (promise) => {
		registrations.pending.add(promise);
		promise.then(
			() => registrations.pending.delete(promise),
			(error) => {
				registrations.pending.delete(promise);
				registrations.error ||= error;
			},
		);
		return promise;
	};
	// DB proxy: routes all db.* calls through RPC
	// The broker accepts flexible params — we pass args as a positional array
	// and the broker's handler destructures them.
	const SUPPORTED_DB_METHODS = new Set([
		"getPluginConfig", "updatePluginConfig", "getAllPluginConfigs",
		"getUserProfile", "updateUserProfile", "addXP",
		"getTopUsers", "getUserRank", "checkRoleRewards",
		"updateUserRoles", "getServerConfig", "updateServerConfig",
		"getServerStats", "getUserPoints", "getPointsLeaderboard",
		"givePoints", "createTicket", "getTickets",
		"getTicketById", "updateTicket", "updateTicketStatus",
	]);

	const dbProxy = new Proxy(
		{},
		{
			get(_target, prop) {
				if (typeof prop === "symbol") return undefined;
				if (prop === "constructor") return Object;
				if (prop === "ensureConnection") return async () => {}; // no-op in worker

				if (!SUPPORTED_DB_METHODS.has(prop)) {
					return async (..._args) => {
						throw new Error(
							`ctx.db.${prop} is not available in isolated mode. ` +
								`Supported methods: ${Array.from(SUPPORTED_DB_METHODS).join(", ")}`,
						);
					};
				}

			return async (...args) => {
				const rpcMethod = `db.${prop}`;
				return rpc.call(rpcMethod, { args });
			};
			},
		},
	);

	// Hooks proxy: subscribe to events, emit through RPC
	const hooksProxy = {
		on: (hookName, handler, _priority) => {
			// Tell Core to subscribe to this hook and forward events
			trackRegistration(rpc.call("hooks.on", { eventName: hookName })).catch((err) => {
				console.error(`[plugin:${pluginId}] Failed to subscribe to hook ${hookName}:`, err.message);
			});
			// Subscribe to forwarded events from Core — rpc.on returns an unsubscribe fn
			return rpc.on(`hook:${hookName}`, handler);
		},
		onAny: (_handler) => {
			console.warn(
				`[Worker ${pluginId}] hooks.onAny() is not supported in isolated mode. ` +
					`Use hooks.on() for specific hook names.`,
			);
			return () => {};
		},
		emitHook: async (hookName, payload) => {
			return rpc.call("hooks.emit", { hookName, payload });
		},
	};

	// Logger: routes to console with plugin prefix
	const loggerProxy = {
		info: (msg, meta) => console.log(`[plugin:${pluginId}]`, msg, meta || ""),
		warn: (msg, meta) => console.warn(`[plugin:${pluginId}]`, msg, meta || ""),
		error: (msg, meta) => console.error(`[plugin:${pluginId}]`, msg, meta || ""),
		debug: (msg, meta) => {
			if (process.env.DEBUG) console.debug(`[plugin:${pluginId}]`, msg, meta || "");
		},
	};

	// Command registration: sends to Core via RPC
	const registerCommand = (command) => {
		if (!command?.data || typeof command.execute !== "function") {
			throw new Error(`Invalid command for plugin ${pluginId}`);
		}
		// Serialize the command for IPC (strip functions, keep data + metadata).
		// A JSON round-trip is the sanitizer: SlashCommandBuilder.toJSON() already
		// returns plain JSON, and hand-built data objects may carry a
		// `toJSON() { return this; }` that returns the same function-bearing
		// object — postMessage's structured clone would throw on it.
		const serialized = {
			data: JSON.parse(JSON.stringify(command.data.toJSON ? command.data.toJSON() : command.data)),
			// We can't send execute functions over IPC — Core will need to
			// register a proxy handler that calls back to the worker
			hasExecute: true,
			hasAutocomplete: typeof command.autocomplete === "function",
			cooldown: command.cooldown,
			guildIds: serializeValue(command.guildIds),
			guildData: serializeValue(command.guildData),
			permissions: serializeValue(command.permissions),
		};
		return trackRegistration(rpc.call("plugin.registerCommand", { command: serialized }));
	};

	// Event registration: sends to Core, subscribes to forwarded events
	const registerEvent = (name, handler, options = {}) => {
		if (typeof handler !== "function") throw new Error(`Invalid event handler for ${name}`);
		// Tell Core to listen for this Discord event
		trackRegistration(rpc.call("plugin.registerEvent", { name }));

		// Subscribe to forwarded events from Core
		// Returns unsubscribe function (rpc.on already returns one)
		const unsubscribe = rpc.on(`event:${name}`, (payload) => {
			if (options.once) unsubscribe();
			const args = name === "interactionCreate"
				? payload.args.map((arg) => buildInteractionProxy(arg, rpc))
				: payload.args;
			return handler(...args, null); // RpcClient observes asynchronous failures too.
		});
		return unsubscribe;
	};

	// Model definition: registers schema in Core, returns a proxy that routes CRUD through RPC
	// modelName -> Promise that resolves once Core has registered the model.
	// Without this guard, a query fired immediately after defineModel can
	// reach the broker before the registration RPC does ("Model not
	// registered" crash at plugin startup).
	const modelReady = new Map();
	const defineModel = (modelName, schema) => {
		// A compiled mongoose Schema can't cross the IPC boundary (its field
		// types are the String/Number/Date constructors, which structured-clone
		// rejects). Flatten it to a plain descriptor first; Core rehydrates it.
		const descriptor = serializeSchema(schema);
		const ready = trackRegistration(rpc.call("plugin.defineModel", { modelName, schema: descriptor }));
		modelReady.set(modelName, ready);

		const call = (method, params) =>
			(modelReady.get(modelName) || Promise.resolve()).then(() =>
				rpc.call(method, serializeValue(params)),
			);
		const hydrate = (value) => {
			if (Array.isArray(value)) return value.map(hydrate);
			if (!value || typeof value !== "object" || !value._id) return value;
			const modified = new Set();
			Object.defineProperties(value, {
				markModified: { value: (field) => modified.add(field) },
				save: { value: async () => {
					const saved = await call("model.save", {
						modelName, docId: value._id, changes: serializeValue(value), markModifiedFields: [...modified],
					});
					Object.assign(value, saved);
					modified.clear();
					return value;
				} },
			});
			return value;
		};

		// Chainable query for find/findOne — plugins use the mongoose query
		// API (await Model.find(q).sort({x:1}).limit(10).lean()), so a bare
		// Promise return breaks .limit()/.sort() calls.
		const makeQuery = (method, base, options = {}) => {
			const opts = { ...options };
			let execution;
			const exec = () => execution ||= call(method, { ...base, options: opts }).then((result) => opts.lean ? result : hydrate(result));
			const query = {
				limit(n) { opts.limit = n; return query; },
				sort(s) { opts.sort = s; return query; },
				skip(n) { opts.skip = n; return query; },
				select(fields) { opts.select = fields; return query; },
				lean(enabled = true) { opts.lean = enabled; return query; },
				exec,
				then: (onFulfilled, onRejected) => exec().then(onFulfilled, onRejected),
				catch: (fn) => exec().catch(fn),
				finally: (fn) => exec().finally(fn),
			};
			return query;
		};

		// Return a model proxy that routes all operations through RPC
		return {
			find: (query = {}) => makeQuery("model.find", { modelName, query }),
			findOne: (query = {}) => makeQuery("model.findOne", { modelName, query }),
			findById: (id) => makeQuery("model.findOne", { modelName, query: { _id: id } }),
			create: (data) => call("model.create", { modelName, data }).then(hydrate),
			updateOne: (query = {}, update = {}) =>
				call("model.updateOne", { modelName, query, update }),
			updateMany: (query = {}, update = {}) =>
				call("model.updateMany", { modelName, query, update }),
			findOneAndUpdate: (query = {}, update = {}, options = {}) =>
				makeQuery("model.findOneAndUpdate", { modelName, query, update }, options),
			deleteOne: (query = {}) =>
				call("model.deleteOne", { modelName, query }),
			deleteMany: (query = {}) =>
				call("model.deleteMany", { modelName, query }),
			countDocuments: (query = {}) =>
				call("model.countDocuments", { modelName, query }),
			// Save a previously-fetched document (apply mutations + save in Core)
			save: async (doc, changes = doc, markModifiedField) => {
				return hydrate(await call("model.save", { modelName, docId: doc._id, changes, markModifiedField }));
			},
		};
	};

	// Scheduler proxy: routes cron scheduling through RPC
	const scheduledTasks = new Map();
	const schedulerProxy = {
		schedule: (expression, callback, name) => {
			return trackRegistration(rpc.call("scheduler.schedule", { expression, name }).then(({ taskId }) => {
				const unsubscribe = rpc.on("cron:tick", (payload) => {
					if (payload.taskId === taskId) return callback();
				});
				scheduledTasks.set(taskId, unsubscribe);
				return taskId;
			}));
		},
		cancel: async (taskId) => {
			await rpc.call("scheduler.cancel", { taskId });
			scheduledTasks.get(taskId)?.();
			scheduledTasks.delete(taskId);
		},
	};

	const discordProxy = {
  // Send a simple text message to a channel
  sendMessage: async (channelId, content) => {
    return rpc.call("discord.sendMessage", {
      channelId,
      content,
    });
  },

  // Send a rich message with content, embeds, and files
  sendToChannel: async (channelId, payload) => {
    return rpc.call("discord.sendRichMessage", {
      ...(typeof payload === "string" ? { content: payload } : payload),
      channelId,
    });
  },

  // Send an embed to a channel
  sendEmbed: async (channelId, embed) => {
    return rpc.call("discord.sendEmbed", {
      channelId,
      embed,
    });
  },

  // Send a DM to a user
  sendDM: async (userId, payload) => {
    return rpc.call("discord.sendDM", {
      ...(typeof payload === "string" ? { content: payload } : payload),
      userId,
    });
  },

  // Fetch guild information
  getGuild: async (guildId) => {
    return rpc.call("discord.getGuild", {
      guildId,
      iconFormat: "png",
      iconSize: 128,
    });
  },

  // Fetch member information
  getMember: async (guildId, userId) => {
    return rpc.call("discord.getMember", {
      guildId,
      userId,
      avatarFormat: "png",
      avatarSize: 256,
    });
  },

  // Fetch channel information
  fetchChannel: async (channelId) => {
    return rpc.call("discord.fetchChannel", {
      channelId,
    });
  },

  // Add a role to a member
  addRole: async (guildId, userId, roleId, reason) => {
    return rpc.call("discord.addRole", {
      guildId,
      userId,
      roleId,
      reason,
    });
  },

  // Remove a role from a member
  removeRole: async (guildId, userId, roleId, reason) => {
    return rpc.call("discord.removeRole", {
      guildId,
      userId,
      roleId,
      reason,
    });
  },

  // Delete a message
  deleteMessage: async (channelId, messageId) => {
    return rpc.call("discord.deleteMessage", {
      channelId,
      messageId,
    });
  },

  // Add a reaction to a message
  addReaction: async (channelId, messageId, emoji) => {
    return rpc.call("discord.addReaction", {
      channelId,
      messageId,
      emoji,
    });
  },

  // Timeout a member
timeout: async (guildId, userId, ms, reason) => {
  return rpc.call("discord.timeout", {
    guildId,
    userId,
    ms,
    reason,
  });
},
  // Kick a member
  kick: async (guildId, userId, reason) => {
    return rpc.call("discord.kick", {
      guildId,
      userId,
      reason,
    });
  },

  // Ban a member
  ban: async (guildId, userId, reason, days) => {
    return rpc.call("discord.ban", {
      guildId,
      userId,
      reason,
      deleteMessageDays: days,
    });
  },
};
	
	return {
		client: null, // Never available in worker — use ctx.discord for Discord ops
		discord: discordProxy,
		db: dbProxy,
		scheduler: schedulerProxy,
		commands: null, // Commands are registered via ctx.registerCommand()
		registerCommand,
		overrideCommand: (name, _overrideFn) => {
			console.warn(
				`[plugin:${pluginId}] ctx.overrideCommand("${name}") is not supported in isolated mode.`,
			);
		},
		registerEvent,
		defineModel,
		models: null, // Plugins assign after defineModel
		hooks: hooksProxy,
		config: { env: grantedEnv || {} },
		logger: loggerProxy,
	};
}

// ── Worker Thread Entry (only runs inside a worker_threads Worker) ─────

if (IS_WORKER) {
	const rpc = new RpcClient(parentPort, { defaultTimeoutMs: 10000 });

	// Track registered commands locally so we can route command:execute events
	const registeredCommands = new Map();

	// Listen for command execution requests from Core
	parentPort.on("message", (msg) => {
		if (msg.type === "rpc:event" && msg.event === "command:execute") {
			const { callId, commandName, interaction, action } = msg.payload;
			const cmd = registeredCommands.get(commandName);
			if (!cmd || !["execute", "autocomplete"].includes(action) || typeof cmd[action] !== "function") {
				parentPort.postMessage({
					type: "rpc:response",
					id: callId,
					ok: false,
					error: `Command "${commandName}" not found in worker`,
				});
				return;
			}

			const interactionProxy = buildInteractionProxy(interaction, rpc);

			Promise.resolve()
				.then(() => cmd[action](interactionProxy, null))
				.then(() => {
					parentPort.postMessage({
						type: "rpc:response",
						id: callId,
						ok: true,
						result: { executed: true },
					});
				})
				.catch((err) => {
					parentPort.postMessage({
						type: "rpc:response",
						id: callId,
						ok: false,
						error: err.message,
					});
				});
		}
	});

	async function main() {
		try {
			const fullPath = path.resolve(entryPath);
			const pluginModule = require(fullPath);
			const loadFn = pluginModule.load || pluginModule.default || pluginModule;

			if (typeof loadFn !== "function") {
				throw new Error(`Plugin entry does not export load(ctx). Got: ${typeof loadFn}`);
			}

			// Override registerCommand to also track locally for command:execute routing
			const registrations = { pending: new Set(), error: null };
			const shimCtx = createShimContext(rpc, workerData.grantedEnv, registrations);
			const origRegisterCommand = shimCtx.registerCommand;
			shimCtx.registerCommand = (command) => {
				if (command && command.data && command.execute) {
					registeredCommands.set(command.data.name, command);
				}
				return origRegisterCommand(command);
			};

			await loadFn(shimCtx);
			while (registrations.pending.size) await Promise.allSettled([...registrations.pending]);
			if (registrations.error) throw registrations.error;
			rpc.ready();
		} catch (error) {
			console.error(`[worker-bootstrap] Failed to load plugin ${pluginId}:`, error);
			rpc.error(error.message);
			process.exit(1);
		}
	}

	main();
}

// ── Interaction Proxy ────────────────────────────────────────────────────
// Builds a lightweight proxy object that looks enough like a real Discord
// interaction for most command execute() functions.

function buildInteractionProxy(data, rpc) {
	if (!data) return {};
	const leaves = new Map();
	let subcommand = null;
	let group = null;
	const visit = (options) => {
		for (const option of options || []) {
			if (option.type === 1) subcommand = option.name;
			else if (option.type === 2) group = option.name;
			else leaves.set(option.name, option);
			if (option.options) visit(option.options);
		}
	};
	visit(data.options);
	const requiredValue = (value, name, required) => {
		if (value == null && required) throw new Error(`Required interaction option missing: ${name}`);
		return value ?? null;
	};
	const proxy = {
		...data,
		user: data.user || null,
		member: data.member || null,
		inGuild: () => !!data.guildId,
		isCommand: () => data.type === 2,
		isChatInputCommand: () => data.type === 2 && (data.commandType == null || data.commandType === 1),
		isAutocomplete: () => data.type === 4,
		isModalSubmit: () => data.type === 5,
		isMessageComponent: () => data.type === 3,
		isButton: () => data.type === 3 && data.componentType === 2,
		isStringSelectMenu: () => data.type === 3 && data.componentType === 3,
		options: {
			data: data.options || [],
			get: (name, required = false) => requiredValue(leaves.get(name), name, required),
			getSubcommand: (required = true) => requiredValue(subcommand, "subcommand", required),
			getSubcommandGroup: (required = false) => requiredValue(group, "subcommand group", required),
			getFocused: (full = false) => {
				const focused = requiredValue([...leaves.values()].find((option) => option.focused), "focused", true);
				return full ? focused : focused.value;
			},
		},
		fields: {
			getTextInputValue: (customId) => requiredValue((data.fields || []).find((field) => field.customId === customId)?.value, customId, true),
		},
	};
	for (const [method, field] of Object.entries({
		getString: "value", getInteger: "value", getNumber: "value", getBoolean: "value",
		getUser: "user", getMember: "member", getRole: "role", getChannel: "channel", getAttachment: "attachment",
	})) {
		proxy.options[method] = (name, required = false) => requiredValue(leaves.get(name)?.[field], name, required);
	}
	proxy.options.getMentionable = (name, required = false) => {
		const option = leaves.get(name);
		return requiredValue(option?.member || option?.user || option?.role, name, required);
	};
	for (const method of Object.keys(INTERACTION_METHODS)) {
		proxy[method] = async (payload) => {
			if (!data._handle) throw new Error("Interaction is not authorized for this plugin");
			const response = await rpc.call(`interaction.${method}`, { handle: data._handle, payload });
			Object.assign(proxy, response.state);
			return response.result;
		};
	}
	return proxy;
}

// Export for testing
module.exports = { createShimContext, IS_WORKER };
