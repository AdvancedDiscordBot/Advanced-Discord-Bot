const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const { PluginContext } = require("./PluginContext");
const { validateCapabilities } = require("./capabilities");
const { createLogger } = require("./logger");

class PluginManager {
	constructor({ client, db, scheduler, hooks, config = {} }) {
		this.client = client;
		this.db = db;
		this.scheduler = scheduler;
		this.hooks = hooks;
		this.config = {
			pluginsDir: config.pluginsDir || path.join(process.cwd(), "plugins"),
			nodeModulesDir:
				config.nodeModulesDir || path.join(process.cwd(), "node_modules"),
		};

		this.logger = createLogger("PluginManager");
		this.plugins = new Map();
		this.watchers = new Map();

		// ── Plugin Isolation (opt-in) ──────────────────────────────────────
		// When enabled, third-party plugins load in worker_threads instead of
		// sharing the main process.  Core plugins always load directly.
		this.isolationEnabled = false;
		this.workerManager = null;
		this.broker = null;
	}

	/**
	 * Enable plugin isolation.  Must be called before loadAll() if desired.
	 * Creates the CapabilityBroker and WorkerManager, wires Discord event
	 * forwarding, and adds RPC handlers for command/event registration.
	 */
	enableIsolation() {
		const { CapabilityBroker } = require("./rpc/broker");
		const { WorkerManager } = require("./rpc/worker-manager");

		this.broker = new CapabilityBroker({
			db: this.db,
			client: this.client,
			hooks: this.hooks,
		});

		this.workerManager = new WorkerManager({
			broker: this.broker,
			hooks: this.hooks,
		});

		// Forward Discord events from the Client to all workers
		this._forwardDiscordEvents();

		// Register RPC handlers for plugin.registerCommand / registerEvent
		this._registerIsolationRpcHandlers();

		this.isolationEnabled = true;
		this.logger.info("Plugin isolation enabled (worker_threads)");
	}

	/**
	 * Forward Discord client events to workers via the WorkerManager.
	 * Only events that plugins commonly subscribe to are forwarded.
	 */
	_forwardDiscordEvents() {
		const EVENTS_TO_FORWARD = [
			"guildMemberAdd", "guildMemberRemove",
			"messageCreate", "messageDelete", "messageUpdate",
			"guildCreate", "guildDelete",
			"interactionCreate",
			"voiceStateUpdate",
			"guildMemberUpdate",
			"ready",
		];

		for (const eventName of EVENTS_TO_FORWARD) {
			this.client.on(eventName, (...args) => {
				if (!this.workerManager) return;
				// Serialize the event payload for IPC transfer.
				// For GuildMember / Message objects, extract only safe, serializable fields.
				const payload = this._serializeDiscordEvent(eventName, args);
				this.workerManager.broadcastEvent(`event:${eventName}`, payload);
			});
		}
	}

	/**
	 * Serialize a Discord event's arguments into a plain, IPC-safe object.
	 * @private
	 */
	_serializeDiscordEvent(eventName, args) {
		// Default: try structuredClone, fall back to JSON round-trip
		const trySerialize = (obj) => {
			try {
				if (obj && typeof obj.toJSON === "function") return obj.toJSON();
				return JSON.parse(JSON.stringify(obj, (key, val) => {
					if (typeof val === "function") return undefined;
					if (val && val.constructor && val.constructor.name === "GuildMember") {
						return {
							id: val.id,
							user: { id: val.user?.id, tag: val.user?.tag, username: val.user?.username, bot: val.user?.bot, avatarURL: val.user?.displayAvatarURL?.({ extension: "png", size: 256 }) || null },
							nickname: val.nickname,
							guildId: val.guild?.id,
							roles: Array.from(val.roles?.cache?.keys() || []),
							joinedAt: val.joinedAt,
						};
					}
					if (val && val.constructor && val.constructor.name === "Message") {
						return {
							id: val.id,
							content: val.content,
							author: { id: val.author?.id, tag: val.author?.tag, username: val.author?.username, bot: val.author?.bot },
							guildId: val.guild?.id,
							channelId: val.channel?.id,
						};
					}
					return val;
				}));
			} catch {
				return { _unserializable: true, eventName };
			}
		};

		if (args.length === 0) return {};
		if (args.length === 1) return trySerialize(args[0]);
		return args.map(trySerialize);
	}

