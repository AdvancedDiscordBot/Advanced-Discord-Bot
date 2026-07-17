# Plugin Isolation Architecture — Implementation Plan

> **Spec source:** User-provided architecture spec (Core / Broker / Worker model)
> **Date:** 2026-07-16
> **Status:** Planning → Ready to implement

## Context: What exists today

The bot has a working plugin system (`core/PluginManager.js`, `core/PluginContext.js`) where plugins run **in-process** via `require()`. A `PluginContext` object is built per plugin with frozen, namespaced access to `client`, `db`, `scheduler`, `hooks`, and utility methods. The system already supports:

- Dependency-ordered loading with topological sort
- Hot-reload via chokidar + require cache busting
- Command/event registration via `ctx.registerCommand()` / `ctx.registerEvent()`
- Namespaced Mongoose models via `ctx.defineModel()`
- HookBus for inter-plugin communication
- Per-guild plugin config via `ctx.db.getPluginConfig()`

**But:** every plugin shares the bot's runtime. There is no meaningful boundary between "plugin" and "platform." The spec addresses this with a three-tier process model.

## Audit: Current plugin `ctx` usage

From the codebase analysis, here is exactly what the 3 existing plugins use:

| `ctx` property | welcome | automod | autorole | Notes |
|---|---|---|---|---|
| `ctx.db.getPluginConfig()` | ✅ (11 calls) | — | ✅ | All plugins read their own config |
| `ctx.db.updatePluginConfig()` | ✅ (9 calls) | — | — | Welcome writes config |
| `ctx.db.getUserProfile()` | — | ✅ | — | AutoMod reads profiles for warnings |
| `ctx.db.updateUserProfile()` | — | ✅ | — | AutoMod writes warning counts |
| `ctx.registerCommand()` | ✅ | ✅ | ✅ | All register slash commands |
| `ctx.registerEvent()` | ✅ (2) | ✅ (1) | ✅ (1) | Guild events |
| `ctx.defineModel()` | — | ✅ (2) | ✅ (2) | Namespaced Mongoose models |
| `ctx.models` | — | ✅ | — | Assigned after defineModel |
| `ctx.hooks.on()` | — | — | ✅ | Autorole listens to onLevelUp |
| `ctx.hooks.on("onPluginUnload")` | — | — | ✅ | Cleanup |
| `ctx.client` | — | — | — | **Not used directly by any plugin** |
| `ctx.config.env` | — | — | — | **Not used directly by any plugin** |
| `ctx.logger.*` | ✅ | ✅ | ✅ | All plugins log |
| `ctx.scheduler` | — | — | — | Autorole uses `node-cron` directly |

**Key finding:** No plugin directly `require()`s `fs`, `child_process`, `mongoose`, or any Node.js built-in. They all go through `ctx` methods. This makes the migration surface **much smaller** than feared — the RPC layer needs to cover ~12 methods, not arbitrary code execution.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ CORE PROCESS (never runs plugin code)                       │
│  • Discord client, DB connection, API keys                  │
│  • Capability Broker (validates every RPC call)             │
│  • RPC Router (only path plugins can use)                   │
│  • Fastify API server                                       │
└───────────────────┬─────────────────────────────────────────┘
                    │ IPC (structured messages, no shared objects)
       ┌────────────┼────────────┐
       ▼            ▼            ▼
