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
		return Object.freeze({
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
			hooks: this.hooks,
			config: this.config,
			logger: this.logger,
		});
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