	/**
	 * Register RPC handlers that let worker plugins register commands and events
	 * back into the Core process.
	 * @private
	 */
	_registerIsolationRpcHandlers() {
		// Store the original execute method so we can proxy through RPC
		// plugin.registerCommand RPC: worker sends serialized command data,
		// we create a proxy execute that calls back to the worker.
		this._registerCommandRpcHandler();
		this._registerEventRpcHandler();
		this._registerModelRpcHandler();
	}

	/**
	 * Handle plugin.registerCommand RPC from workers.
	 * @private
	 */
	_registerCommandRpcHandler() {
		// Intercept in the broker's handleRequest — we patch the execute method
		// on the broker to add our custom handlers.
		const origHandleRequest = this.broker.handleRequest.bind(this.broker);
		const self = this;

		this.broker.handleRequest = async function (pluginId, request) {
			if (request.method === "plugin.registerCommand") {
				const { command } = request.params;
				if (!command || !command.data) {
					return { id: request.id, ok: false, error: "Invalid command" };
				}

				// Create a proxy execute that sends the interaction back to the worker
				const proxyExecute = async (interaction) => {
					const workerEntry = self.workerManager?.workers?.get(pluginId);
					if (!workerEntry || !workerEntry.ready) {
						await interaction.reply({ content: "Plugin is not available.", ephemeral: true });
						return;
					}

					// Serialize the interaction for IPC
					const serializedInteraction = self._serializeInteraction(interaction);

					// Send to worker and wait for response
					const response = await new Promise((resolve) => {
						const callId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
						const timer = setTimeout(() => resolve({ error: "Command execution timed out" }), 15000);

						const handler = (msg) => {
							if (msg.type === "rpc:response" && msg.id === callId) {
								clearTimeout(timer);
								workerEntry.worker.removeListener("message", handler);
								resolve(msg);
							}
						};
						workerEntry.worker.on("message", handler);

						workerEntry.worker.postMessage({
							type: "rpc:event",
							event: "command:execute",
							payload: { callId, commandName: command.data.name, interaction: serializedInteraction },
						});
					});

					if (response.error) {
						try { await interaction.reply({ content: `Error: ${response.error}`, ephemeral: true }); } catch {}
					}
				};

				self.registerCommand(pluginId, { data: command.data, execute: proxyExecute });
				return { id: request.id, ok: true, result: { registered: true } };
			}

			if (request.method === "plugin.registerEvent") {
				// Events are registered client-side by the WorkerManager forwarding
				return { id: request.id, ok: true, result: { registered: true } };
			}

			if (request.method === "plugin.defineModel") {
				const { modelName, schema } = request.params;
				try {
					self.broker.registerModel(pluginId, modelName, schema);
				} catch (err) {
					// Model may already be registered — that's fine
				}
				return { id: request.id, ok: true, result: { registered: true } };
			}

			// Fall through to normal broker handling
			return origHandleRequest(pluginId, request);
		};
	}

	/**
	 * Handle plugin.registerEvent RPC from workers.
	 * @private
	 */
	_registerEventRpcHandler() {
		// Already handled in _registerCommandRpcHandler above
	}

	/**
	 * Handle plugin.defineModel RPC from workers.
	 * @private
	 */
	_registerModelRpcHandler() {
		// Already handled in _registerCommandRpcHandler above
	}

	/**
	 * Serialize a Discord interaction for IPC transfer.
	 * @private
	 */
	_serializeInteraction(interaction) {
		try {
			return {
				id: interaction.id,
				type: interaction.type,
				commandName: interaction.commandName,
				options: interaction.options?.data || [],
				guildId: interaction.guildId,
				channelId: interaction.channelId,
				user: interaction.user ? {
					id: interaction.user.id,
					tag: interaction.user.tag,
					username: interaction.user.username,
				} : null,
				member: interaction.member ? {
					id: interaction.member.id,
					user: { id: interaction.member.user?.id, tag: interaction.member.user?.tag, username: interaction.member.user?.username },
					guildId: interaction.member.guild?.id,
					nickname: interaction.member.nickname,
					roles: Array.from(interaction.member.roles?.cache?.keys() || []),
				} : null,
				// Store methods that need to be called back via RPC
				_replies: [],
			};
		} catch {
			return { id: interaction.id, _unserializable: true };
		}
	}

	async loadAll() {
		await this.loadCore();

		const discovered = this.discoverPlugins();
		const ordered = this.sortByDependencies(discovered);

		for (const plugin of ordered) {
			await this.loadPlugin(plugin);
		}

		this.setupHotReload();
	}