┌───────────┐ ┌───────────┐ ┌───────────┐
│ Plugin A   │ │ Plugin B   │ │ Plugin C   │
│ worker     │ │ worker     │ │ worker     │
│ (sandboxed)│ │ (sandboxed)│ │ (sandboxed)│
└───────────┘ └───────────┘ └───────────┘
```

**Rule:** a plugin process is never handed `ctx.client`, `ctx.db`, or any env var directly. It only gets a message channel. Every action is a request sent over that channel to Core, which validates capabilities before executing.

---

## Phase 1: Stop the Bleeding

> **Goal:** Remove the most dangerous surface areas without breaking existing plugins.
> **Risk:** Low — these are removals/restrictions, not new code paths.
> **Estimated effort:** 1-2 hours

### Task 1.1: Remove `process.env` from PluginContext

**File:** `core/PluginManager.js` — `buildContext()` method

**Current (line ~238):**
```js
config: {
    env: process.env,
},
```

**Change to:**
```js
config: {
    env: {}, // Phase 1: env removed. Plugins needing specific vars must declare them in manifest.
},
```

**Why:** No existing plugin uses `ctx.config.env`, so this is a safe removal. When the broker exists, plugins will declare needed env vars in their manifest and receive only those.

### Task 1.2: Add deprecation warnings for `ctx.client` and `ctx.db`

**File:** `core/PluginContext.js` — `build()` method

Instead of removing `client` and `db` immediately (which would break plugins), wrap them with Proxy-based deprecation warnings:

```js
// In build(), after constructing ctx:
if (ctx.client) {
    ctx.client = new Proxy(ctx.client, {
        get(target, prop) {
            console.warn(`[DEPRECATION] Plugin "${ctx.pluginName}" accessed ctx.client.${String(prop)} directly. This will be removed in the isolation upgrade. Use ctx.registerEvent() / ctx.registerCommand() instead.`);
            return target[prop];
        }
    });
}
if (ctx.db) {
    ctx.db = new Proxy(ctx.db, {
        get(target, prop) {
            console.warn(`[DEPRECATION] Plugin "${ctx.pluginName}" accessed ctx.db.${String(prop)} directly. This will be removed in the isolation upgrade. Use ctx.db.* RPC methods instead.`);
            return target[prop];
        }
    });
}
```

**Why:** This surfaces which plugins actually touch raw `client`/`db` so we know the true migration surface. Current audit shows none do, but third-party plugins might.

### Task 1.3: Create the capability manifest schema

**File:** New file `core/capabilities.js`

Define the capability categories and validation:

```js
const CAPABILITY_SCHEMA = {
    discord: {
        valid: [
            'SendMessages', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles',
            'AddReactions', 'ManageMessages', 'ManageRoles', 'BanMembers',
            'KickMembers', 'ModerateMembers', 'ManageChannels', 'ManageGuild',
            'ManageWebhooks', 'ViewChannel', 'ViewAuditLog',
        ],
    },
    storage: {
        valid: ['own-collection', 'read-profiles', 'write-profiles'],
    },
    network: {
        valid: ['outbound-http'],
    },
    ai: {
        valid: ['gemini-proxy'],
    },
    hooks: {
        valid: ['subscribe', 'emit'],
    },
};

function validateCapabilities(caps = {}) {
    const errors = [];
    for (const [category, values] of Object.entries(caps)) {
        if (!CAPABILITY_SCHEMA[category]) {
            errors.push(`Unknown capability category: "${category}"`);
            continue;
        }
        for (const value of values) {
            if (!CAPABILITY_SCHEMA[category].valid.includes(value)) {
                errors.push(`Unknown capability: "${category}.${value}"`);
            }
        }
    }
    return errors;
}
```

### Task 1.4: Add `capabilities` field to plugin.json schema

**File:** `core/PluginManager.js` — `loadPlugin()`

After loading the manifest, validate capabilities if present:

```js
const { validateCapabilities } = require('./capabilities');
const caps = plugin.manifest?.capabilities || {};
const capErrors = validateCapabilities(caps);
if (capErrors.length) {
    pluginState.lastError = `Invalid capabilities: ${capErrors.join(', ')}`;
    this.logger.warn(`${plugin.name} has invalid capabilities: ${capErrors.join(', ')}`);
}
```

### Task 1.5: Tests for Phase 1

**File:** New `test/capabilities.test.js`

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { validateCapabilities, CAPABILITY_SCHEMA } = require('../core/capabilities');

test('validateCapabilities returns empty for valid caps', () => {
    const errors = validateCapabilities({ discord: ['SendMessages'], storage: ['own-collection'] });
    assert.deepStrictEqual(errors, []);
});

test('validateCapabilities rejects unknown category', () => {
    const errors = validateCapabilities({ nuclear: ['launch'] });
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('nuclear'));
});

test('validateCapabilities rejects unknown value in valid category', () => {
    const errors = validateCapabilities({ discord: ['ObliterateServer'] });
    assert.ok(errors.length > 0);
});
```

