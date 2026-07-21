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

function createShimContext(rpc) {
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
			rpc.call("hooks.on", { eventName: hookName }).catch((err) => {
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
	const registerCommand = async (command) => {
		if (!command || !command.data || !command.execute) {
			throw new Error(`Invalid command for plugin ${pluginId}`);
		}
		// Serialize the command for IPC (strip functions, keep data + metadata)
		const serialized = {
			data: command.data.toJSON ? command.data.toJSON() : command.data,
			// We can't send execute functions over IPC — Core will need to
			// register a proxy handler that calls back to the worker
			hasExecute: true,
			cooldown: command.cooldown,
		};
		await rpc.call("plugin.registerCommand", { command: serialized });
	};

	// Event registration: sends to Core, subscribes to forwarded events
	const registerEvent = (name, handler, options = {}) => {
		// Tell Core to listen for this Discord event
		rpc.call("plugin.registerEvent", { name, options }).catch((err) => {
			console.error(`[plugin:${pluginId}] Failed to register event ${name}:`, err.message);
		});

		// Subscribe to forwarded events from Core
		// Returns unsubscribe function (rpc.on already returns one)
		return rpc.on(`event:${name}`, (payload) => {
			try {
				handler(payload, null); // client is null in worker — use RPC for any client ops
			} catch (err) {
				console.error(`[plugin:${pluginId}] Error in event handler ${name}:`, err);
			}
		});
	};

	// Model definition: registers schema in Core, returns a proxy that routes CRUD through RPC
	const { serializeSchema } = require("./schema-serialize");
	const defineModel = (modelName, schema) => {
		// A compiled mongoose Schema can't cross the IPC boundary (its field
		// types are the String/Number/Date constructors, which structured-clone
		// rejects). Flatten it to a plain descriptor first; Core rehydrates it.
		try {
			const descriptor = serializeSchema(schema);
			rpc.call("plugin.defineModel", { modelName, schema: descriptor }).catch((err) => {
				console.warn(`[plugin:${pluginId}] defineModel ${modelName} failed:`, err.message);
			});
		} catch (err) {
			console.warn(`[plugin:${pluginId}] Could not serialize model ${modelName}:`, err.message);
		}

		// Return a model proxy that routes all operations through RPC
		return {
			find: async (query = {}) => {
				return rpc.call("model.find", { modelName, query });
			},
			findOne: async (query = {}) => {
				return rpc.call("model.findOne", { modelName, query });
			},
			create: async (data) => {
				return rpc.call("model.create", { modelName, data });
			},
			updateOne: async (query = {}, update = {}) => {
				return rpc.call("model.updateOne", { modelName, query, update });
			},
			deleteOne: async (query = {}) => {
				return rpc.call("model.deleteOne", { modelName, query });
			},
			countDocuments: async (query = {}) => {
				return rpc.call("model.countDocuments", { modelName, query });
			},
			// Save a previously-fetched document (apply mutations + save in Core)
			save: async (doc, changes, markModifiedField) => {
				return rpc.call("model.save", { modelName, docId: doc._id, changes, markModifiedField });
			},
		};
	};

	// Scheduler proxy: routes cron scheduling through RPC
	const scheduledTasks = new Map();
	const schedulerCallbacks = new Map();
	const schedulerProxy = {
		schedule: async (expression, callback, name) => {
			const taskId = name || `task_${Date.now()}`;
			// Store callback keyed by taskId
			schedulerCallbacks.set(taskId, callback);
			// Subscribe to cron tick events from Core — broker emits 'cron:tick' with { pluginId, taskId }
			rpc.on('cron:tick', (payload) => {
				if (payload.pluginId === pluginId && payload.taskId === taskId) {
					const cb = schedulerCallbacks.get(taskId);
					if (cb) cb();
				}
			});
			await rpc.call("scheduler.schedule", { expression, name: taskId });
			scheduledTasks.set(taskId, true);
			return taskId;
		},
		cancel: async (taskId) => {
			await rpc.call("scheduler.cancel", { taskId });
			scheduledTasks.delete(taskId);
			schedulerCallbacks.delete(taskId);
		},
	};

	// Discord proxy: routes all Discord API calls through RPC
	const discordProxy = {
		// Send a rich message (content + embeds + files) to a channel
		sendToChannel: async (channelId, payload) => {
			return rpc.call("discord.sendRichMessage", {
				channelId,
				content: payload.content,
				embeds: payload.embeds || [],
				files: payload.files || [],
			});
		},
		// Send a DM (content + embeds + files) to a user
		sendDM: async (userId, payload) => {
			return rpc.call("discord.sendDM", {
				userId,
				content: payload.content,
				embeds: payload.embeds || [],
				files: payload.files || [],
			});
		},
		// Fetch guild info (returns object with iconURL)
		getGuild: async (guildId) => {
			return rpc.call("discord.getGuild", { guildId, iconFormat: "png", iconSize: 128 });
		},
		// Fetch member info (returns object with user.avatarURL)
		getMember: async (guildId, userId) => {
			return rpc.call("discord.getMember", { guildId, userId, avatarFormat: "png", avatarSize: 256 });
		},
		// Fetch channel info
		fetchChannel: async (channelId) => {
			return rpc.call("discord.fetchChannel", { channelId });
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
		config: { env: {} },
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
			const { callId, commandName, interaction } = msg.payload;
			const cmd = registeredCommands.get(commandName);
			if (!cmd) {
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
				.then(() => cmd.execute(interactionProxy))
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
			const shimCtx = createShimContext(rpc);
			const origRegisterCommand = shimCtx.registerCommand;
			shimCtx.registerCommand = async (command) => {
				if (command && command.data && command.execute) {
					registeredCommands.set(command.data.name, command);
				}
				return origRegisterCommand(command);
			};

			await loadFn(shimCtx);
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

	const proxy = {
		id: data.id,
		type: data.type,
		commandName: data.commandName,
		guildId: data.guildId,
		channelId: data.channelId,
		user: data.user || null,
		member: data.member || null,

		options: {
			data: data.options || [],
			getString: (name) => {
				const opt = (data.options || []).find((o) => o.name === name);
				return opt?.value ?? null;
			},
			getInteger: (name) => {
				const opt = (data.options || []).find((o) => o.name === name);
				return opt?.value ?? null;
			},
			getBoolean: (name) => {
				const opt = (data.options || []).find((o) => o.name === name);
				return opt?.value ?? null;
			},
			getUser: (name) => {
				const opt = (data.options || []).find((o) => o.name === name);
				return opt?.user || opt?.value || null;
			},
			getChannel: (name) => {
				const opt = (data.options || []).find((o) => o.name === name);
				return opt?.channel || opt?.value || null;
			},
			getSubcommand: () => {
				const sub = (data.options || []).find((o) => o.type === 1);
				return sub?.name || null;
			},
		},

		// reply / followUp / editReply / deferReply — route through RPC
		reply: async (payload) => {
			const p = typeof payload === "string" ? { content: payload } : payload;
			return rpc.call("discord.sendRichMessage", {
				channelId: data.channelId,
				content: p.content,
				embeds: p.embeds || [],
				files: p.files || [],
			});
		},
		followUp: async (payload) => {
			const p = typeof payload === "string" ? { content: payload } : payload;
			return rpc.call("discord.sendRichMessage", {
				channelId: data.channelId,
				content: p.content,
				embeds: p.embeds || [],
				files: p.files || [],
			});
		},
		editReply: async (payload) => {
			const p = typeof payload === "string" ? { content: payload } : payload;
			// editReply requires the original message — for now send as new message
			return rpc.call("discord.sendRichMessage", {
				channelId: data.channelId,
				content: p.content,
				embeds: p.embeds || [],
				files: p.files || [],
			});
		},
		deferReply: async () => ({ ok: true }),
	};

	return proxy;
}

// Export for testing
module.exports = { createShimContext, IS_WORKER };
