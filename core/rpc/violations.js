/**
 * violations.js — Violation ledger + auto-suspension policy.
 *
 * Journey 5 ("something goes wrong") rests on this: when a plugin tries to do
 * something outside its granted manifest — call an RPC it lacks the capability
 * for, reach a host not in its network allowlist — the broker records the
 * attempt here. Enough attempts in a short window trips automatic suspension,
 * and a suspended plugin's calls are refused before they execute.
 *
 * This is deliberately in-process and bounded: a rolling per-plugin ring of the
 * most recent violations (for the admin view) plus a windowed counter (for the
 * suspension decision). It does not touch the database — the runtime only needs
 * "is this plugin suspended right now" to be fast and dependency-free. Callers
 * that want durable audit can subscribe to the emitted events and persist them.
 */

const { EventEmitter } = require("events");

// Violation categories. Kept small and stable — each maps to a user-facing
// explanation in the admin view / owner notification.
const KIND = {
	CAPABILITY: "capability", // called an RPC method it lacks the capability for
	NETWORK: "network", // tried to reach a host not in network.outbound
	RESOURCE: "resource", // exceeded a declared resource ceiling (memory/timeout)
	UNKNOWN_METHOD: "unknown-method", // called an RPC method that does not exist
};

const DEFAULTS = {
	// A plugin is suspended once it accrues this many violations within the window.
	threshold: 5,
	// Rolling window (ms) over which violations are counted toward the threshold.
	windowMs: 60_000,
	// How many recent violations to retain per plugin for the admin view.
	historySize: 50,
};

class ViolationTracker extends EventEmitter {
	/**
	 * @param {object} [opts]
	 * @param {number} [opts.threshold]  Violations within the window before suspension
	 * @param {number} [opts.windowMs]   Rolling window length in ms
	 * @param {number} [opts.historySize] Recent violations retained per plugin
	 * @param {() => number} [opts.now]  Clock injection (tests). Defaults to Date.now.
	 */
	constructor(opts = {}) {
		super();
		this.threshold = opts.threshold ?? DEFAULTS.threshold;
		this.windowMs = opts.windowMs ?? DEFAULTS.windowMs;
		this.historySize = opts.historySize ?? DEFAULTS.historySize;
		this._now = opts.now ?? Date.now;

		/** @type {Map<string, object[]>} pluginId → recent violation records (newest last) */
		this._history = new Map();
		/** @type {Map<string, number[]>} pluginId → timestamps within the window */
		this._window = new Map();
		/** @type {Map<string, object>} pluginId → suspension record */
		this._suspended = new Map();
	}

	/**
	 * Record a violation attempt. Returns the created record. If this attempt
	 * crosses the threshold, the plugin is suspended and a "suspend" event fires.
	 *
	 * @param {string} pluginId
	 * @param {object} detail
	 * @param {string} detail.kind    One of KIND.*
	 * @param {string} detail.method  RPC method attempted (or "-")
	 * @param {string} detail.message Human-readable reason
	 * @param {string} [detail.guildId] Guild the call was running for, if known
	 * @returns {{ record: object, suspended: boolean }}
	 */
	record(pluginId, detail) {
		const ts = this._now();
		const record = {
			pluginId,
			kind: detail.kind || KIND.CAPABILITY,
			method: detail.method || "-",
			message: detail.message || "",
			guildId: detail.guildId || null,
			at: ts,
		};

		// Append to bounded history.
		const hist = this._history.get(pluginId) || [];
		hist.push(record);
		if (hist.length > this.historySize) hist.splice(0, hist.length - this.historySize);
		this._history.set(pluginId, hist);

		this.emit("violation", record);

		// Update windowed counter and evaluate suspension.
		const win = (this._window.get(pluginId) || []).filter((t) => ts - t < this.windowMs);
		win.push(ts);
		this._window.set(pluginId, win);

		let suspended = false;
		if (!this._suspended.has(pluginId) && win.length >= this.threshold) {
			suspended = true;
			this._suspend(pluginId, ts, win.length);
		}

		return { record, suspended };
	}

	/** @private */
	_suspend(pluginId, ts, count) {
		const susp = {
			pluginId,
			at: ts,
			reason: `${count} violations within ${Math.round(this.windowMs / 1000)}s`,
			recent: (this._history.get(pluginId) || []).slice(-count),
		};
		this._suspended.set(pluginId, susp);
		this.emit("suspend", susp);
	}

	/**
	 * @param {string} pluginId
	 * @returns {boolean} whether the plugin is currently suspended
	 */
	isSuspended(pluginId) {
		return this._suspended.has(pluginId);
	}

	/**
	 * Lift a suspension (manual admin action after review) and reset the plugin's
	 * windowed counter so it starts clean.
	 * @param {string} pluginId
	 * @returns {boolean} true if a suspension was actually lifted
	 */
	reinstate(pluginId) {
		const was = this._suspended.delete(pluginId);
		this._window.delete(pluginId);
		if (was) this.emit("reinstate", { pluginId, at: this._now() });
		return was;
	}

	/**
	 * @param {string} pluginId
	 * @returns {object[]} recent violation records, newest last (copy)
	 */
	getViolations(pluginId) {
		return [...(this._history.get(pluginId) || [])];
	}

	/**
	 * @param {string} pluginId
	 * @returns {object|null} suspension record if suspended
	 */
	getSuspension(pluginId) {
		return this._suspended.get(pluginId) || null;
	}

	/**
	 * Snapshot for the admin view: every plugin with at least one violation.
	 * @returns {object[]}
	 */
	summary() {
		const out = [];
		for (const [pluginId, hist] of this._history) {
			out.push({
				pluginId,
				total: hist.length,
				suspended: this._suspended.has(pluginId),
				lastAt: hist.length ? hist[hist.length - 1].at : null,
				recent: hist.slice(-5),
			});
		}
		return out;
	}

	/** Clear all state for a plugin (on uninstall). */
	forget(pluginId) {
		this._history.delete(pluginId);
		this._window.delete(pluginId);
		this._suspended.delete(pluginId);
	}
}

module.exports = { ViolationTracker, KIND, DEFAULTS };