	async loadCore() {
		const pluginName = "core";

		if (this.plugins.has(pluginName)) {
			return;
		}

		const logger = createLogger(`plugin:${pluginName}`);
		const pluginState = this.initPluginState(pluginName, {
			name: pluginName,
			version: "0.0.0",
			description: "Internal core plugin",
		});

		this.plugins.set(pluginName, pluginState);

		pluginState.source = "builtin";

		const ctx = this.buildContext(pluginName, logger);

		const commandsPath = path.join(process.cwd(), "commands");
		const eventsPath = path.join(process.cwd(), "events");

		this.loadCommandsFromDir(commandsPath, pluginName, ctx);
		this.loadEventsFromDir(eventsPath, pluginName, ctx, {
			excludeFiles: ["helpInteraction.js", "modalCreate.js"],
		});

		await this.hooks.emitHook("onPluginLoad", { pluginName });
	}

	discoverPlugins() {
		const discovered = [];

		if (fs.existsSync(this.config.pluginsDir)) {
			const items = fs.readdirSync(this.config.pluginsDir, {
				withFileTypes: true,
			});

			for (const item of items) {
				if (!item.isDirectory()) continue;

				const pluginPath = path.join(this.config.pluginsDir, item.name);
				const manifestPath = path.join(pluginPath, "plugin.json");
				if (!fs.existsSync(manifestPath)) continue;

				const manifest = this.readManifest(manifestPath);
				const name = manifest.name || item.name;

				discovered.push({
					name,
					manifest,
					basePath: pluginPath,
					entryPath: path.join(pluginPath, manifest.main || "index.js"),
					source: "local",
				});
			}
		}

		if (fs.existsSync(this.config.nodeModulesDir)) {
			const packages = fs.readdirSync(this.config.nodeModulesDir, {
				withFileTypes: true,
			});

			for (const pkg of packages) {
				if (pkg.name.startsWith("@") && pkg.isDirectory()) {
					const scopedPath = path.join(this.config.nodeModulesDir, pkg.name);
					const scopedPackages = fs.readdirSync(scopedPath, {
						withFileTypes: true,
					});

					for (const scopedPkg of scopedPackages) {
						if (!scopedPkg.isDirectory()) continue;
						const packageName = `${pkg.name}/${scopedPkg.name}`;
						if (!scopedPkg.name.startsWith("adb-plugin-")) continue;

						const pluginPath = path.join(scopedPath, scopedPkg.name);
						const manifestPath = path.join(pluginPath, "plugin.json");
						if (!fs.existsSync(manifestPath)) continue;

						const manifest = this.readManifest(manifestPath);
						const name = manifest.name || packageName;

						discovered.push({
							name,
							manifest,
							basePath: pluginPath,
							entryPath: path.join(pluginPath, manifest.main || "index.js"),
							source: "package",
							packageName,
						});
					}

					continue;
				}

				if (!pkg.isDirectory()) continue;
				if (!pkg.name.startsWith("adb-plugin-")) continue;

				const pluginPath = path.join(this.config.nodeModulesDir, pkg.name);
				const manifestPath = path.join(pluginPath, "plugin.json");
				if (!fs.existsSync(manifestPath)) continue;

				const manifest = this.readManifest(manifestPath);
				const name = manifest.name || pkg.name;

				discovered.push({
					name,
					manifest,
					basePath: pluginPath,
					entryPath: path.join(pluginPath, manifest.main || "index.js"),
					source: "package",
					packageName: pkg.name,
				});
			}
		}

		return discovered;
	}

	sortByDependencies(discovered) {
		const nodes = new Map();
		const edges = new Map();

		for (const plugin of discovered) {
			nodes.set(plugin.name, plugin);
			edges.set(plugin.name, new Set());
		}

		for (const plugin of discovered) {
			const deps = this.getDependencies(plugin.manifest);
			for (const dep of deps) {
				if (!nodes.has(dep)) {
					this.logger.warn(`Plugin ${plugin.name} missing dependency ${dep}`);
					plugin.disabled = true;
					continue;
				}

				edges.get(plugin.name).add(dep);
			}
		}

		const ordered = [];
		const visiting = new Set();
		const visited = new Set();

		const visit = (name) => {
			if (visited.has(name)) return;
			if (visiting.has(name)) {
				throw new Error(`Circular dependency detected at ${name}`);
			}

			visiting.add(name);
			for (const dep of edges.get(name) || []) {
				visit(dep);
			}
			visiting.delete(name);
			visited.add(name);
			ordered.push(nodes.get(name));
		};

		for (const plugin of discovered) {
			if (plugin.disabled) continue;
			visit(plugin.name);
		}

		return ordered;
	}

