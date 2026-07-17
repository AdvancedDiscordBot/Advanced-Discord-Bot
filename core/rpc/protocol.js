/**
 * protocol.js — RPC message types and schemas for Core ↔ Worker IPC.
 *
 * All communication between the Core process and plugin worker threads
 * flows through structured messages. No shared objects, no direct function
 * calls — only serialized JSON over Node.js worker_threads postMessage.
 *
 * Message flow:
 *   Worker → Core:  { type: "rpc:request", id, method, params }
 *   Core → Worker:  { type: "rpc:response", id, ok, result|error }
 *   Core → Worker:  { type: "rpc:event", event, payload }
 *   Core → Worker:  { type: "rpc:shutdown" }
 */

// ── Message Types ─────────────────────────────────────────────────────────

const MSG = {
	// Plugin worker → Core
	REQUEST: "rpc:request",

	// Core → Plugin worker (response to a request)
	RESPONSE: "rpc:response",

	// Core → Plugin worker (event notification, e.g. Discord event forwarded)
	EVENT: "rpc:event",

	// Core → Plugin worker (graceful shutdown signal)
	SHUTDOWN: "rpc:shutdown",

	// Plugin worker → Core (worker is ready after load())
	WorkerReady: "worker:ready",

	// Plugin worker → Core (worker encountered an error)
	WorkerError: "worker:error",
};

// ── Request Schema ────────────────────────────────────────────────────────

/**
 * @typedef {Object} RpcRequest
 * @property {string} id       - Unique request ID for correlation
 * @property {string} method   - RPC method name, e.g. "db.getPluginConfig"
 * @property {object} params   - Method-specific parameters
 */

function createRequest(method, params = {}) {
	return {
		type: MSG.REQUEST,
		id: `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		method,
		params,
	};
}

// ── Response Schema ───────────────────────────────────────────────────────

/**
 * @typedef {Object} RpcResponse
 * @property {string} id     - Matches the request id
 * @property {boolean} ok    - Whether the call succeeded
 * @property {*} result      - Return value (if ok)
 * @property {string} error  - Error message (if !ok)
 */

function createResponse(id, result) {
	return { type: MSG.RESPONSE, id, ok: true, result };
}

function createErrorResponse(id, error) {
	return {
		type: MSG.RESPONSE,
		id,
		ok: false,
		error: error instanceof Error ? error.message : String(error),
	};
}

// ── Event Schema ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} RpcEvent
 * @property {string} event   - Event name, e.g. "guildMemberAdd"
 * @property {object} payload - Event data
 */

function createEvent(event, payload) {
	return { type: MSG.EVENT, event, payload };
}

// ── Validation Helpers ────────────────────────────────────────────────────

function isRequest(msg) {
	return !!(msg && msg.type === MSG.REQUEST && typeof msg.id === "string" && typeof msg.method === "string");
}

function isResponse(msg) {
	return !!(msg && msg.type === MSG.RESPONSE && typeof msg.id === "string" && typeof msg.ok === "boolean");
}

function isEvent(msg) {
	return !!(msg && msg.type === MSG.EVENT && typeof msg.event === "string");
}

module.exports = {
	MSG,
	createRequest,
	createResponse,
	createErrorResponse,
	createEvent,
	isRequest,
	isResponse,
	isEvent,
};
