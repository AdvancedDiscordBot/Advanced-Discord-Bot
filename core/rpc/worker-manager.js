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
const { isRequest } = require("./protocol");
const { createLogger } = require("../logger");
const { metricsCollector } = require("./metrics");

const BOOTSTRAP_PATH = path.join(__dirname, "worker-bootstrap.js");

// Default resource limits for worker threads
const DEFAULT_RESOURCE_LIMITS = {
	maxOldGenerationSizeMb: 512,
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

		this.workers = new Map();

/**
 * Persistent health history for workers.
 *
 * `workers` only contains currently active workers. Once a worker is
 * quarantined after repeated crashes it is removed from that map, so
 * diagnostics would otherwise lose the crash history.
 */
this.healthHistory = new Map();

this._shuttingDown = false;

		// Handle resource limit events from workers
		this._resourceEventHandlers = new Map();

		// Single global listener for call metrics — dispatches per-plugin.
		// EventEmitter.on returns the emitter, not an unsubscribe, so we keep the
		// handler reference and build our own teardown closure for shutdown().
		this._metricsHandler = (event) => {
			const tracker = this.broker.getResourceTracker(event.pluginId);
			if (tracker) {
				const m = tracker.getMetrics();
				metricsCollector.updateMemoryUsage(event.pluginId, m.current.memoryMB);
			}
		};
		metricsCollector.on('call:recorded', this._metricsHandler);
		this._metricsUnsub = () => metricsCollector.removeListener('call:recorded', this._metricsHandler);

		// Only broker subscriptions forward hooks. A global onAny broadcast
		// bypasses subscription scoping and delivers each subscribed hook twice.
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
	 * Failure rejects this attempt even if a bounded retry is queued; callers
	 * abandoning a load must cancel it with terminateWorker().
	 *
	 * @param {string} pluginId
	 * @param {string} entryPath - Absolute path to the plugin's index.js
	 * @param {object} capabilities - Plugin's declared capabilities
	 * @param {string} [pluginName] - Human-readable name
	 * @param {object} [options] - networkAllowlist, grantedEnv, and carried crashCount
	 * @returns {Promise<void>} Resolves when the worker signals ready
	 */
	async spawnWorker(pluginId, entryPath, capabilities, pluginName, options = {}) {
		if (this._shuttingDown) throw new Error("WorkerManager is shutting down");

		const entry = {
			worker: null,
			pluginId,
			pluginName: pluginName || pluginId,
			entryPath,
			capabilities,
			networkAllowlist: Array.isArray(options.networkAllowlist) ? [...options.networkAllowlist] : [],
			grantedEnv: { ...options.grantedEnv },
			// Carry the crash count across respawns — otherwise a plugin that throws
			// in load() gets a fresh entry (crashCount 0) on every restart and the
			// MAX_CRASH_COUNT circuit breaker never trips, crash-looping forever.
			crashCount: options.crashCount || 0,
			lastError: null,
            lastCrashAt: null,
            lastReadyAt: null,
            restartCount: 0,
			spawnedAt: Date.now(),
			ready: false,
			stopped: false,
			_registered: false,
			_termination: null,
			_restartTimer: null,
		};

		const previous = this.workers.get(pluginId);
		if (previous) {
			this.logger.warn(`Worker already exists for ${pluginId}, terminating first`);
			entry._termination = this._stopWorker(previous, new Error(`Worker ${pluginId} startup replaced`));
		}
		// Reserve the replacement before awaiting termination. Unload, shutdown,
		// or a newer spawn can then cancel it without leaving a delayed respawn.
		this.workers.set(pluginId, entry);
		if (entry._termination) await entry._termination;
		if (this._shuttingDown || entry.stopped || this.workers.get(pluginId) !== entry) {
			throw new Error(`Worker ${pluginId} startup cancelled`);
		}
		entry._termination = null;

		try {
			entry._registered = true;
			this.broker.registerCapabilities(pluginId, capabilities, entry.pluginName, {
				networkAllowlist: entry.networkAllowlist,
			});
			this.logger.info(`Spawning worker for ${entry.pluginName}...`);
			entry.worker = new Worker(BOOTSTRAP_PATH, {
				workerData: {
					pluginId,
					entryPath,
					pluginName: entry.pluginName,
					grantedEnv: entry.grantedEnv,
				},
				env: entry.grantedEnv,
				resourceLimits: DEFAULT_RESOURCE_LIMITS,
			});
		} catch (error) {
			await this._stopWorker(entry, error);
			if (this.workers.get(pluginId) === entry) this.workers.delete(pluginId);
			throw error;
		}

		return new Promise((resolve, reject) => {
			const finishStartup = (error) => {
				clearTimeout(entry._startupTimer);
				entry._startupTimer = null;
				entry._startupResolve = null;
				entry._startupReject = null;
				if (error) reject(error);
				else resolve();
			};
			entry._startupResolve = () => finishStartup();
			entry._startupReject = finishStartup;
			entry._startupTimer = setTimeout(() => {
				this._handleCrash(entry, new Error(`Worker ${pluginId} startup timeout after ${STARTUP_TIMEOUT_MS}ms`));
			}, STARTUP_TIMEOUT_MS);

			entry._onMessage = (msg) => {
				this._handleMessage(entry, msg).catch((err) => {
					this.logger.error(`Error handling worker message from ${pluginId}:`, err.message);
				});
			};
			entry._onError = (err) => this._handleCrash(entry, err);
			entry._onExit = (code) => {
				entry.exited = true;
				if (this.workers.get(pluginId) !== entry || entry.stopped) return;
				if (code !== 0 || !entry.ready) {
					this._handleCrash(entry, new Error(`Worker ${pluginId} exited with code ${code}`));
				} else {
					this.logger.info(`Worker ${pluginId} exited cleanly`);
					this.terminateWorker(pluginId).catch((err) => {
						this.logger.error(`Failed to clean up worker ${pluginId}:`, err.message);
					});
				}
			};
			entry.worker.on("message", entry._onMessage);
			entry.worker.on("error", entry._onError);
			entry.worker.on("exit", entry._onExit);
			this._setupResourceEventHandling(pluginId);
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
		await this._stopWorker(entry, new Error(`Worker ${pluginId} terminated during startup`));
		if (this.workers.get(pluginId) === entry) this.workers.delete(pluginId);
	}

	/** Stop one worker generation once, sharing termination with concurrent callers. */
	_stopWorker(entry, error) {
		clearTimeout(entry._restartTimer);
		entry._restartTimer = null;
		if (entry.stopped) return entry._termination;
		entry.stopped = true;
		entry.ready = false;
		if (entry._startupReject) entry._startupReject(error);
		if (entry._registered) {
			entry._registered = false;
			this.broker.unregisterCapabilities(entry.pluginId);
		}

		const unsub = this._resourceEventHandlers.get(entry.pluginId);
		if (unsub) {
			unsub();
			this._resourceEventHandlers.delete(entry.pluginId);
		}

		if (!entry.worker) {
			entry._termination = entry._termination || Promise.resolve();
			return entry._termination;
		}
		entry.worker.removeListener("message", entry._onMessage);
		entry._termination = (async () => {
			try {
				if (!entry.exited) await entry.worker.terminate();
			} catch (err) {
				this.logger.warn(`Error terminating worker ${entry.pluginId}:`, err.message);
			} finally {
				// Keep the error listener until termination completes, so an error
				// emitted while stopping cannot become an unhandled EventEmitter error.
				entry.worker.removeListener("error", entry._onError);
				entry.worker.removeListener("exit", entry._onExit);
			}
		})();
		return entry._termination;
	}

	/**
	 * Restart a plugin's worker (terminate + respawn).
	 */
	async restartWorker(pluginId) {
		const entry = this.workers.get(pluginId);
		if (!entry) return;

		const { entryPath, capabilities, pluginName, networkAllowlist, grantedEnv } = entry;
		// Let spawnWorker reserve the replacement atomically. A manual reload
		// preserves grants but intentionally starts with a fresh crash budget.
		await this.spawnWorker(pluginId, entryPath, capabilities, pluginName, { networkAllowlist, grantedEnv });
	}

	// ── Message Handling ─────────────────────────────────────────────────

	/**
	 * Handle a message from a worker.
	 */
	async _handleMessage(entry, msg) {
		const { pluginId } = entry;
		if (this.workers.get(pluginId) !== entry || entry.stopped || !msg || typeof msg !== "object") return;

		// Worker signals ready
		if (msg.type === "worker:ready") {
    if (entry.ready) return;

    entry.ready = true;
    entry.lastReadyAt = Date.now();

    const previous = this.healthHistory.get(pluginId) || {};

    this.healthHistory.set(pluginId, {
        ...previous,
        pluginId,
        pluginName: entry.pluginName,
        status: "healthy",
        lastReadyAt: entry.lastReadyAt,
        lastError: entry.lastError || previous.lastError || null,
        lastCrashAt: entry.lastCrashAt || previous.lastCrashAt || null,
        crashCount: entry.crashCount,
        restartCount: entry.restartCount || previous.restartCount || 0,
    });

    this.logger.info(`Worker ${pluginId} is ready`);

    if (entry._startupResolve) entry._startupResolve();
    return;
}
			if (entry._startupResolve) entry._startupResolve();
			return;
		}

		// Worker signals error during startup
		if (msg.type === "worker:error") {
			this._handleCrash(entry, new Error(msg.error));
			return;
		}

		// Resource limit events from worker
		if (typeof msg.type === "string" && msg.type.startsWith("resource.")) {
			this._handleResourceEvent(pluginId, msg);
			return;
		}

		// RPC request from worker → route to broker
		if (isRequest(msg)) {
			let reply;
			try {
				const response = await this.broker.handleRequest(pluginId, msg);
				// The broker returns a bare { id, ok, result|error }; the worker's
				// RpcClient only recognizes a reply when it carries the
				// "rpc:response" type, so stamp it here before posting back.
				reply = {
					type: "rpc:response",
					id: response.id != null ? response.id : msg.id,
					ok: !!response.ok,
					result: response.result,
					error: response.error,
				};
			} catch (err) {
				this.logger.error(`Error handling RPC from ${pluginId}:`, err.message);
				reply = {
					type: "rpc:response",
					id: msg.id,
					ok: false,
					error: `Internal broker error: ${err.message}`,
				};
			}
			if (this.workers.get(pluginId) !== entry || entry.stopped) return;
			try {
				entry.worker.postMessage(reply);
			} catch (err) {
				this.logger.warn(`Failed to send RPC response to ${pluginId}:`, err.message);
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
		// A suspended plugin stops receiving events — it keeps running but is cut
		// off from new work until an admin reinstates it.
		if (this.broker.isSuspended(pluginId)) return;

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

	/**
	 * Broadcast an event to all ready workers.
	 *
	 * @param {string} eventName
	 * @param {object} payload
	 */
	broadcastEvent(eventName, payload, filter = null) {
		for (const [pluginId, entry] of this.workers) {
			if (!entry.ready) continue;
			if (this.broker.isSuspended(pluginId)) continue;
			// Optional per-plugin gate (e.g. the per-guild enable flag): a plugin
			// the target guild hasn't enabled never sees the event.
			if (filter && !filter(pluginId)) continue;
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
	const now = Date.now();
const previous = this.healthHistory.get(pluginId) || {};

entry.lastError = error?.message || String(error);
entry.lastCrashAt = now;
entry.restartCount = (previous.restartCount || 0) + 1;

this.healthHistory.set(pluginId, {
    ...previous,
    pluginId,
    pluginName: entry.pluginName,
    status: "crashed",
    lastError: entry.lastError,
    lastCrashAt: now,
    crashCount: entry.crashCount + 1,
    restartCount: entry.restartCount,
});
		if (this._shuttingDown || this.workers.get(pluginId) !== entry || entry.stopped) return;

		entry.crashCount++;
		const stopping = this._stopWorker(entry, error);

		if (entry.crashCount >= MAX_CRASH_COUNT) {
			this.healthHistory.set(pluginId, {
    ...(this.healthHistory.get(pluginId) || {}),
    pluginId,
    pluginName: entry.pluginName,
    status: "quarantined",
    lastError: entry.lastError,
    lastCrashAt: entry.lastCrashAt,
    crashCount: entry.crashCount,
    restartCount: entry.restartCount || 0,
});
			this.logger.error(
				`Worker ${pluginId} crashed ${entry.crashCount} times - giving up. ` +
					`The plugin will not be loaded until manually reloaded.`,
				error.message,
			);
			stopping.then(() => {
				if (this.workers.get(pluginId) === entry) this.workers.delete(pluginId);
			});
			return;
		}

		this.logger.warn(
			`Worker ${pluginId} crashed (attempt ${entry.crashCount}/${MAX_CRASH_COUNT}). ` +
				`Restarting in 2 seconds...`,
			error.message,
		);

		const timer = setTimeout(() => {
			if (this._shuttingDown || this.workers.get(pluginId) !== entry || entry._restartTimer !== timer) return;
			entry._restartTimer = null;
			this.spawnWorker(
				pluginId,
				entry.entryPath,
				entry.capabilities,
				entry.pluginName,
				{ networkAllowlist: entry.networkAllowlist, grantedEnv: entry.grantedEnv, crashCount: entry.crashCount },
			).catch((err) => {
				this.logger.error(`Failed to restart worker ${pluginId}:`, err.message);
			});
		}, 2000);
		entry._restartTimer = timer;
	}

	// ── Introspection ────────────────────────────────────────────────────

	/**
	 * Get the status of all workers.
	 */
	getWorkerStatus() {
    const status = {};
    const now = Date.now();

    // Include currently running workers.
    for (const [pluginId, entry] of this.workers) {
        const history = this.healthHistory.get(pluginId) || {};

        let state = "starting";

        if (entry.ready) {
            state = "healthy";
        } else if (entry.stopped) {
            state = "stopped";
        }

        status[pluginId] = {
            pluginId,
            pluginName: entry.pluginName,

            status: state,
            ready: entry.ready,

            crashCount: entry.crashCount || 0,
            restartCount: entry.restartCount || history.restartCount || 0,

            spawnedAt: entry.spawnedAt,
            lastReadyAt: entry.lastReadyAt || history.lastReadyAt || null,
            lastCrashAt: entry.lastCrashAt || history.lastCrashAt || null,

            uptime: entry.ready
                ? Math.max(0, now - entry.spawnedAt)
                : 0,

            lastError:
                entry.lastError ||
                history.lastError ||
                null,
        };
    }

    // Include workers that are no longer running but have useful
    // diagnostic history, such as quarantined plugins.
    for (const [pluginId, history] of this.healthHistory) {
        if (status[pluginId]) continue;

        status[pluginId] = {
            ...history,
            pluginId,
            status: history.status || "unknown",
            ready: false,
            uptime: 0,
        };
    }

    return status;
}/**
 * Return an aggregate health summary for the plugin worker system.
 */
getHealthSummary() {
    const workers = this.getWorkerStatus();

    const entries = Object.values(workers);

    const summary = {
        status: "healthy",
        total: entries.length,
        healthy: 0,
        starting: 0,
        crashed: 0,
        quarantined: 0,
        stopped: 0,
    };

    for (const worker of entries) {
        switch (worker.status) {
            case "healthy":
                summary.healthy++;
                break;

            case "starting":
                summary.starting++;
                break;

            case "crashed":
                summary.crashed++;
                break;

            case "quarantined":
                summary.quarantined++;
                break;

            case "stopped":
                summary.stopped++;
                break;

            default:
                break;
        }
    }

    if (summary.quarantined > 0) {
        summary.status = "critical";
    } else if (summary.crashed > 0) {
        summary.status = "degraded";
    } else if (summary.starting > 0) {
        summary.status = "starting";
    }

    return summary;
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
		if (this._shutdownPromise) return this._shutdownPromise;
		this._shuttingDown = true;
		this.logger.info(`Shutting down ${this.workers.size} workers...`);

		// Unsubscribe from metrics and broker events
		if (this._metricsUnsub) this._metricsUnsub();
		if (this._brokerHookForward) this.broker.removeListener('hook:forward', this._brokerHookForward);
		if (this._brokerCronTick) this.broker.removeListener('cron:tick', this._brokerCronTick);

		const promises = [];
		for (const [pluginId] of this.workers) {
			promises.push(this.terminateWorker(pluginId));
		}
		this._shutdownPromise = Promise.allSettled(promises).then(() => {
			this.logger.info("All workers terminated");
		});
		return this._shutdownPromise;
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

module.exports = { WorkerManager, MAX_CRASH_COUNT };
