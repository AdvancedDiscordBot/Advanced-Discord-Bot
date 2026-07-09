const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const { PluginContext } = require("./PluginContext");
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
				env: process.env,
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
			const ctx = this.buildContext(plugin.name, logger);
			const pluginModule = require(plugin.entryPath);
			const loadFn = pluginModule.load || pluginModule.default || pluginModule;

			if (typeof loadFn !== "function") {
				throw new Error("Plugin entry does not export load(ctx)");
			}

			await loadFn(ctx);

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

	async unloadPlugin(pluginName, reason = "manual") {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState || pluginName === "core") return false;

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

	async reloadPlugin(pluginName) {
		const pluginState = this.plugins.get(pluginName);
		if (!pluginState || pluginName === "core") return false;
		if (!pluginState.hotReloadEligible) return false;

		const entryPath = pluginState.entryPath;
		if (!entryPath) return false;

		await this.unloadPlugin(pluginName, "reload");

		delete require.cache[require.resolve(entryPath)];

		const manifest = pluginState.manifest;
		const plugin = {
			name: pluginName,
			manifest,
			basePath: pluginState.path,
			entryPath,
		};

		await this.loadPlugin(plugin);
		return true;
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
			version: plugin.manifest?.version || "0.0.0",
			description: plugin.manifest?.description,
			requiresRestart: !!plugin.manifest?.requiresRestart,
			category: plugin.manifest?.category || null,
			npmPackage: plugin.manifest?.npmPackage || plugin.packageName || null,
			discordPermissions: plugin.manifest?.discordPermissions || [],
			core: plugin.source === "local" || plugin.source === "builtin",
			enabled: plugin.enabled,
			hotReloadEligible: plugin.hotReloadEligible,
			lastError: plugin.lastError,
			overrides: Array.from(plugin.overrides.keys()),
			commands: Array.from(plugin.commandNames),
			hasBrochure: !!(plugin.path && fs.existsSync(path.join(plugin.path, "Brochure.md"))),
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