	readManifest(manifestPath) {
		const raw = fs.readFileSync(manifestPath, "utf8");
		return JSON.parse(raw);
	}

	getDependencies(manifest) {
		if (!manifest) return [];
		if (Array.isArray(manifest.dependsOn)) return manifest.dependsOn;
		if (Array.isArray(manifest.dependencies)) return manifest.dependencies;
		return [];
	}

	getDependents(pluginName) {
		const dependents = [];
		for (const [name, state] of this.plugins.entries()) {
			if (name === pluginName) continue;
			const deps = this.getDependencies(state.manifest);
			if (deps.includes(pluginName)) dependents.push(name);
		}
		return dependents;
	}

	buildContext(pluginName, logger) {
		const pluginContext = new PluginContext({
			pluginName,
			client: this.client,
			db: this.db,
			scheduler: this.scheduler,
			hooks: this.hooks,
			pluginManager: this,
			logger,
			config: {
				env: {},
			},
		});

		return pluginContext.build();
	}

	initPluginState(pluginName, manifest) {
		return {
			name: pluginName,
			manifest,
			enabled: true,
			hasCommands: false,
			commandNames: new Set(),
			eventHandlers: [],
			overrides: new Map(),
			hotReloadEligible: true,
			lastError: null,
			path: null,
			entryPath: null,
			source: null,
			packageName: null,
		};
	}

	async loadPlugin(plugin) {
		if (this.plugins.has(plugin.name)) {
			this.logger.warn(`Plugin already loaded: ${plugin.name}`);
			return;
		}

		const logger = createLogger(`plugin:${plugin.name}`);
		const pluginState = this.initPluginState(plugin.name, plugin.manifest);
		pluginState.path = plugin.basePath;
		pluginState.entryPath = plugin.entryPath;
		pluginState.source = plugin.source || "local";
		pluginState.packageName = plugin.packageName || null;

		this.plugins.set(plugin.name, pluginState);

		try {
			// Validate capabilities if declared
			const caps = plugin.manifest?.capabilities;
			if (caps) {
				const capErrors = validateCapabilities(caps);
				if (capErrors.length) {
					pluginState.lastError = `Invalid capabilities: ${capErrors.join(", ")}`;
					this.logger.warn(
						`${plugin.name} has invalid capabilities: ${capErrors.join(", ")}`,
					);
				}
			}

			// Decide: isolated (worker) or direct (main process) loading.
			// Core plugins always load directly. Third-party plugins load in a
			// worker when isolation is enabled and the plugin opts in via
			// "isolation": true in plugin.json.
			const useIsolation =
				this.isolationEnabled &&
				this.workerManager &&
				plugin.source !== "builtin" &&
				plugin.manifest?.isolation !== false; // opt-out with "isolation": false

			if (useIsolation) {
				await this._loadPluginInWorker(plugin, pluginState, caps, logger);
			} else {
				await this._loadPluginDirect(plugin, pluginState, logger);
			}

			const { validateFlags } = require("./permissions");
			const { invalid } = validateFlags(
				plugin.manifest?.discordPermissions || [],
			);
			if (invalid.length) {
				pluginState.lastError = `Unknown discordPermissions: ${invalid.join(", ")}`;
				this.logger.warn(
					`${plugin.name} declares unknown flags: ${invalid.join(", ")}`,
				);
			}

			pluginState.hotReloadEligible =
				!plugin.manifest.requiresRestart && !pluginState.hasCommands;

			await this.hooks.emitHook("onPluginLoad", { pluginName: plugin.name });
			this.logger.info(`Loaded plugin ${plugin.name}`);
		} catch (error) {
			pluginState.enabled = false;
			pluginState.lastError = error.message;
			this.logger.error(`Failed to load plugin ${plugin.name}`, error);
		}
	}

	/**
	 * Load a plugin directly in the main process (legacy / non-isolated path).
	 * @private
	 */
	async _loadPluginDirect(plugin, pluginState, logger) {
		const ctx = this.buildContext(plugin.name, logger);
		const pluginModule = require(plugin.entryPath);
		const loadFn = pluginModule.load || pluginModule.default || pluginModule;

		if (typeof loadFn !== "function") {
			throw new Error("Plugin entry does not export load(ctx)");
		}

		await loadFn(ctx);
	}

