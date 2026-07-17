/**
 * worker-manager.js — WorkerManager.
 *
 * Runs in the Core process. Manages the lifecycle of plugin worker threads:
 *   - Spawns workers with resourceLimits
 *   - Routes IPC messages between workers and the CapabilityBroker
 *   - Forwards Discord events and hooks to workers
 *   - Handles worker crashes and restarts
 *   - Enforces per-call timeouts at the Core level
 */

const { Worker } = require("worker_threads");
const path = require("path");
const { isRequest, isEvent } = require("./protocol");
const { createLogger } = require("../logger");
const { metricsCollector } = require("./metrics");

const BOOTSTRAP_PATH = path.join(__dirname, "worker-bootstrap.js");

// Default resource limits for worker threads
const DEFAULT_RESOURCE_LIMITS = {
	maxOldGenerationSizeMb: 128,
	maxYoungGenerationSizeMb: 32,
	stackSizeMb: 4,
};

// Default timeout for worker startup
const STARTUP_TIMEOUT_MS = 15000;

// Max consecutive crashes before giving up on a plugin
const MAX_CRASH_COUNT = 3;

class WorkerManager {
	/**
	 * @param {object} opts
	 * @param {import('./broker').CapabilityBroker} opts.broker
	 * @param {object} opts.hooks - HookBus instance
	 * @param {string} [opts.logNamespace]
	 */
	constructor({ broker, hooks, logNamespace = "WorkerManager" }) {
		this.broker = broker;
		this.hooks = hooks;
		this.logger = createLogger(logNamespace);

		/** @type {Map<string, WorkerEntry>} pluginId → worker state */
		this.workers = new Map();

		// Listen for hook events and forward to all workers
		this._hookUnsub = hooks.onAny(async (hookName, payload) => {
			this.broadcastEvent(`hook:${hookName}`, payload);
		});

		// Handle resource limit events from workers
		this._resourceEventHandlers = new Map();

		// Single global listener for call metrics — dispatches per-plugin
		this._metricsUnsub = metricsCollector.on('call:recorded', (event) => {
			const tracker = this.broker.getResourceTracker(event.pluginId);
			if (tracker) {
				const m = tracker.getMetrics();
				metricsCollector.updateMemoryUsage(event.pluginId, m.current.memoryMB);
			}
		});

		// Forward broker EventEmitter events to workers
		this._brokerHookForward = ({ pluginId, eventName, payload }) => {
			this.sendEvent(pluginId, `hook:${eventName}`, payload);
		};
		this._brokerCronTick = ({ pluginId, taskId, name }) => {
			this.sendEvent(pluginId, 'cron:tick', { pluginId, taskId, name });
		};
		broker.on('hook:forward', this._brokerHookForward);
		broker.on('cron:tick', this._brokerCronTick);
	}

	// ── Worker Lifecycle ─────────────────────────────────────────────────