---

## Phase 2: Build the RPC Protocol & Capability Broker

> **Goal:** Create the message protocol and the Core-side broker that validates and executes plugin requests.
> **Risk:** Medium — new code, but no existing code changes.
> **Estimated effort:** 4-6 hours

### Task 2.1: Define the RPC message protocol

**File:** New file `core/rpc/protocol.js`

```js
// Message types
const MSG = {
    // Plugin → Core
    REQUEST: 'rpc:request',
    // Core → Plugin
    RESPONSE: 'rpc:response',
    // Core → Plugin (event notifications)
    EVENT: 'rpc:event',
    // Core → Plugin (lifecycle)
    SHUTDOWN: 'rpc:shutdown',
};

// Request schema
// {
//     id: string,          // unique request ID for correlation
//     method: string,      // e.g. 'db.getPluginConfig', 'discord.sendMessage'
//     params: object,      // method-specific params
// }

// Response schema
// {
//     id: string,          // matches request id
//     ok: boolean,
//     result: any,         // if ok
//     error: string,       // if !ok
// }
```

### Task 2.2: Define the RPC method catalog

**File:** New file `core/rpc/methods.js`

Map every `ctx.*` method to an RPC method with its capability requirement:

```js
const RPC_METHODS = {
    // Database methods
    'db.getPluginConfig':     { capability: 'storage:own-collection', handler: 'getPluginConfig' },
    'db.updatePluginConfig':  { capability: 'storage:own-collection', handler: 'updatePluginConfig' },
    'db.getUserProfile':      { capability: 'storage:read-profiles',  handler: 'getUserProfile' },
    'db.updateUserProfile':   { capability: 'storage:write-profiles', handler: 'updateUserProfile' },
    'db.addXP':               { capability: 'storage:write-profiles', handler: 'addXP' },
    'db.getTopUsers':         { capability: 'storage:read-profiles',  handler: 'getTopUsers' },

    // Discord methods (future — not needed yet since ctx.client isn't used directly)
    'discord.sendMessage':     { capability: 'discord:SendMessages',       handler: 'sendMessage' },
    'discord.sendEmbed':       { capability: 'discord:EmbedLinks',         handler: 'sendEmbed' },
    'discord.addReaction':     { capability: 'discord:AddReactions',       handler: 'addReaction' },
    'discord.deleteMessage':   { capability: 'discord:ManageMessages',     handler: 'deleteMessage' },
    'discord.timeout':         { capability: 'discord:ModerateMembers',    handler: 'timeout' },
    'discord.kick':            { capability: 'discord:KickMembers',        handler: 'kick' },
    'discord.ban':             { capability: 'discord:BanMembers',         handler: 'ban' },

    // Hook methods
    'hooks.emit':              { capability: 'hooks:emit',     handler: 'emitHook' },
};
```

### Task 2.3: Build the Capability Broker

**File:** New file `core/rpc/broker.js`