	/**
	 * Load a plugin in a worker thread (isolated path).
	 * @private
	 */
	async _loadPluginInWorker(plugin, pluginState, caps, logger) {
		logger.info(`Spawning isolated worker for ${plugin.name}...`);

		try {
			await this.workerManager.spawnWorker(
				plugin.name,
				plugin.entryPath,
				caps || {},
				plugin.manifest?.displayName || plugin.name,
			);

			pluginState.isolated = true;
			logger.info(`Isolated worker ready for ${plugin.name}`);
		} catch (error) {
			pluginState.enabled = false;
			pluginState.lastError = `Worker spawn failed: ${error.message}`;
			logger.error(`Failed to spawn worker for ${plugin.name}:`, error.message);
			throw error;
		}
	}

	async unloadPlugin(pluginName, reason = "manual") {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState || pluginName === "core") return false;

		// If the plugin was running in a worker, terminate it
		if (pluginState.isolated && this.workerManager) {
			await this.workerManager.terminateWorker(pluginName);
		}

		for (const handler of pluginState.eventHandlers) {
			this.client.off(handler.name, handler.wrapper);
		}

		for (const commandName of pluginState.commandNames) {
			this.client.commands.delete(commandName);
		}

		for (const [
			commandName,
			originalExecute,
		] of pluginState.overrides.entries()) {
			const command = this.client.commands.get(commandName);
			if (command) {
				command.execute = originalExecute;
			}
		}

		pluginState.enabled = false;

		await this.hooks.emitHook("onPluginUnload", {
			pluginName,
			reason,
		});