	/**
	 * Spawn a worker for a plugin.
	 *
	 * @param {string} pluginId
	 * @param {string} entryPath - Absolute path to the plugin's index.js
	 * @param {object} capabilities - Plugin's declared capabilities
	 * @param {string} [pluginName] - Human-readable name
	 * @returns {Promise<void>} Resolves when the worker signals ready
	 */
	async spawnWorker(pluginId, entryPath, capabilities, pluginName) {
		if (this.workers.has(pluginId)) {
			this.logger.warn(`Worker already exists for ${pluginId}, terminating first`);
			await this.terminateWorker(pluginId);
		}

		// Register capabilities with the broker
		this.broker.registerCapabilities(pluginId, capabilities, pluginName);

		this.logger.info(`Spawning worker for ${pluginName || pluginId}...`);

		const worker = new Worker(BOOTSTRAP_PATH, {
			workerData: {
				pluginId,
				entryPath,
				pluginName: pluginName || pluginId,
			},
			resourceLimits: DEFAULT_RESOURCE_LIMITS,
		});

		const entry = {
			worker,
			pluginId,
			pluginName: pluginName || pluginId,
			entryPath,
			capabilities,
			crashCount: 0,
			spawnedAt: Date.now(),
			ready: false,
		};

		this.workers.set(pluginId, entry);

		// Set up message routing
		worker.on("message", (msg) => this._handleMessage(pluginId, msg));

		// Handle worker errors
		worker.on("error", (err) => {
			this.logger.error(`Worker ${pluginId} error:`, err.message);
			this._handleCrash(pluginId, err);
		});

		// Handle worker exit
		worker.on("exit", (code) => {
			const e = this.workers.get(pluginId);
			if (e) {
				e.ready = false;
				if (code !== 0) {
					this.logger.warn(`Worker ${pluginId} exited with code ${code}`);
					this._handleCrash(pluginId, new Error(`Exit code ${code}`));
				} else {
					this.logger.info(`Worker ${pluginId} exited cleanly`);
					this.workers.delete(pluginId);
					this.broker.unregisterCapabilities(pluginId);
				}
			}
		});

		// Set up resource event handling
		this._setupResourceEventHandling(pluginId);

		// Wait for the worker to signal ready (or timeout)
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Worker ${pluginId} startup timeout after ${STARTUP_TIMEOUT_MS}ms`));
			}, STARTUP_TIMEOUT_MS);

			const checkReady = () => {
				if (entry.ready) {
					clearTimeout(timer);
					resolve();
				}
			};

			// Check if already ready (race condition safe)
			checkReady();

			// Store resolve/reject for the message handler
			entry._startupResolve = () => {
				clearTimeout(timer);
				resolve();
			};
			entry._startupReject = (err) => {
				clearTimeout(timer);
				reject(err);
			};
		});
	}

	/**
	 * Terminate a plugin's worker.
	 *
	 * @param {string} pluginId
	 * @returns {Promise<void>}
	 */
	async terminateWorker(pluginId) {
		const entry = this.workers.get(pluginId);
		if (!entry) return;

		this.logger.info(`Terminating worker for ${entry.pluginName}...`);

		entry.ready = false;
		this.broker.unregisterCapabilities(pluginId);

		// Clean up resource event handlers
		const unsub = this._resourceEventHandlers.get(pluginId);
		if (unsub) {
			unsub();
			this._resourceEventHandlers.delete(pluginId);
		}

		try {
			await entry.worker.terminate();
		} catch (err) {
			this.logger.warn(`Error terminating worker ${pluginId}:`, err.message);
		}

		this.workers.delete(pluginId);
	}

	/**
	 * Restart a plugin's worker (terminate + respawn).
	 */
	async restartWorker(pluginId) {
		const entry = this.workers.get(pluginId);
		if (!entry) return;

		const { entryPath, capabilities, pluginName } = entry;
		await this.terminateWorker(pluginId);
		await this.spawnWorker(pluginId, entryPath, capabilities, pluginName);
	}

	// ── Message Handling ─────────────────────────────────────────────────

	/**
	 * Handle a message from a worker.
	 */
	async _handleMessage(pluginId, msg) {
		const entry = this.workers.get(pluginId);
		if (!entry) return;

		// Worker signals ready
		if (msg.type === "worker:ready") {
			entry.ready = true;
			this.logger.info(`Worker ${pluginId} is ready`);
			if (entry._startupResolve) {
				entry._startupResolve();
				entry._startupResolve = null;
				entry._startupReject = null;
			}
			return;
		}

		// Worker signals error during startup
		if (msg.type === "worker:error") {
			this.logger.error(`Worker ${pluginId} reported error: ${msg.error}`);
			if (entry._startupReject) {
				entry._startupReject(new Error(msg.error));
				entry._startupResolve = null;
				entry._startupReject = null;
			}
			return;
		}

		// Resource limit events from worker
		if (msg.type && msg.type.startsWith('resource.')) {
			this._handleResourceEvent(pluginId, msg);
			return;
		}

		// RPC request from worker → route to broker
		if (isRequest(msg)) {
			try {
				const response = await this.broker.handleRequest(pluginId, msg);
				// Send response back to the worker
				entry.worker.postMessage(response);
			} catch (err) {
				this.logger.error(`Error handling RPC from ${pluginId}:`, err.message);
				entry.worker.postMessage({
					type: "rpc:response",
					id: msg.id,
					ok: false,
					error: `Internal broker error: ${err.message}`,
				});
			}
			return;
		}
	}

	// ── Event Forwarding ─────────────────────────────────────────────────

	/**
	 * Send an event to a specific worker.
	 *
	 * @param {string} pluginId
	 * @param {string} eventName
	 * @param {object} payload
	 */
	sendEvent(pluginId, eventName, payload) {
		const entry = this.workers.get(pluginId);
		if (!entry || !entry.ready) return;

		entry.worker.postMessage({
			type: "rpc:event",
			event: eventName,
			payload,
		});
	}

	/**
	 * Broadcast an event to all ready workers.
	 *
	 * @param {string} eventName
	 * @param {object} payload
	 */
	broadcastEvent(eventName, payload) {
		for (const [pluginId, entry] of this.workers) {
			if (!entry.ready) continue;
			try {
				entry.worker.postMessage({
					type: "rpc:event",
					event: eventName,
					payload,
				});
			} catch (err) {
				this.logger.warn(`Failed to send event to ${pluginId}:`, err.message);
			}
		}
	}

	// ── Crash Handling ───────────────────────────────────────────────────

	/**
	 * Handle a worker crash. Auto-restart if under the crash limit.
	 */
	async _handleCrash(pluginId, error) {
		const entry = this.workers.get(pluginId);
		if (!entry) return;

		entry.crashCount++;
		entry.ready = false;

		if (entry.crashCount >= MAX_CRASH_COUNT) {
			this.logger.error(
				`Worker ${pluginId} crashed ${entry.crashCount} times — giving up. ` +
					`The plugin will not be loaded until manually reloaded.`,
			);
			this.workers.delete(pluginId);
			this.broker.unregisterCapabilities(pluginId);
			return;
		}

		this.logger.warn(
			`Worker ${pluginId} crashed (attempt ${entry.crashCount}/${MAX_CRASH_COUNT}). ` +
				`Restarting in 2 seconds...`,
		);

		// Wait before restarting
		await new Promise((r) => setTimeout(r, 2000));

		try {
			await this.spawnWorker(
				pluginId,
				entry.entryPath,
				entry.capabilities,
				entry.pluginName,
			);
		} catch (err) {
			this.logger.error(`Failed to restart worker ${pluginId}:`, err.message);
		}
	}

	// ── Introspection ────────────────────────────────────────────────────

	/**
	 * Get the status of all workers.
	 */
	getWorkerStatus() {
		const status = {};
		for (const [pluginId, entry] of this.workers) {
			status[pluginId] = {
				ready: entry.ready,
				crashCount: entry.crashCount,
				spawnedAt: entry.spawnedAt,
				uptime: Date.now() - entry.spawnedAt,
			};
		}
		return status;
	}

	/**
	 * Check if a plugin is running in a worker.
	 */
	hasWorker(pluginId) {
		return this.workers.has(pluginId);
	}

	/**
	 * Get the count of active workers.
	 */
	get activeCount() {
		return Array.from(this.workers.values()).filter((e) => e.ready).length;
	}

	/**
	 * Shut down all workers.
	 */
	async shutdown() {
		this.logger.info(`Shutting down ${this.workers.size} workers...`);

		// Unsubscribe from hooks, metrics, and broker events
		if (this._hookUnsub) this._hookUnsub();
		if (this._metricsUnsub) this._metricsUnsub();
		if (this._brokerHookForward) this.broker.removeListener('hook:forward', this._brokerHookForward);
		if (this._brokerCronTick) this.broker.removeListener('cron:tick', this._brokerCronTick);

		const promises = [];
		for (const [pluginId] of this.workers) {
			promises.push(this.terminateWorker(pluginId));
		}
		await Promise.allSettled(promises);

		this.logger.info("All workers terminated");
	}

	// ── Resource Event Handling ──────────────────────────────────────────

	/**
	 * Set up resource event handling for a worker.
	 * @private
	 */
	_setupResourceEventHandling(pluginId) {
		// No per-plugin listener needed — the global listener in the constructor handles dispatch
		// Store a no-op unsub for cleanup consistency
		this._resourceEventHandlers.set(pluginId, () => {});
	}

	/**
	 * Handle resource limit events from workers.
	 * @private
	 */
	_handleResourceEvent(pluginId, event) {
		switch (event.type) {
			case 'resource.timeout':
				this.logger.warn(`Resource timeout for ${pluginId} on call ${event.callId}`);
				// Could trigger worker restart or alert here
				break;

			case 'resource.memoryExceeded':
				this.logger.error(`Memory limit exceeded for ${pluginId}: ${event.memoryMB}MB > ${event.limitMB}MB`);
				// Terminate the worker if it exceeds memory limit
				this.terminateWorker(pluginId).catch(err => {
					this.logger.error(`Failed to terminate memory-exceeding worker ${pluginId}:`, err.message);
				});
				break;

			default:
				this.logger.debug(`Unknown resource event from ${pluginId}: ${event.type}`);
			}
	}

	// ── Metrics ──────────────────────────────────────────────────────────

	/**
	 * Get metrics for all workers.
	 */
	getWorkerMetrics() {
		const metrics = {};
		for (const [pluginId] of this.workers) {
			const tracker = this.broker.getResourceTracker(pluginId);
			if (tracker) {
				metrics[pluginId] = tracker.getMetrics();
			}
		}
		return metrics;
	}

	/**
	 * Get global metrics.
	 */
	getGlobalMetrics() {
		return metricsCollector.getGlobalMetrics();
	}
}

module.exports = { WorkerManager };