```js
class CapabilityBroker {
    constructor({ db, client, hooks, logger }) {
        this.db = db;
        this.client = client;
        this.hooks = hooks;
        this.logger = logger;
        this.pluginCapabilities = new Map(); // pluginId → capabilities
    }

    /**
     * Register a plugin's declared capabilities.
     * Called once when the plugin is loaded.
     */
    registerCapabilities(pluginId, capabilities) {
        this.pluginCapabilities.set(pluginId, capabilities);
    }

    /**
     * Check if a plugin has a specific capability.
     */
    hasCapability(pluginId, requiredCap) {
        const [category, value] = requiredCap.split(':');
        const caps = this.pluginCapabilities.get(pluginId);
        if (!caps) return false;
        const pluginCaps = caps[category] || [];
        return pluginCaps.includes(value) || pluginCaps.includes('*');
    }

    /**
     * Handle an RPC request from a plugin worker.
     * Validates capability, executes the action, returns the result.
     */
    async handleRequest(pluginId, request) {
        const { id, method, params } = request;

        // Look up the method
        const methodDef = RPC_METHODS[method];
        if (!methodDef) {
            return { id, ok: false, error: `Unknown method: ${method}` };
        }

        // Check capability
        if (!this.hasCapability(pluginId, methodDef.capability)) {
            this.logger.warn(`Plugin ${pluginId} denied ${method} — missing capability ${methodDef.capability}`);
            return { id, ok: false, error: `Missing capability: ${methodDef.capability}` };
        }

        // Execute
        try {
            const result = await this.execute(methodDef.handler, params, pluginId);
            return { id, ok: true, result };
        } catch (error) {
            return { id, ok: false, error: error.message };
        }
    }

    /**
     * Execute the actual handler. This runs in the Core process.
     */
    async execute(handler, params, pluginId) {
        switch (handler) {
            case 'getPluginConfig':
                return await this.db.getPluginConfig(params.guildId, pluginId);
            case 'updatePluginConfig':
                return await this.db.updatePluginConfig(params.guildId, pluginId, params.data);
            case 'getUserProfile':
                return await this.db.getUserProfile(params.userId, params.guildId);
            case 'updateUserProfile':
                return await this.db.updateUserProfile(params.userId, params.guildId, params.data);
            case 'addXP':
                return await this.db.addXP(params.userId, params.guildId, params.amount, params.type, params.reason);
            case 'getTopUsers':
                return await this.db.getTopUsers(params.guildId, params.limit);
            // ... more handlers as needed
            default:
                throw new Error(`Handler not implemented: ${handler}`);
        }
    }
}
```

### Task 2.4: Build the worker-side RPC client

**File:** New file `core/rpc/worker-client.js`

This is what plugins will import instead of using `ctx.db` / `ctx.client` directly:

```js
class RpcClient {
    constructor(process) {
        this.process = process;
        this.pending = new Map(); // id → { resolve, reject, timer }
        this.idCounter = 0;
        this.eventListeners = new Map();

        // Listen for responses and events from Core
        this.process.on('message', (msg) => {
            if (msg.type === 'rpc:response') {
                const pending = this.pending.get(msg.id);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(msg.id);
                    if (msg.ok) pending.resolve(msg.result);
                    else pending.reject(new Error(msg.error));
                }
            } else if (msg.type === 'rpc:event') {
                const listeners = this.eventListeners.get(msg.event) || [];
                listeners.forEach(fn => fn(msg.payload));
            }
        });
    }

    /**
     * Send an RPC request to Core and wait for the response.
     */
    async request(method, params = {}, timeoutMs = 5000) {
        const id = `rpc-${++this.idCounter}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`RPC timeout: ${method}`));
            }, timeoutMs);

            this.pending.set(id, { resolve, reject, timer });
            this.process.send({ type: 'rpc:request', id, method, params });
        });
    }

    /**
     * Subscribe to events from Core.
     */
    on(event, handler) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(handler);
    }
}

module.exports = { RpcClient };
```

### Task 2.5: Tests for Phase 2

**File:** New `test/rpc-broker.test.js`

Test the broker in isolation (no real DB needed — mock it):

```js
const { test } = require('node:test');
const assert = require('node:assert');
// Import broker, mock db, test capability checking and request handling
```

---

## Phase 3: Worker Process Infrastructure

> **Goal:** Load plugins in `worker_threads` with IPC, using the RPC bridge.
> **Risk:** High — changes the core loading mechanism.
> **Estimated effort:** 6-8 hours

### Task 3.1: Create the worker bootstrap script

**File:** New file `core/rpc/worker-bootstrap.js`

This runs inside the worker thread. It:
1. Receives the plugin entry path and capabilities via `workerData`
2. Requires and executes the plugin's `load()` function
3. Provides a shim `ctx` that routes all calls through the RPC client

```js
const { parentPort, workerData } = require('worker_threads');
const { RpcClient } = require('./worker-client');

