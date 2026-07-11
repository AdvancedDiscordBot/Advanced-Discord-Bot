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
		const ctx = {
			client: this.client,
			db: this.db,
			scheduler: this.scheduler,
			commands: this.client.commands,
			registerCommand: (command) =>
				this.pluginManager.registerCommand(this.pluginName, command),
			overrideCommand: (name, overrideFn) =>
				this.pluginManager.overrideCommand(this.pluginName, name, overrideFn),
			registerEvent: (name, handler, options = {}) =>
				this.pluginManager.registerEvent(
					this.pluginName,
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
			hooks: this.hooks,
			config: this.config,
			logger: this.logger,
		};
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

	defineModel(modelName, schema) {
		const namespacedName = `plugin_${this.pluginName}_${modelName}`;

		if (mongoose.models[namespacedName]) {
			return mongoose.models[namespacedName];
		}

		return mongoose.model(namespacedName, schema);
	}
}

module.exports = { PluginContext };