		this.plugins.delete(pluginName);
		return true;
	}

	async reloadPlugin(pluginName, { force = false } = {}) {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState || pluginName === "core") return false;
		// File-watcher reloads respect eligibility; a manual reload forces it.
		if (!force && !pluginState.hotReloadEligible) return false;

		const entryPath = pluginState.entryPath;
		if (!entryPath) return false;

		await this.unloadPlugin(pluginName, "reload");

		// Bust the plugin's whole require-cache subtree so edited command/lib
		// files are re-read, not just the entry module.
		this.bustRequireCache(pluginState.path, entryPath);

		const manifest = pluginState.manifest;
		const plugin = {
			name: pluginName,
			manifest,
			basePath: pluginState.path,
			entryPath,
			source: pluginState.source,
			packageName: pluginState.packageName,
		};

		await this.loadPlugin(plugin);
		return this.plugins.get(pluginName)?.enabled === true;
	}

	bustRequireCache(basePath, entryPath) {
		try {
			delete require.cache[require.resolve(entryPath)];
		} catch {
			/* entry may be gone (uninstall/reload race) */
		}
		if (!basePath) return;
		const prefix = basePath.endsWith(path.sep) ? basePath : basePath + path.sep;
		const nmDir = prefix + "node_modules" + path.sep;
		for (const key of Object.keys(require.cache)) {
			// Re-read the plugin's own source, but leave its node_modules alone —
			// re-requiring a bundled dep (e.g. mongoose) would create a second,
			// disconnected instance and break model registration.
			if (key.startsWith(prefix) && !key.startsWith(nmDir)) {
				delete require.cache[key];
			}
		}
	}

	registerCommand(pluginName, command) {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState) {
			throw new Error(`Plugin not loaded: ${pluginName}`);
		}

		if (!command || !command.data || !command.execute) {
			throw new Error(`Invalid command for plugin ${pluginName}`);
		}

		this.client.commands.set(command.data.name, command);
		pluginState.commandNames.add(command.data.name);
		pluginState.hasCommands = true;
	}

	overrideCommand(pluginName, commandName, overrideFn) {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState) {
			throw new Error(`Plugin not loaded: ${pluginName}`);
		}

		const command = this.client.commands.get(commandName);
		if (!command) {
			throw new Error(`Command not found: ${commandName}`);
		}

		if (!pluginState.overrides.has(commandName)) {
			pluginState.overrides.set(commandName, command.execute);
		}

		if (typeof overrideFn !== "function") {
			throw new Error("overrideCommand expects a function");
		}

		const originalExecute = pluginState.overrides.get(commandName);
		const nextExecute = overrideFn(originalExecute, command);

		if (typeof nextExecute !== "function") {
			throw new Error("overrideCommand must return a function");
		}

		command.execute = nextExecute;
	}

	registerEvent(pluginName, name, handler, options = {}) {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState) {
			throw new Error(`Plugin not loaded: ${pluginName}`);
		}

		const wrapper = (...args) => handler(...args, this.client);

		if (options.once) {
			this.client.once(name, wrapper);
		} else {
			this.client.on(name, wrapper);
		}

		pluginState.eventHandlers.push({ name, wrapper });
	}

	loadCommandsFromDir(dir, pluginName, ctx) {
		if (!fs.existsSync(dir)) return;

		const items = fs.readdirSync(dir, { withFileTypes: true });
		for (const item of items) {
			const itemPath = path.join(dir, item.name);

			if (item.isDirectory()) {
				this.loadCommandsFromDir(itemPath, pluginName, ctx);
				continue;
			}

			if (!item.isFile() || !item.name.endsWith(".js")) continue;

			try {
				const command = require(itemPath);
				if (command && command.data && command.execute) {
					ctx.registerCommand(command);
					this.logger.info(`Loaded command /${command.data.name}`);
				}
			} catch (error) {
				this.logger.error(`Failed to load command ${itemPath}`, error);
			}
		}
	}

	loadEventsFromDir(dir, pluginName, ctx, options = {}) {
		if (!fs.existsSync(dir)) return;

		const excludeFiles = options.excludeFiles || [];

		const items = fs.readdirSync(dir, { withFileTypes: true });
		for (const item of items) {
			const itemPath = path.join(dir, item.name);

			if (item.isDirectory()) {
				this.loadEventsFromDir(itemPath, pluginName, ctx);
				continue;
			}

			if (!item.isFile() || !item.name.endsWith(".js")) continue;
			if (excludeFiles.includes(item.name)) continue;

			try {
				const event = require(itemPath);
				if (event && event.name && event.execute) {
					ctx.registerEvent(event.name, event.execute, { once: event.once });
					this.logger.info(`Loaded event ${event.name}`);
				}
			} catch (error) {
				this.logger.error(`Failed to load event ${itemPath}`, error);
			}
		}
	}

	setupHotReload() {
		for (const [pluginName, pluginState] of this.plugins.entries()) {
			if (pluginName === "core") continue;
			if (!pluginState.hotReloadEligible) continue;
			if (!pluginState.path) continue;
			if (pluginState.watching) continue;

			const watcher = chokidar.watch(pluginState.path, {
				ignoreInitial: true,
			});

			let reloadTimer = null;
			const triggerReload = () => {
				if (reloadTimer) clearTimeout(reloadTimer);
				reloadTimer = setTimeout(async () => {
					this.logger.info(`Reloading plugin ${pluginName}`);
					await this.reloadPlugin(pluginName);
				}, 200);
			};

			watcher.on("add", triggerReload);
			watcher.on("change", triggerReload);
			watcher.on("unlink", triggerReload);

			pluginState.watching = true;
			this.watchers.set(pluginName, watcher);
		}
	}

	getPluginList() {
		return Array.from(this.plugins.values()).map((plugin) => ({
			name: plugin.name,
			displayName: plugin.manifest?.displayName,
			author: plugin.manifest?.author,
			version: plugin.manifest?.version || null,
			description: plugin.manifest?.description,
			requiresRestart: !!plugin.manifest?.requiresRestart,
			category: plugin.manifest?.category || null,
			npmPackage: plugin.manifest?.npmPackage || plugin.packageName || null,
			discordPermissions: plugin.manifest?.discordPermissions || [],
			capabilities: plugin.manifest?.capabilities || null,
			core: plugin.source === "local" || plugin.source === "builtin",
			enabled: plugin.enabled,
			hotReloadEligible: plugin.hotReloadEligible,
			lastError: plugin.lastError,
			overrides: Array.from(plugin.overrides.keys()),
			commands: Array.from(plugin.commandNames),
			hasBrochure: !!(
				plugin.path &&
				fs.existsSync(path.join(plugin.path, "Brochure.md"))
			),
		}));
	}

	getBrochure(pluginName) {
		const plugin = this.plugins.get(pluginName);
		if (!plugin?.path) return null;
		const brochurePath = path.join(plugin.path, "Brochure.md");
		if (!fs.existsSync(brochurePath)) return null;
		return fs.readFileSync(brochurePath, "utf8");
	}
}

module.exports = { PluginManager };