const rpc = new RpcClient(parentPort);

// Build a shim context that looks like the old ctx but routes through RPC
const ctx = {
    client: null, // Never available
    db: createDbProxy(rpc),
    scheduler: null, // Will be implemented via RPC later
    hooks: createHooksProxy(rpc),
    logger: createLoggerProxy(workerData.pluginName),
    registerCommand: (cmd) => rpc.request('plugin.registerCommand', { command: serializeCommand(cmd) }),
    registerEvent: (name, handler, opts) => {
        // Store handler locally, register the event name with Core
        rpc.request('plugin.registerEvent', { name, opts });
        rpc.on(`event:${name}`, handler);
    },
    defineModel: (name, schema) => rpc.request('plugin.defineModel', { name, schema: serializeSchema(schema) }),
    models: null,
    config: { env: {} },
};

// Load the plugin
const pluginModule = require(workerData.entryPath);
const loadFn = pluginModule.load || pluginModule.default || pluginModule;
loadFn(ctx).then(() => {
    parentPort.postMessage({ type: 'worker:ready' });
}).catch((err) => {
    parentPort.postMessage({ type: 'worker:error', error: err.message });
    process.exit(1);
});
```

### Task 3.2: Create the worker manager in Core

**File:** New file `core/rpc/worker-manager.js`

Manages the lifecycle of plugin worker threads:

```js
const { Worker } = require('worker_threads');
const path = require('path');

class WorkerManager {
    constructor({ broker, logger }) {
        this.broker = broker;
        this.logger = logger;
        this.workers = new Map(); // pluginId → Worker
    }

