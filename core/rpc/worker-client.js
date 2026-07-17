/**
 * worker-client.js — RpcClient for plugin worker threads.
 *
 * Runs inside the worker process. Provides a clean async API for plugins
 * to call Core methods. All calls go through the IPC channel — the worker
 * never has direct access to the database, Discord client, or env vars.
 *
 * Usage (inside a worker):
 *   const rpc = new RpcClient(parentPort);
 *   const profile = await rpc.call('db.getUserProfile', { userId, guildId });
 */

const {
	MSG,
	createRequest,
	createResponse,
	createErrorResponse,
	isResponse,
	isEvent,
} = require("./protocol");

class RpcClient {
	/**
	 * @param {import('worker_threads').MessagePort} port - The IPC channel
	 * @param {object} [opts]
	 * @param {number} [opts.defaultTimeoutMs=5000] - Default timeout per call
	 */
	constructor(port, opts = {}) {
		this.port = port;
		this.defaultTimeoutMs = opts.defaultTimeoutMs || 5000;
		this.idCounter = 0;

		/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
		this.pending = new Map();

		/** @type {Map<string, Function[]>} event name → handler list */
		this.eventListeners = new Map();

		/** @type {boolean} */
		this.closed = false;

		// Listen for messages from Core
		this.port.on("message", (msg) => {
			if (this.closed) return;

			if (isResponse(msg)) {
				const entry = this.pending.get(msg.id);
				if (entry) {
					clearTimeout(entry.timer);
					this.pending.delete(msg.id);
					if (msg.ok) {
						entry.resolve(msg.result);
					} else {
						entry.reject(new Error(msg.error));
					}
				}
			} else if (isEvent(msg)) {
				const handlers = this.eventListeners.get(msg.event) || [];
				for (const handler of handlers) {
					try {
						handler(msg.payload);
					} catch (err) {
						console.error(`[RpcClient] Error in event handler for "${msg.event}":`, err);
					}
				}
			}
		});
	}

	// ── RPC Calls ────────────────────────────────────────────────────────

	/**
	 * Send an RPC request to Core and wait for the response.
	 *
	 * @param {string} method - RPC method name, e.g. "db.getPluginConfig"
	 * @param {object} [params={}] - Method parameters
	 * @param {number} [timeoutMs] - Override default timeout
	 * @returns {Promise<*>} - The result from Core
	 * @throws {Error} if the call fails or times out
	 */
	async call(method, params = {}, timeoutMs) {
		if (this.closed) throw new Error("RpcClient is closed");

		const timeout = timeoutMs || this.defaultTimeoutMs;
		const request = createRequest(method, params);

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(request.id);
				reject(new Error(`RPC timeout after ${timeout}ms: ${method}`));
			}, timeout);

			this.pending.set(request.id, { resolve, reject, timer });

			try {
				this.port.postMessage(request);
			} catch (err) {
				clearTimeout(timer);
				this.pending.delete(request.id);
				reject(new Error(`Failed to send RPC request: ${err.message}`));
			}
		});
	}

	/**
	 * Convenience method for db.getPluginConfig.
	 * Automatically injects the pluginId (caller must set it).
	 */
	async getPluginConfig(guildId) {
		return this.call("db.getPluginConfig", { guildId });
	}

	/**
	 * Convenience method for db.updatePluginConfig.
	 */
	async updatePluginConfig(guildId, data) {
		return this.call("db.updatePluginConfig", { guildId, data });
	}

	/**
	 * Convenience method for db.getUserProfile.
	 */
	async getUserProfile(userId, guildId) {
		return this.call("db.getUserProfile", { userId, guildId });
	}

	/**
	 * Convenience method for db.updateUserProfile.
	 */
	async updateUserProfile(userId, guildId, data) {
		return this.call("db.updateUserProfile", { userId, guildId, data });
	}

	/**
	 * Convenience method for db.addXP.
	 */
	async addXP(userId, guildId, amount, type, reason) {
		return this.call("db.addXP", { userId, guildId, amount, type, reason });
	}

	// ── Event Handling ───────────────────────────────────────────────────

	/**
	 * Subscribe to events forwarded from Core (e.g. Discord events).
	 *
	 * @param {string} eventName - e.g. "guildMemberAdd"
	 * @param {Function} handler - Called with the event payload
	 * @returns {Function} Unsubscribe function
	 */
	on(eventName, handler) {
		if (!this.eventListeners.has(eventName)) {
			this.eventListeners.set(eventName, []);
		}
		this.eventListeners.get(eventName).push(handler);

		// Return unsubscribe function
		return () => {
			const list = this.eventListeners.get(eventName);
			if (list) {
				const idx = list.indexOf(handler);
				if (idx !== -1) list.splice(idx, 1);
			}
		};
	}

	/**
	 * Remove all event listeners.
	 */
	removeAllListeners() {
		this.eventListeners.clear();
	}

	// ── Lifecycle ────────────────────────────────────────────────────────

	/**
	 * Signal to Core that this worker is ready.
	 */
	ready() {
		if (!this.closed) {
			this.port.postMessage({ type: MSG.WorkerReady });
		}
	}

	/**
	 * Signal to Core that this worker encountered an error.
	 */
	error(message) {
		if (!this.closed) {
			this.port.postMessage({ type: MSG.WorkerError, error: message });
		}
	}

	/**
	 * Close the client, rejecting any pending requests.
	 */
	close() {
		this.closed = true;
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(new Error("RpcClient closed"));
		}
		this.pending.clear();
		this.removeAllListeners();
	}
}

module.exports = { RpcClient };
