const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const { PluginContext } = require("./PluginContext");
const { validateCapabilities } = require("./capabilities");
const { createLogger } = require("./logger");
const { randomUUID } = require("crypto");
const { serializeValue } = require("./rpc/schema-serialize");
const DISCORD_PRIVATE_KEYS = new Set(["client", "token", "webhook", "authorization"]);

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
			commandTimeoutMs: config.commandTimeoutMs ?? 15000,
			commandCollection: config.commandCollection === true,
		};

		this.logger = createLogger("PluginManager");
		this.plugins = new Map();
		this._commandOwners = new WeakMap();
		this.watchers = new Map();
		this._loads = new Set();
		this._shuttingDown = false;
		this._shutdownPromise = null;

		// Per-guild plugin enablement gate. Enabled (guildId,pluginName) pairs are
		// held as one Set, rebuilt from a single query on a short TTL and eagerly
		// after a toggle, so the runtime chokepoints (event forwarding, hooks,
		// commands) can read the gate synchronously on hot paths. An empty index
		// means "everything gateable is off" — the safe default until the first
		// refresh lands.
		this._enableIndex = new Set(); // "guildId:pluginName"
		this._enableIndexAt = 0;
		this._enableIndexTtl = 60 * 1000;
		this._enableIndexRefreshing = false;

		// Core/platform version, checked against each plugin's engines.core range.
		// Read once from package.json; falls back to "0.0.0" if unreadable.
		this.coreVersion = this._readCoreVersion();

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

		// Register RPC handlers for plugin.registerCommand / registerEvent
		this._registerIsolationRpcHandlers();
		this._onWorkerUnregistered = (pluginId) => this.clearPluginRegistrations(pluginId);
		this.broker.on("plugin:unregistered", this._onWorkerUnregistered);

		this.isolationEnabled = true;
		this.logger.info("Plugin isolation enabled (worker_threads)");
	}

	/**
	 * Subscribe only to events a worker actually registered, and retain teardown
	 * ownership through the normal manager event registry.
	 */
	_forwardDiscordEvents(pluginId, eventName) {
		const { Events } = require("discord.js");
		// discord.js 14 still supports the deprecated "ready" event used by shipped plugins.
		if (eventName !== "ready" && !Object.values(Events).includes(eventName)) throw new Error(`Unknown Discord event: ${eventName}`);
		const state = this.plugins.get(pluginId);
		if (state.eventHandlers.some((handler) => handler.name === eventName)) return;
		this.registerEvent(pluginId, eventName, (...args) => {
			args.pop(); // registerEvent appends the raw client; never send it to a worker.
			const payload = { args: this._serializeDiscordEvent(eventName, args) };
			if (eventName === "interactionCreate") {
				const interaction = args[0];
				const ownsAutocomplete = interaction.type === 4 && state.commandNames.has(interaction.commandName);
				if (ownsAutocomplete || this.broker.interactionOwner(interaction) === pluginId) {
					payload.args[0]._handle = this.broker.bindInteraction(pluginId, interaction);
				}
			}
			this.workerManager.sendEvent(pluginId, `event:${eventName}`, payload);
		});
	}

	// ── Per-guild plugin enablement gate ───────────────────────────────────
	// Installed (npm) plugins are OFF by default for every guild until that
	// guild's admin enables them. Core/builtin/in-repo plugins are platform
	// infrastructure and always on; raw-client plugins load un-isolated in the
	// main process, so a per-guild gate on them would be advisory only — they
	// are treated as non-disableable (the API refuses to toggle them).

	/** Whether a plugin's activity is subject to the per-guild enable flag. */
	isGuildGateable(pluginName) {
		const state = this.plugins.get(pluginName);
		if (!state) return false;
		if (state.source !== "package") return false;
		const sys = state.manifest?.capabilities?.system || [];
		if (sys.includes("raw-client")) return false;
		return true;
	}

	/** Synchronous gate read used by the hot event/hook/command paths. */
	isEnabledForGuild(guildId, pluginName) {
		if (!this.isGuildGateable(pluginName)) return true;
		if (!guildId) return true;
		this._maybeRefreshEnableIndex();
		return this._enableIndex.has(`${guildId}:${pluginName}`);
	}

	/** First guild id found across an event's arguments, or null. */
	_eventGuildId(args) {
		for (const arg of args) {
			if (!arg || typeof arg !== "object") continue;
			if (typeof arg.guildId === "string") return arg.guildId;
			if (arg.guild && typeof arg.guild.id === "string") return arg.guild.id;
		}
		return null;
	}

	_maybeRefreshEnableIndex() {
		if (Date.now() - this._enableIndexAt < this._enableIndexTtl) return;
		if (this._enableIndexRefreshing) return;
		this._enableIndexRefreshing = true;
		// Fire and forget: this call reads the current snapshot; the refresh lands
		// for the next one. Staleness is bounded by the TTL.
		this.refreshEnableIndex().finally(() => {
			this._enableIndexRefreshing = false;
		});
	}

	/**
	 * Reflect a single toggle in the index immediately, so the change takes
	 * effect without waiting for the next TTL refresh. The API calls this right
	 * after persisting the enable/disable.
	 */
	setEnabledForGuild(guildId, pluginName, enabled) {
		const key = `${guildId}:${pluginName}`;
		if (enabled) this._enableIndex.add(key);
		else this._enableIndex.delete(key);
	}

	async refreshEnableIndex({ strict = false } = {}) {
		try {
			const rows = await this.db.getAllEnabledPluginRows();
			const next = new Set();
			for (const row of rows) next.add(`${row.guildId}:${row.pluginName}`);
			this._enableIndex = next;
			this._enableIndexAt = Date.now();
		} catch (err) {
			this.logger.warn(`Failed to refresh plugin enable index: ${err.message}`);
			// Keep the last good snapshot but bump the clock so a down DB isn't
			// hammered on every event.
			this._enableIndexAt = Date.now();
			if (strict) throw err;
		}
	}

	/**
	 * Serialize a Discord event's arguments into a plain, IPC-safe object.
	 * @private
	 */
	_serializeDiscordEvent(eventName, args) {
		return args.map((arg) => eventName === "interactionCreate"
			? this._serializeInteraction(arg)
			: serializeValue(arg, DISCORD_PRIVATE_KEYS));
	}

	/**
	 * Register RPC handlers that let worker plugins register commands and events
	 * back into the Core process.
	 * @private
	 */
	_registerIsolationRpcHandlers() {
		// Intercept in the broker's handleRequest — we patch the execute method
		// on the broker to add our custom handlers.
		const origHandleRequest = this.broker.handleRequest.bind(this.broker);
		const self = this;

		this.broker.handleRequest = async function (pluginId, request) {
			if (self.config.commandCollection && ["scheduler.schedule", "scheduler.cancel"].includes(request.method)
				&& this.hasCapability(pluginId, "scheduler:cron") && !this.isSuspended(pluginId)) {
				if (request.method === "scheduler.schedule" && !require("node-cron").validate(request.params.expression)) {
					return { id: request.id, ok: false, error: "Invalid cron expression" };
				}
				return { id: request.id, ok: true, result: { taskId: `collection:${pluginId}:${request.params.name || "task"}` } };
			}
			if (!["plugin.registerCommand", "plugin.registerEvent", "plugin.defineModel"].includes(request.method)) {
				return origHandleRequest(pluginId, request);
			}
			if (!this.pluginCapabilities.has(pluginId) || this.isSuspended(pluginId) || !self.plugins.get(pluginId)?.enabled) {
				return { id: request.id, ok: false, error: "Plugin is not available for registration" };
			}
			try {
				if (request.method === "plugin.registerCommand") {
					const { command } = request.params;
					if (!command?.data) throw new Error("Invalid command");
					const proxy = {
						data: command.data,
						cooldown: command.cooldown,
						guildIds: command.guildIds,
						guildData: command.guildData,
						permissions: command.permissions,
						execute: (interaction) => self._executeWorkerInteraction(pluginId, command.data.name, "execute", interaction),
					};
					if (command.hasAutocomplete) {
						proxy.autocomplete = (interaction) => self._executeWorkerInteraction(pluginId, command.data.name, "autocomplete", interaction);
					}
					self.registerCommand(pluginId, proxy);
				}

				if (request.method === "plugin.registerEvent") {
					self._forwardDiscordEvents(pluginId, request.params.name);
				}

				if (request.method === "plugin.defineModel") {
					const { modelName, schema } = request.params;
					if (!this.hasCapability(pluginId, "storage:own-collection")) throw new Error("Missing capability: storage:own-collection");
					self.broker.registerModel(pluginId, modelName, schema);
				}
				return { id: request.id, ok: true, result: { registered: true } };
			} catch (error) {
				return { id: request.id, ok: false, error: error.message };
			}
		};
	}

	_executeWorkerInteraction(pluginId, commandName, action, interaction) {
		const entry = this.workerManager?.workers.get(pluginId);
		const state = this.plugins.get(pluginId);
		if (!entry?.ready || !state?.enabled || !state.commandNames.has(commandName) || this.broker.isSuspended(pluginId)) {
			return Promise.reject(new Error("Plugin is not available"));
		}
		const handle = this.broker.bindInteraction(pluginId, interaction);
		const callId = randomUUID();
		return new Promise((resolve, reject) => {
			let finished = false;
			const finish = (error) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				entry.worker.removeListener("message", onMessage);
				entry.worker.removeListener("exit", onExit);
				entry.worker.removeListener("error", onError);
				state.pendingExecutions.delete(finish);
				if (error) {
					this.broker.releaseInteraction(handle);
					reject(error);
				} else resolve();
			};
			const onMessage = (msg) => {
				if (msg.type === "rpc:response" && msg.id === callId) finish(msg.ok ? null : new Error(msg.error || "Command failed"));
			};
			const onExit = () => finish(new Error("Plugin worker stopped"));
			const onError = (error) => finish(error);
			const timer = setTimeout(() => finish(new Error("Command execution timed out")), this.config.commandTimeoutMs);
			state.pendingExecutions.add(finish);
			entry.worker.on("message", onMessage);
			entry.worker.once("exit", onExit);
			entry.worker.once("error", onError);
			try {
				entry.worker.postMessage({
					type: "rpc:event", event: "command:execute",
					payload: { callId, commandName, action, interaction: { ...this._serializeInteraction(interaction), _handle: handle } },
				});
			} catch (error) { finish(error); }
		});
	}

	/**
	 * Serialize a Discord interaction for IPC transfer.
	 * @private
	 */
	_serializeInteraction(interaction) {
		const pick = (value, keys) => value ? Object.fromEntries(keys.map((key) => [key, value[key]])) : null;
		const user = (value) => pick(value, ["id", "tag", "username", "globalName", "discriminator", "bot", "avatar"]);
		const member = (value, id) => value ? {
			id: value.id || value.user?.id || id,
			user: user(value.user),
			guildId: value.guild?.id || interaction.guildId,
			nickname: value.nickname || value.nick,
			roles: Array.isArray(value.roles) ? value.roles : Array.from(value.roles?.cache?.keys() || []),
			permissions: value.permissions?.bitfield ?? value.permissions,
		} : null;
		const resolved = interaction.options?.resolved;
		const getResolved = (key, id) => resolved?.[key]?.get?.(id) || resolved?.[key]?.[id];
		const options = (items) => (items || []).map((option) => {
			const value = pick(option, ["name", "type", "value", "focused"]);
			if (option.options) value.options = options(option.options);
			const optionUser = option.user || getResolved("users", option.value);
			const optionRole = option.role || getResolved("roles", option.value);
			if (optionUser || option.type === 6) value.user = user(optionUser) || { id: option.value };
			value.member = member(option.member || getResolved("members", option.value), option.value);
			if (optionRole || option.type === 8) value.role = pick(optionRole, ["id", "name", "color", "position"]) || { id: option.value };
			if (option.type === 7) value.channel = pick(option.channel || getResolved("channels", option.value), ["id", "name", "type", "guildId"]) || { id: option.value };
			if (option.type === 11) value.attachment = pick(option.attachment || getResolved("attachments", option.value), ["id", "name", "filename", "url", "proxyURL", "size", "contentType"]) || { id: option.value };
			return value;
		});
		return serializeValue({
			id: interaction.id,
			type: interaction.type,
			commandName: interaction.commandName,
			commandType: interaction.commandType,
			customId: interaction.customId,
			componentType: interaction.componentType,
			values: interaction.values,
			options: options(interaction.options?.data),
			guildId: interaction.guildId,
			channelId: interaction.channelId,
			guild: pick(interaction.guild, ["id", "name"]),
			channel: pick(interaction.channel, ["id", "name", "type"]),
			user: user(interaction.user),
			member: member(interaction.member, interaction.user?.id),
			message: pick(interaction.message, ["id", "content", "embeds", "components", "attachments"]),
			fields: Array.from(interaction.fields?.fields?.values() || []).map((field) => pick(field, ["customId", "type", "value"])),
			deferred: !!interaction.deferred,
			replied: !!interaction.replied,
			ephemeral: interaction.ephemeral ?? null,
			responded: !!interaction.responded,
		}, DISCORD_PRIVATE_KEYS);
	}

	async loadAll() {
		if (this._shuttingDown) throw new Error("PluginManager is shutting down");
		await this.loadCore();
		if (this._shuttingDown) return;

		const discovered = this.discoverPlugins();
		const ordered = this.sortByDependencies(discovered);
		if (this.config.commandCollection && discovered.some((plugin) => plugin.disabled)) {
			throw new Error("Cannot collect commands with missing plugin dependencies");
		}

		for (const plugin of ordered) {
			if (this._shuttingDown) return;
			await this.loadPlugin(plugin);
			if (this.config.commandCollection && this.plugins.get(plugin.name)?.lastError) {
				throw new Error(`Command collection failed for ${plugin.name}: ${this.plugins.get(plugin.name).lastError}`);
			}
		}
		if (this._shuttingDown) return;

		// Warm the enable gate before we start delivering events, so gateable
		// plugins don't briefly lose their enabled guilds at startup.
		await this.refreshEnableIndex({ strict: this.config.commandCollection });

		this.setupHotReload();
	}

	async loadCore() {
		if (this._shuttingDown) throw new Error("PluginManager is shutting down");
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
		let finishLoad;
		const loading = new Promise((resolve) => { finishLoad = resolve; });
		this._loads.add(loading);
		try {
			const ctx = this.buildContext(pluginName, logger);
			this.loadCommandsFromDir(path.join(process.cwd(), "commands"), pluginName, ctx);
			if (!this.config.commandCollection) {
				this.loadEventsFromDir(path.join(process.cwd(), "events"), pluginName, ctx, {
					excludeFiles: ["helpInteraction.js", "modalCreate.js"],
				});
			}
			pluginState.loaded = true;
			if (!this.config.commandCollection) await this.hooks.emitHook("onPluginLoad", { pluginName });
		} finally {
			this._loads.delete(loading);
			finishLoad();
		}
	}

	discoverPlugins() {
		const discovered = [];
		const directories = (dir) => {
			if (!fs.existsSync(dir)) return [];
			return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => {
				if (entry.isDirectory()) return true;
				if (!entry.isSymbolicLink()) return false;
				try { return fs.statSync(path.join(dir, entry.name)).isDirectory(); }
				catch { return false; } // Ignore broken npm links.
			});
		};
		const discover = (pluginPath, source, packageName) => {
			const manifestPath = path.join(pluginPath, "plugin.json");
			if (!fs.existsSync(manifestPath)) return;
			try {
				const manifest = this.readManifest(manifestPath);
				if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
					throw new Error("Manifest must be an object");
				}
				discovered.push({
					name: manifest.name || packageName || path.basename(pluginPath),
					manifest,
					basePath: pluginPath,
					entryPath: path.join(pluginPath, manifest.main || "index.js"),
					source,
					...(packageName ? { packageName } : {}),
				});
			} catch (error) {
				this.logger.warn(`Skipping plugin at ${pluginPath}: ${error.message}`);
				if (this.config.commandCollection) throw error;
			}
		};

		for (const item of directories(this.config.pluginsDir)) {
			discover(path.join(this.config.pluginsDir, item.name), "local");
		}
		for (const pkg of directories(this.config.nodeModulesDir)) {
			const packagePath = path.join(this.config.nodeModulesDir, pkg.name);
			if (pkg.name.startsWith("@")) {
				for (const scopedPkg of directories(packagePath)) {
					if (scopedPkg.name.startsWith("adb-plugin-")) {
						discover(path.join(packagePath, scopedPkg.name), "package", `${pkg.name}/${scopedPkg.name}`);
					}
				}
			} else if (pkg.name.startsWith("adb-plugin-")) {
				discover(packagePath, "package", pkg.name);
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
		const deps = new Set();
		if (Array.isArray(manifest.dependsOn)) manifest.dependsOn.forEach((d) => deps.add(d));
		if (Array.isArray(manifest.dependencies)) manifest.dependencies.forEach((d) => deps.add(d));
		// engines.plugins names are also load-order dependencies: a plugin that
		// requires administration >=X must load after administration.
		if (manifest.engines && manifest.engines.plugins && typeof manifest.engines.plugins === "object") {
			for (const name of Object.keys(manifest.engines.plugins)) deps.add(name);
		}
		return Array.from(deps);
	}

	/**
	 * Read the core/platform version from package.json (once, at construction).
	 * @private
	 */
	_readCoreVersion() {
		try {
			const pkg = require(path.join(__dirname, "..", "package.json"));
			return pkg.version || "0.0.0";
		} catch {
			return "0.0.0";
		}
	}

	/**
	 * Check a plugin's `engines` constraints (core version + sibling plugin
	 * versions) against what's actually running. Returns an array of human
	 * error strings — empty means all constraints satisfied. A non-empty result
	 * means the plugin must NOT load.
	 *
	 * engines.plugins names must already be present in this.plugins (guaranteed
	 * by the dependency-ordered load), so the dependency's version is known.
	 */
	checkEngines(manifest) {
		const semver = require("semver");
		const errors = [];
		const engines = manifest && manifest.engines;
		if (!engines || typeof engines !== "object") return errors;

		if (engines.core) {
			if (!semver.satisfies(this.coreVersion, engines.core, { includePrerelease: true })) {
				errors.push(
					`requires core ${engines.core}, but running core is ${this.coreVersion}`,
				);
			}
		}

		if (engines.plugins && typeof engines.plugins === "object") {
			for (const [depName, range] of Object.entries(engines.plugins)) {
				const dep = this.plugins.get(depName);
				if (!dep || dep.enabled === false) {
					errors.push(
						`requires plugin "${depName}" ${range}, but it is not loaded`,
					);
					continue;
				}
				const depVersion = dep.manifest?.version || "0.0.0";
				if (!semver.satisfies(depVersion, range, { includePrerelease: true })) {
					errors.push(
						`requires plugin "${depName}" ${range}, but loaded version is ${depVersion}`,
					);
				}
			}
		}

		return errors;
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

	buildContext(pluginName, logger, grantedEnv = {}) {
		const pluginContext = new PluginContext({
			pluginName,
			client: this.client,
			db: this.db,
			scheduler: this.scheduler,
			hooks: this.hooks,
			pluginManager: this,
			logger,
			config: {
				env: grantedEnv,
				commandCollection: this.config.commandCollection,
			},
		});

		return pluginContext.build();
	}

	/**
	 * Compute the environment a plugin is allowed to see, from its declared
	 * `system` escalation capabilities. Owner-approved at install time.
	 *   - raw-client: full trust → the real process.env
	 *   - env: process.env minus the most sensitive infra secrets
	 *   - bot-token: adds DISCORD_TOKEN specifically
	 * A plugin with no `system` capability gets `{}` (the default).
	 */
	grantedEnv(manifest) {
		const sys = manifest?.capabilities?.system || [];
		if (!sys.length) return {};
		if (sys.includes("raw-client")) return { ...process.env };

		const env = {};
		if (sys.includes("env")) {
			const DENY = new Set([
				"DISCORD_TOKEN",
				"MONGODB_URI",
				"SESSION_SECRET",
				"DISCORD_OAUTH_CLIENT_SECRET",
			]);
			for (const [k, v] of Object.entries(process.env)) {
				if (!DENY.has(k)) env[k] = v;
			}
		}
		if (sys.includes("bot-token")) env.DISCORD_TOKEN = process.env.DISCORD_TOKEN;
		return env;
	}

	initPluginState(pluginName, manifest) {
		return {
			name: pluginName,
			manifest,
			enabled: true,
			loaded: false,
			hasCommands: false,
			commandNames: new Set(),
			eventHandlers: [],
			hookUnsubscribers: new Set(),
			pendingExecutions: new Set(),
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
		if (this._shuttingDown) throw new Error("PluginManager is shutting down");
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
		let finishLoad;
		const loading = new Promise((resolve) => { finishLoad = resolve; });
		this._loads.add(loading);

		try {
			// Engine constraints: core version + sibling plugin versions.
			// Unmet = the plugin refuses to load (surfaced via lastError), it
			// does not crash the bot.
			const engineErrors = this.checkEngines(plugin.manifest);
			if (engineErrors.length) {
				throw new Error(`Engine check failed: ${engineErrors.join("; ")}`);
			}

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
			//
			// Only npm-installed plugins (source: "package") are untrusted
			// third-party code and MUST run sandboxed in a worker thread — this
			// is enforced, not opt-in, so an installed plugin cannot escape the
			// broker by omitting a manifest flag.
			//
			// The one sanctioned escape hatch: a plugin that declares the
			// `system:raw-client` escalation capability runs in DIRECT mode with
			// full access. That capability is owner-approved at install time via
			// the high-risk disclosure — some plugins (voice, raid lockdown,
			// cross-plugin introspection) genuinely can't work over the RPC
			// surface, and this makes that trust explicit rather than a silent
			// bypass.
			//
			// In-repo plugins (source: "local", e.g. the administration
			// dashboard) and the internal "builtin" core always load directly.
			const wantsRawClient = (caps?.system || []).includes("raw-client");
			const useIsolation =
				this.isolationEnabled &&
				this.workerManager &&
				plugin.source === "package" &&
				!wantsRawClient;

			if (useIsolation) {
				await this._loadPluginInWorker(plugin, pluginState, caps, logger);
			} else {
				if (wantsRawClient && plugin.source === "package") {
					logger.warn(
						`${plugin.name} runs UN-ISOLATED (system:raw-client) — owner-approved full access`,
					);
				}
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

			pluginState.loaded = true;
			if (!this.config.commandCollection) await this.hooks.emitHook("onPluginLoad", { pluginName: plugin.name });
			this.logger.info(`Loaded plugin ${plugin.name}`);
		} catch (error) {
			pluginState.enabled = false;
			pluginState.lastError = error.message;
			await this._teardownPlugin(plugin.name, pluginState, "load-failed");
			this.logger.error(`Failed to load plugin ${plugin.name}`, error);
		} finally {
			this._loads.delete(loading);
			finishLoad();
		}
	}

	/**
	 * Load a plugin directly in the main process (legacy / non-isolated path).
	 * @private
	 */
	async _loadPluginDirect(plugin, pluginState, logger) {
		const ctx = this.buildContext(
			plugin.name,
			logger,
			this.grantedEnv(plugin.manifest),
		);
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

		// Derive the network.outbound host allowlist from the normalized v2
		// manifest. The broker enforces outbound requests against this list per
		// call; an empty list means "declared network capability but no hosts",
		// which the broker treats as "reach nothing".
		let networkAllowlist = [];
		try {
			const { normalize } = require("./manifest-schema");
			networkAllowlist = normalize(plugin.manifest || {}).permissions.network.outbound || [];
		} catch (e) {
			logger.warn(`Could not derive network allowlist for ${plugin.name}: ${e.message}`);
		}

		try {
			await this.workerManager.spawnWorker(
				plugin.name,
				plugin.entryPath,
				caps || {},
				plugin.manifest?.displayName || plugin.name,
				{ networkAllowlist, grantedEnv: this.grantedEnv(plugin.manifest) },
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

	/** Remove runtime registrations without deleting state; also used on worker teardown. */
	clearPluginRegistrations(pluginName) {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState) return;
		for (const finish of pluginState.pendingExecutions || []) {
			finish(new Error("Plugin worker stopped"));
		}
		this.broker?.releasePluginInteractions(pluginName);
		for (const unsubscribe of pluginState.hookUnsubscribers || []) {
			try { unsubscribe(); }
			catch (error) { this.logger.warn(`Hook teardown failed for ${pluginName}: ${error.message}`); }
		}
		pluginState.hookUnsubscribers?.clear();

		for (const handler of pluginState.eventHandlers) {
			this.client.off(handler.name, handler.wrapper);
		}

		for (const commandName of pluginState.commandNames) {
			const command = this.client.commands.get(commandName);
			if (command && this._commandOwners.get(command) === pluginState) this.client.commands.delete(commandName);
		}
		if (pluginName === "core") this.client.runtimeCommandDispatch = false;

		for (const [
			commandName,
			originalExecute,
		] of pluginState.overrides.entries()) {
			const command = this.client.commands.get(commandName);
			if (command) {
				command.execute = originalExecute;
			}
		}
		pluginState.eventHandlers.length = 0;
		pluginState.commandNames.clear();
		pluginState.overrides.clear();
		pluginState.hasCommands = false;
	}

	_teardownPlugin(pluginName, pluginState, reason) {
		if (pluginState.unloading) return pluginState.unloading;
		pluginState.enabled = false;
		pluginState.loaded = false;
		clearTimeout(pluginState.reloadTimer);
		pluginState.unloading = Promise.resolve().then(async () => {
			try {
				await this.hooks.emitHook("onPluginUnload", { pluginName, reason });
			} finally {
				this.clearPluginRegistrations(pluginName);
				const watcher = this.watchers.get(pluginName);
				this.watchers.delete(pluginName);
				pluginState.watching = false;
				try {
					if (watcher) await watcher.close();
				} finally {
					if (this.workerManager?.workers.has(pluginName)) await this.workerManager.terminateWorker(pluginName);
				}
			}
		});
		return pluginState.unloading;
	}

	async unloadPlugin(pluginName, reason = "manual") {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState || (pluginName === "core" && !this._shuttingDown)) return false;

		try {
			await this._teardownPlugin(pluginName, pluginState, reason);
		} finally {
			if (this.plugins.get(pluginName) === pluginState) this.plugins.delete(pluginName);
		}
		return true;
	}

	/** Stop plugin-owned resources only; the caller still owns DB, scheduler and client shutdown. */
	shutdown(reason = "shutdown") {
		if (this._shutdownPromise) return this._shutdownPromise;
		this._shuttingDown = true;
		for (const state of this.plugins.values()) clearTimeout(state.reloadTimer);
		this._shutdownPromise = (async () => {
			const errors = [];
			for (const [name, entry] of this.workerManager?.workers || []) {
				if (!entry.ready) {
					try { await this.workerManager.terminateWorker(name); }
					catch (error) { errors.push(error); }
				}
			}
			await Promise.allSettled([...this._loads]);
			for (const name of [...this.plugins.keys()].reverse()) {
				try { await this.unloadPlugin(name, reason); }
				catch (error) { errors.push(error); }
			}
			try {
				if (this.workerManager) await this.workerManager.shutdown();
			} catch (error) { errors.push(error); }
			if (this.broker && this._onWorkerUnregistered) this.broker.off("plugin:unregistered", this._onWorkerUnregistered);
			if (errors.length) throw new AggregateError(errors, "Plugin shutdown failed");
		})();
		return this._shutdownPromise;
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
		if (!this._shuttingDown) this.setupHotReload();
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

	/** Resolve only the exact, currently loaded registration, never a stale name reservation. */
	getCommandOwner(command) {
		if (!command || this.client.commands.get(command.data?.name) !== command) return null;
		const state = this._commandOwners.get(command);
		return state?.loaded && this.plugins.get(state.name) === state && state.commandNames.has(command.data.name)
			? state.name : null;
	}

	registerCommand(pluginName, command) {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState || !pluginState.enabled || this._shuttingDown) {
			throw new Error(`Plugin not loaded: ${pluginName}`);
		}

		if (!command?.data || typeof command.data.name !== "string" || !command.data.name || typeof command.execute !== "function") {
			throw new Error(`Invalid command for plugin ${pluginName}`);
		}
		for (const [owner, state] of this.plugins) {
			if (!this.client.commands.has(command.data.name)) {
				state.commandNames.delete(command.data.name);
				state.hasCommands = state.commandNames.size > 0;
			}
			if (owner !== pluginName && state.commandNames.has(command.data.name)) {
				throw new Error(`Command ${command.data.name} is already owned by ${owner}`);
			}
		}

		this.client.commands.set(command.data.name, command);
		this._commandOwners.set(command, pluginState);
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
		if (!pluginState || !pluginState.enabled || this._shuttingDown) {
			throw new Error(`Plugin not loaded: ${pluginName}`);
		}
		if (this.config.commandCollection) return;

		// Gate direct-mode (un-isolated) events behind the per-guild enable flag.
		// Isolated package plugins are gated at broadcastEvent; this covers the
		// PLUGIN_ISOLATION=false fallback where the same package plugins load
		// directly. Non-gateable plugins (core/builtin/in-repo, raw-client) run
		// unconditionally.
		const gateable = this.isGuildGateable(pluginName);
		const wrapper = (...args) => {
			if (this._shuttingDown || !pluginState.enabled) return;
			if (gateable) {
				const guildId = this._eventGuildId(args);
				if (guildId && !this.isEnabledForGuild(guildId, pluginName)) return;
			}
			try {
				return Promise.resolve(handler(...args, this.client)).catch((error) => {
					this.logger.error(`Event ${name} failed in ${pluginName}:`, error);
				});
			} catch (error) {
				this.logger.error(`Event ${name} failed in ${pluginName}:`, error);
			}
		};

		if (options.once) {
			this.client.once(name, wrapper);
		} else {
			this.client.on(name, wrapper);
		}

		pluginState.eventHandlers.push({ name, wrapper });
		if (pluginName === "core" && name === "interactionCreate") this.client.runtimeCommandDispatch = true;
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
				if (this.config.commandCollection) throw error;
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
		if (this._shuttingDown || this.config.commandCollection) return;
		for (const [pluginName, pluginState] of this.plugins.entries()) {
			if (pluginName === "core") continue;
			if (!pluginState.enabled) continue;
			if (!pluginState.hotReloadEligible) continue;
			if (!pluginState.path) continue;
			if (pluginState.watching) continue;

			const watcher = chokidar.watch(pluginState.path, {
				ignoreInitial: true,
			});

			const triggerReload = () => {
				if (this._shuttingDown || this.plugins.get(pluginName) !== pluginState || !pluginState.enabled) return;
				clearTimeout(pluginState.reloadTimer);
				pluginState.reloadTimer = setTimeout(async () => {
					pluginState.reloadTimer = null;
					if (this._shuttingDown) return;
					this.logger.info(`Reloading plugin ${pluginName}`);
					try { await this.reloadPlugin(pluginName); }
					catch (error) { this.logger.warn(`Reload failed for ${pluginName}: ${error.message}`); }
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
			version: plugin.manifest?.version || null,
			engines: plugin.manifest?.engines || null,
			settingsSchema: plugin.manifest?.settings?.schema || [],
			commandPermissions: plugin.manifest?.settings?.commandPermissions === true,
			webUi: plugin.manifest?.webUi?.port
				? {
					port: plugin.manifest.webUi.port,
					label: plugin.manifest.webUi.label || null,
					icon: plugin.manifest.webUi.icon || null,
					memberPages: plugin.manifest.webUi.memberPages || [],
				}
				: null,
			hasBrochure: !!(
				plugin.path &&
				fs.existsSync(path.join(plugin.path, "Brochure.md"))
			),
		}));
	}

	/**
	 * Get the raw parsed manifest for a loaded plugin (or null if unknown).
	 * Used by the risk-disclosure endpoints, which need the full v2 permissions
	 * block, not the trimmed shape getPluginList() returns.
	 */
	getManifest(pluginName) {
		const plugin = this.plugins.get(pluginName);
		return plugin?.manifest || null;
	}

	/**
	 * Member pages available in a specific guild — only plugins that are active
	 * for that guild and declare webUi.memberPages contribute entries.
	 *
	 * Two kinds of page:
	 *   - rendered (declares source + view): the platform reads the plugin's
	 *     model and renders it with the built-in member-view library. No port
	 *     needed. The entry carries `rendered:true` plus the view/source spec.
	 *   - iframe (custom): the entry carries the plugin's `port` so the portal
	 *     can proxy to /plugin-ui/<name><path>.
	 *
	 * @param {string} guildId
	 * @returns {Array<{pluginName:string, port:number|null, path:string, label:string, icon:string|null, rendered:boolean, view?:object, source?:object}>}
	 */
	getMemberPages(guildId) {
		const pages = [];
		for (const [name, plugin] of this.plugins) {
			if (!this.isEnabledForGuild(guildId, name)) continue;
			const webUi = plugin.manifest?.webUi;
			if (!webUi) continue;
			const memberPages = webUi.memberPages;
			if (!Array.isArray(memberPages) || memberPages.length === 0) continue;
			for (const page of memberPages) {
				if (!page?.path || !page?.label) continue;
				// A page is platform-rendered when it declares both a data source
				// (a plugin model) and a view. Those need no hosted port. Custom
				// iframe pages do — skip them if the plugin declared no port.
				const rendered = !!(page.rendered || (page.source?.model && page.view?.type));
				if (!rendered && !webUi.port) continue;
				const entry = {
					pluginName: name,
					port: webUi.port || null,
					path: page.path,
					label: page.label,
					icon: page.icon || null,
					rendered,
				};
				if (rendered) {
					entry.view = page.view || null;
					entry.source = page.source || null;
				}
				pages.push(entry);
			}
		}
		return pages;
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
