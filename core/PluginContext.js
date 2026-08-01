const mongoose = require("mongoose");

class PluginContext {
	constructor({
		pluginName,
		client,
		db,
		scheduler,
		hooks,
		pluginManager,
		logger,
		config,
	}) {
		this.pluginName = pluginName;
		this.client = client;
		this.db = db;
		this.scheduler = scheduler;
		this.hooks = hooks;
		this.pluginManager = pluginManager;
		this.logger = logger;
		this.config = config;
	}

	build() {
		const pluginName = this.pluginName;

		const ctx = {
			client: this.client,
			db: this.db,
			scheduler: this.scheduler,
			commands: this.client.commands,
			registerCommand: (command) =>
				this.pluginManager.registerCommand(pluginName, command),
			overrideCommand: (name, overrideFn) =>
				this.pluginManager.overrideCommand(pluginName, name, overrideFn),
			registerEvent: (name, handler, options = {}) =>
				this.pluginManager.registerEvent(
					pluginName,
					name,
					handler,
					options,
				),
			defineModel: (modelName, schema) => this.defineModel(modelName, schema),
			// Pre-declared so plugins can assign ctx.models = {...} without
			// hitting "Cannot add property to non-extensible object".
			// We make it writable while keeping everything else read-only
			// to match the safety guarantees of the original Object.freeze().
			models: null,
			hooks: this.buildHooksFacade(),
			config: this.config,
			logger: this.logger,
		};

		// ── Deprecation proxies for ctx.client and ctx.db ──────────────
		// These warn when plugins access the raw client/db directly.
		// In the isolation architecture, these will be replaced by RPC proxies.
		// For now, we wrap them with Proxy-based deprecation warnings so we
		// can observe which plugins actually touch them before removal.

		if (ctx.client) {
			ctx.client = new Proxy(ctx.client, {
				get(target, prop) {
					// Passthrough all symbols without warning (inspection, iteration, etc.)
					if (typeof prop === "symbol") {
						return target[prop];
					}
					console.warn(
						`[DEPRECATION] Plugin "${pluginName}" accessed ctx.client.${String(prop)} directly. ` +
							"This will be removed in the plugin isolation upgrade. " +
							"Use ctx.registerEvent() / ctx.registerCommand() instead.",
					);
					return target[prop];
				},
			});
		}

		if (ctx.db) {
			ctx.db = new Proxy(ctx.db, {
				get(target, prop) {
					// Passthrough all symbols without warning (inspection, iteration, etc.)
					if (typeof prop === "symbol") {
						return target[prop];
					}
					console.warn(
						`[DEPRECATION] Plugin "${pluginName}" accessed ctx.db.${String(prop)} directly. ` +
							"This will be removed in the plugin isolation upgrade. " +
							"Use ctx.db.* RPC methods instead.",
					);
					return target[prop];
				},
			});
		}

		// Make all properties read-only except 'models'
		Object.keys(ctx).forEach(function (k) {
			if (k !== "models") {
				Object.defineProperty(ctx, k, {
					writable: false,
					configurable: false,
				});
			} else {
				Object.defineProperty(ctx, k, {
					writable: true,
					configurable: false,
				});
			}
		});
		// Prevent adding new properties (non-extensible)
		Object.preventExtensions(ctx);
		return ctx;
	}

	/**
	 * Wrap the shared HookBus so a plugin's hook handlers are gated by the
	 * per-guild enable flag. When a hook payload carries a guildId and this
	 * plugin isn't enabled for that guild, its handler is skipped — the hook
	 * still runs for every other plugin. Non-gateable plugins (core/builtin/
	 * in-repo, raw-client) pass through untouched.
	 *
	 * Only `on`/`onAny` are wrapped; emitHook and the rest are delegated as-is.
	 */
	buildHooksFacade() {
		const hooks = this.hooks;
		const pluginName = this.pluginName;
		const pluginManager = this.pluginManager;
		if (!hooks || !pluginManager) return hooks;

		const gate = (handler) => {
			return async (payload, ...rest) => {
				if (pluginManager.isGuildGateable(pluginName)) {
					const guildId =
						payload && typeof payload === "object"
							? payload.guildId ||
								payload.guild?.id ||
								payload.interaction?.guildId ||
								payload.message?.guildId
							: null;
					if (guildId && !pluginManager.isEnabledForGuild(guildId, pluginName)) {
						return; // plugin disabled for this guild — skip its handler
					}
				}
				return handler(payload, ...rest);
			};
		};

		return {
			on: (hookName, handler, priority = 0) =>
				hooks.on(hookName, gate(handler), priority),
			onAny: (handler) =>
				hooks.onAny((hookName, payload) => gate(() => handler(hookName, payload))(payload)),
			off: (hookName, handler) => hooks.off(hookName, handler),
			offAny: (handler) => hooks.offAny(handler),
			emitHook: (hookName, payload) => hooks.emitHook(hookName, payload),
		};
	}

	defineModel(modelName, schema) {
		const namespacedName = `plugin_${this.pluginName}_${modelName}`;

		if (mongoose.models[namespacedName]) {
			return mongoose.models[namespacedName];
		}

		return mongoose.model(namespacedName, schema);
	}
}

module.exports = { PluginContext };