    /**
     * Spawn a worker for a plugin.
     */
    async spawnWorker(pluginId, entryPath, capabilities) {
        // Register capabilities with the broker
        this.broker.registerCapabilities(pluginId, capabilities);

        const worker = new Worker(path.join(__dirname, 'worker-bootstrap.js'), {
            workerData: { pluginId, entryPath },
            resourceLimits: {
                maxOldGenerationSizeMb: 128,
                maxYoungGenerationSizeMb: 32,
            },
        });

        // Route messages from worker to broker
        worker.on('message', async (msg) => {
            if (msg.type === 'rpc:request') {
                const response = await this.broker.handleRequest(pluginId, msg);
                worker.postMessage(response);
            }
        });

        worker.on('error', (err) => {
            this.logger.error(`Worker ${pluginId} error:`, err);
        });

        worker.on('exit', (code) => {
            this.logger.warn(`Worker ${pluginId} exited with code ${code}`);
            this.workers.delete(pluginId);
        });

        this.workers.set(pluginId, worker);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Worker ${pluginId} startup timeout`)), 10000);
            worker.once('message', (msg) => {
                clearTimeout(timeout);
                if (msg.type === 'worker:ready') resolve();
                else reject(new Error(msg.error));
            });
        });
    }

    /**
     * Terminate a plugin's worker.
     */
    async terminateWorker(pluginId) {
        const worker = this.workers.get(pluginId);
        if (worker) {
            await worker.terminate();
            this.workers.delete(pluginId);
        }
    }

    /**
     * Send an event to a worker.
     */
    sendEvent(pluginId, eventName, payload) {
        const worker = this.workers.get(pluginId);
        if (worker) {
            worker.postMessage({ type: 'rpc:event', event: eventName, payload });
        }
    }

    /**
     * Broadcast an event to all workers.
     */
    broadcastEvent(eventName, payload) {
        for (const worker of this.workers.values()) {
            worker.postMessage({ type: 'rpc:event', event: eventName, payload });
        }
    }
}
```

### Task 3.3: Integrate WorkerManager into PluginManager

**File:** `core/PluginManager.js`

Modify `loadPlugin()` to optionally use workers:

```js
// In PluginManager constructor:
this.workerManager = null; // Set later if isolation is enabled

// New method:
enableIsolation() {
    const { WorkerManager } = require('./rpc/worker-manager');
    const { CapabilityBroker } = require('./rpc/broker');
    this.broker = new CapabilityBroker({ db: this.db, client: this.client, hooks: this.hooks, logger: this.logger });
    this.workerManager = new WorkerManager({ broker: this.broker, logger: this.logger });
}

// Modified loadPlugin:
async loadPlugin(plugin) {
    // ... existing code to read manifest, init state ...

    if (this.workerManager && plugin.manifest?.capabilities) {
        // Isolated mode: load in worker thread
        await this.workerManager.spawnWorker(plugin.name, plugin.entryPath, plugin.manifest.capabilities);
    } else {
        // Legacy mode: load in-process (current behavior)
        const ctx = this.buildContext(plugin.name, logger);
        const pluginModule = require(plugin.entryPath);
        const loadFn = pluginModule.load || pluginModule.default || pluginModule;
        await loadFn(ctx);
    }
}
```

### Task 3.4: Feature flag for gradual rollout

**File:** `index.js`

```js
// In startADB(), after creating PluginManager:
if (process.env.PLUGIN_ISOLATION === 'true') {
    pluginManager.enableIsolation();
    console.log('🔒 Plugin isolation enabled — plugins run in worker threads');
}
```

### Task 3.5: Tests for Phase 3

- Unit test: WorkerManager spawns and communicates with a test worker
- Integration test: Simple test plugin loads in a worker and responds to RPC

---

## Phase 4: Resource Limits

> **Goal:** Enforce memory, CPU, and time limits on plugin workers.
> **Risk:** Low — additive, doesn't change existing behavior.
> **Estimated effort:** 2-3 hours

### Task 4.1: Configure resourceLimits in worker spawn

**File:** `core/rpc/worker-manager.js` — `spawnWorker()`

```js
const worker = new Worker(bootstrapPath, {
    workerData: { pluginId, entryPath },
    resourceLimits: {
        maxOldGenerationSizeMb: 128,   // Hard kill if exceeded
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4,
    },
});
```

### Task 4.2: Per-call wall-clock timeout

**File:** `core/rpc/broker.js` — `handleRequest()`

Already handled in the worker-client timeout, but add a Core-side timeout too:

```js
async handleRequest(pluginId, request) {
    const { id, method, params } = request;
    const timeoutMs = 5000; // 5 second max per RPC call

    return Promise.race([
        this._executeRequest(pluginId, request),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`RPC timeout: ${method} (>${timeoutMs}ms)`)), timeoutMs)
        ),
    ]);
}
```

### Task 4.3: Plugin-level resource tier in manifest

**File:** `core/capabilities.js`

```js
// Add to CAPABILITY_SCHEMA:
const RESOURCE_TIERS = {
    standard: { maxMemoryMb: 128, maxCpuMs: 5000 },
    elevated: { maxMemoryMb: 256, maxCpuMs: 10000 },  // Future: for plugins needing more
};
```

---

## Phase 5: Port Existing Plugins

> **Goal:** Migrate the 3 existing plugins to the new capability-declared, RPC-only interface.
> **Risk:** High — breaking change for plugin authors.
> **Estimated effort:** 4-6 hours

### Task 5.1: Create backward-compatible adapter

**File:** New file `core/rpc/plugin-adapter.js`

For gradual migration, provide an adapter that maps old `ctx` calls to RPC:

```js
function createLegacyAdapter(rpc, pluginId) {
    return {
        db: new Proxy({}, {
            get(target, prop) {
                return async (...args) => {
                    // Map method names to RPC calls
                    const methodMap = {
                        getPluginConfig: 'db.getPluginConfig',
                        updatePluginConfig: 'db.updatePluginConfig',
                        getUserProfile: 'db.getUserProfile',
                        updateUserProfile: 'db.updateUserProfile',
                        addXP: 'db.addXP',
                        getTopUsers: 'db.getTopUsers',
                    };
                    const rpcMethod = methodMap[prop];
                    if (!rpcMethod) throw new Error(`Unsupported db method: ${prop}`);
                    return rpc.request(rpcMethod, { [prop === 'getPluginConfig' || prop === 'updatePluginConfig' ? 'guildId' : 'userId']: args[0], ... });
                };
            }
        }),
        // ... similar for client, hooks, etc.
    };
}
```

### Task 5.2: Update `plugin.json` manifests with capabilities

For each existing plugin, add the `capabilities` field:

**adb-plugin-welcome:**
```json
{
    "capabilities": {
        "storage": ["own-collection"],
        "hooks": ["subscribe"]
    }
}
```

**adb-plugin-automod:**
```json
{
    "capabilities": {
        "storage": ["own-collection", "read-profiles", "write-profiles"],
        "discord": ["ManageMessages", "ModerateMembers"]
    }
}
```

**adb-plugin-autorole:**
```json
{
    "capabilities": {
        "storage": ["own-collection"],
        "discord": ["ManageRoles"],
        "hooks": ["subscribe"]
    }
}
```

### Task 5.3: Test each plugin in isolation

- Load each plugin with `PLUGIN_ISOLATION=true`
- Verify commands register
- Verify events fire
- Verify DB access works through RPC

---

## Phase 6: Static Scanning

> **Goal:** Automated AST scan on plugin submission to flag dangerous patterns.
> **Risk:** Low — additive, doesn't affect runtime.
> **Estimated effort:** 2-3 hours

### Task 6.1: Create the scanner

**File:** New file `core/scanner.js`

```js
const DANGEROUS_PATTERNS = [
    { pattern: /process\.env/, severity: 'critical', message: 'Accesses process.env — secrets may leak' },
    { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, severity: 'critical', message: 'Uses child_process — can execute arbitrary commands' },
    { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, severity: 'high', message: 'Uses fs module — can read/write files' },
    { pattern: /require\s*\(\s*['"]net['"]\s*\)/, severity: 'high', message: 'Uses net module — can open raw sockets' },
    { pattern: /require\s*\(\s*['"]http['"]\s*\)|require\s*\(\s*['"]https['"]\s*\)/, severity: 'medium', message: 'Uses HTTP module — should use approved outbound-http capability' },
    { pattern: /require\s*\(\s*['"]mongoose['"]\s*\)/, severity: 'high', message: 'Direct mongoose access — should use ctx.defineModel()' },
    { pattern: /\beval\s*\(/, severity: 'critical', message: 'Uses eval() — arbitrary code execution' },
    { pattern: /new\s+Function\s*\(/, severity: 'critical', message: 'Uses new Function() — arbitrary code execution' },
    { pattern: /require\s*\(\s*['"]vm['"]\s*\)/, severity: 'high', message: 'Uses vm module — can create isolated contexts' },
];

function scanPlugin(pluginPath) {
    const fs = require('fs');
    const path = require('path');
    const findings = [];

    function scanDir(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules') {
                scanDir(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                for (const { pattern, severity, message } of DANGEROUS_PATTERNS) {
                    if (pattern.test(content)) {
                        findings.push({ file: fullPath, severity, message });
                    }
                }
            }
        }
    }

    scanDir(pluginPath);
    return findings;
}

module.exports = { scanPlugin, DANGEROUS_PATTERNS };
```

### Task 6.2: Integrate scanner into install/update pipeline

**File:** `core/api/server.js`

Before installing or updating a plugin, scan it:

```js
// In POST /api/plugins/install, after npm install succeeds:
const { scanPlugin } = require('../scanner');
const pluginPath = path.join(process.cwd(), 'node_modules', packageName);
const findings = scanPlugin(pluginPath);
const critical = findings.filter(f => f.severity === 'critical');
if (critical.length) {
    // Roll back the install
    await runNpmUninstall(packageName, logger, emitLog);
    return reply.code(403).send({
        error: `Plugin contains ${critical.length} critical security issue(s)`,
        findings: critical,
    });
}
```

---

## Phase 7: Testing, Validation & Documentation

> **Goal:** Comprehensive test coverage and documentation.
> **Risk:** None — tests and docs only.
> **Estimated effort:** 3-4 hours

### Task 7.1: Unit tests

- `test/capabilities.test.js` — capability validation
- `test/rpc-broker.test.js` — broker request handling, capability checks
- `test/rpc-protocol.test.js` — message serialization
- `test/scanner.test.js` — pattern detection

### Task 7.2: Integration tests

- Worker spawn + RPC round-trip
- Plugin load in worker + command registration
- Plugin unload + worker termination

### Task 7.3: Documentation

**File:** Updated `CREATE-PLUGIN.md`

Document the new plugin development flow:
- How to declare capabilities in `plugin.json`
- How to use the RPC client instead of raw `ctx`
- What capabilities are needed for common operations
- How the security model works

**File:** New `docs/plugin-isolation.md`

Architecture document explaining:
- Why isolation exists
- How the Core/Broker/Worker model works
- How to migrate existing plugins
- Resource limits and tiers
- The static scanner and what it flags

---

## Migration Strategy

### Backward Compatibility

During the transition period:
1. **Plugins without `capabilities`** in their manifest load in legacy mode (in-process)
2. **Plugins with `capabilities`** load in isolated mode (worker thread)
3. A **feature flag** (`PLUGIN_ISOLATION=true`) controls whether isolation is active at all
4. A **legacy adapter** maps old `ctx` calls to RPC for gradual migration

### Rollout Order

1. Deploy Phase 1 (deprecation warnings) — observe which plugins are affected
2. Deploy Phase 2 (broker) — no behavioral change, just new code
3. Deploy Phase 3 (workers) — behind feature flag, default off
4. Enable for development/staging first
5. Enable for production once all core plugins are ported
6. Deploy Phase 6 (scanner) — catches bad actors in the marketplace

### Breaking Changes

- `ctx.client` removed (currently not used by any plugin ✅)
- `ctx.db` replaced with RPC proxy (used by welcome plugin — needs migration)
- `ctx.config.env` removed (currently not used by any plugin ✅)
- `ctx.scheduler` replaced with RPC (autorole uses `node-cron` directly — needs migration)

---

## File Manifest

### New files:
- `core/capabilities.js` — Capability schema + validation
- `core/rpc/protocol.js` — RPC message types + schemas
- `core/rpc/methods.js` — RPC method catalog (maps methods to capabilities)
- `core/rpc/broker.js` — CapabilityBroker (Core-side request handler)
- `core/rpc/worker-client.js` — RpcClient (Worker-side request sender)
- `core/rpc/worker-bootstrap.js` — Worker entry point (loads plugin, builds shim ctx)
- `core/rpc/worker-manager.js` — Worker lifecycle management
- `core/rpc/plugin-adapter.js` — Backward-compatible legacy adapter
- `core/scanner.js` — Static security scanner
- `test/capabilities.test.js`
- `test/rpc-broker.test.js`
- `test/scanner.test.js`
- `docs/plugin-isolation.md`

### Modified files:
- `core/PluginManager.js` — Remove env, add worker integration, feature flag
- `core/PluginContext.js` — Deprecation proxies for client/db
- `core/api/server.js` — Scanner integration on install/update
- `index.js` — Feature flag for `PLUGIN_ISOLATION`
- `plugins/adb-plugin-welcome/plugin.json` — Add capabilities
- `plugins/adb-plugin-automod/plugin.json` — Add capabilities
- `plugins/adb-plugin-autorole/plugin.json` — Add capabilities
- `CREATE-PLUGIN.md` — Document capabilities

---

## Decisions (confirmed)

| Decision | Choice |
|---|---|
| Default isolation tier | `worker_threads` with `resourceLimits` |
| Container tier | Deferred — leave `riskTier` field in manifest for future |
| Default capability set | Absolute zero — nothing until declared |
| Plugin updates | Re-approval required before reaching servers |
| Review model | Solo reviewer for now |
| Testing model | Hybrid: capped public trial + local docker-compose |
| Backward compatibility | Legacy adapter + feature flag during transition |
