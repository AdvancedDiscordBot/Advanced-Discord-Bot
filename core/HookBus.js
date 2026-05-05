class HookBus {
	constructor(logger) {
		this.logger = logger;
		this.handlers = new Map();
		this.anyHandlers = [];
	}

	on(hookName, handler, priority = 0) {
		if (!this.handlers.has(hookName)) {
			this.handlers.set(hookName, []);
		}

		const list = this.handlers.get(hookName);
		list.push({ handler, priority });
		list.sort((a, b) => b.priority - a.priority);

		return () => this.off(hookName, handler);
	}

	onAny(handler) {
		this.anyHandlers.push(handler);
		return () => this.offAny(handler);
	}

	off(hookName, handler) {
		const list = this.handlers.get(hookName);
		if (!list) return;

		this.handlers.set(
			hookName,
			list.filter((entry) => entry.handler !== handler),
		);
	}

	offAny(handler) {
		this.anyHandlers = this.anyHandlers.filter((fn) => fn !== handler);
	}

	async emitHook(hookName, payload) {
		let currentPayload = payload || {};

		for (const handler of this.anyHandlers) {
			try {
				await handler(hookName, currentPayload);
			} catch (error) {
				this.logger?.warn(`Hook bus onAny failed: ${hookName}`, error);
			}
		}

		const list = this.handlers.get(hookName) || [];

		for (const { handler } of list) {
			try {
				const result = await handler(currentPayload);
				if (result && typeof result === "object") {
					if (result.cancel === true) {
						return { cancelled: true, payload: currentPayload };
					}

					currentPayload = { ...currentPayload, ...result };
				}
			} catch (error) {
				this.logger?.warn(`Hook handler failed: ${hookName}`, error);
			}
		}

		return { cancelled: false, payload: currentPayload };
	}
}

module.exports = { HookBus };
