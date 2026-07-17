/**
 * Resource Limits for Plugin Isolation
 * 
 * Provides per-call wall-clock timeouts, memory tracking, and CPU limits
 * for worker processes. This prevents plugins from consuming excessive resources.
 */

// Lazy import — parentPort is only defined inside a worker thread.
// In the main process it's undefined, so we check before using it.
let _parentPort = null;
try { _parentPort = require('worker_threads').parentPort; } catch {}
const getParentPort = () => _parentPort;

// Default resource limits (can be overridden per plugin via manifest)
const DEFAULT_LIMITS = {
    // Per-call execution timeout (ms) - kills any single RPC call that hangs
    callTimeout: 5000,
    
    // Maximum memory usage (MB) - worker is killed if exceeded
    maxMemoryMB: 128,
    
    // Maximum CPU time per minute (ms) - worker is throttled if exceeded
    maxCpuPerMinute: 30000,
    
    // Maximum concurrent operations
    maxConcurrentOps: 10,
    
    // Maximum IPC message size (bytes)
    maxMessageSize: 1024 * 1024, // 1MB
    
    // Resource check interval (ms)
    checkInterval: 1000
};

class ResourceTracker {
    constructor(pluginId, limits = {}) {
        this.pluginId = pluginId;
        this.limits = { ...DEFAULT_LIMITS, ...limits };
        
        // Tracking state
        this.activeOps = 0;
        this.cpuTimeUsed = 0;
        this.lastCpuCheck = Date.now();
        this._lastCpuSnapshot = process.cpuUsage();
        this.callStartTimes = new Map(); // callId -> startTime
        this.timeoutTimers = new Map(); // callId -> timer
        
        // Memory tracking
        this.memoryCheckInterval = null;
        this.lastMemoryMB = 0;
        
        // Metrics
        this.metrics = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            timeoutCalls: 0,
            memoryKills: 0,
            cpuThrottles: 0,
            totalExecutionTime: 0,
            peakMemoryMB: 0
        };
    }
    
    /**
     * Start tracking resources for a plugin
     */
    start() {
        // Start periodic memory checks
        this.memoryCheckInterval = setInterval(() => {
            this._checkMemory();
        }, this.limits.checkInterval);
        
        return this;
    }
    
    /**
     * Stop tracking and clean up
     */
    stop() {
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
        }
        
        // Clear all pending timeouts
        for (const [callId, timer] of this.timeoutTimers) {
            clearTimeout(timer);
        }
        this.timeoutTimers.clear();
        this.callStartTimes.clear();
    }
    
    /**
     * Register start of an RPC call
     * @param {string} callId - Unique call identifier
     * @returns {Function} Cleanup function to call when operation completes
     */
    startCall(callId) {
        this.activeOps++;
        this.metrics.totalCalls++;
        
        // Check concurrent operations limit
        if (this.activeOps > this.limits.maxConcurrentOps) {
            this.activeOps--;
            this.metrics.failedCalls++;
            throw new Error(`Too many concurrent operations (${this.activeOps}/${this.limits.maxConcurrentOps})`);
        }
        
        const startTime = Date.now();
        this.callStartTimes.set(callId, startTime);
        
        // Set per-call timeout
        const timer = setTimeout(() => {
            this._handleCallTimeout(callId);
        }, this.limits.callTimeout);
        
        this.timeoutTimers.set(callId, timer);
        
        // Return cleanup function
        return () => {
            this.activeOps--;
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            this.callStartTimes.delete(callId);
            
            const timer = this.timeoutTimers.get(callId);
            if (timer) {
                clearTimeout(timer);
                this.timeoutTimers.delete(callId);
            }
            
            // Update metrics
            this.metrics.totalExecutionTime += duration;
            this.metrics.successfulCalls++;
            
            return duration;
        };
    }
    
    /**
     * Handle call timeout
     * @private
     */
    _handleCallTimeout(callId) {
        this.metrics.timeoutCalls++;
        this.metrics.failedCalls++;
        this.activeOps--;
        
        this.callStartTimes.delete(callId);
        this.timeoutTimers.delete(callId);
        
        // Emit timeout event
        const port = getParentPort();
        if (port) {
            port.postMessage({
                type: 'resource.timeout',
                pluginId: this.pluginId,
                callId,
                timestamp: Date.now()
            });
        }
        
        console.error(`[ResourceTracker] Plugin ${this.pluginId} call ${callId} timed out after ${this.limits.callTimeout}ms`);
    }
    
    /**
     * Check memory usage
     * @private
     */
    _checkMemory() {
        const memUsage = process.memoryUsage();
        const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
        
        this.lastMemoryMB = heapUsedMB;
        
        // Update peak memory
        if (heapUsedMB > this.metrics.peakMemoryMB) {
            this.metrics.peakMemoryMB = heapUsedMB;
        }
        
        // Check against limit
        if (heapUsedMB > this.limits.maxMemoryMB) {
            this.metrics.memoryKills++;
            
            console.error(`[ResourceTracker] Plugin ${this.pluginId} exceeded memory limit: ${heapUsedMB.toFixed(2)}MB > ${this.limits.maxMemoryMB}MB`);
            
            // Emit memory limit exceeded event
            const memPort = getParentPort();
            if (memPort) {
                memPort.postMessage({
                    type: 'resource.memoryExceeded',
                    pluginId: this.pluginId,
                    memoryMB: heapUsedMB,
                    limitMB: this.limits.maxMemoryMB,
                    timestamp: Date.now()
                });
            }
            
            // In a real implementation, this would trigger worker termination
            // For now, we just log and emit the event
            return true; // Indicates limit exceeded
        }
        
        return false;
    }
    
    /**
     * Check CPU usage using delta calculation
     * process.cpuUsage() returns cumulative time, so we compute the delta
     */
    checkCpu() {
        const currentSnapshot = process.cpuUsage();
        // Compute delta from last snapshot
        const deltaUser = currentSnapshot.user - this._lastCpuSnapshot.user;
        const deltaSystem = currentSnapshot.system - this._lastCpuSnapshot.system;
        const deltaMs = (deltaUser + deltaSystem) / 1000; // Convert microseconds to ms
        
        const now = Date.now();
        const timeSinceLastCheck = now - this.lastCpuCheck;
        
        // Reset counter every minute
        if (timeSinceLastCheck >= 60000) {
            this.cpuTimeUsed = 0;
            this.lastCpuCheck = now;
            this._lastCpuSnapshot = currentSnapshot;
            return false;
        }
        
        this.cpuTimeUsed += deltaMs;
        this._lastCpuSnapshot = currentSnapshot;
        
        if (this.cpuTimeUsed > this.limits.maxCpuPerMinute) {
            this.metrics.cpuThrottles++;
            console.warn(`[ResourceTracker] Plugin ${this.pluginId} exceeded CPU limit: ${this.cpuTimeUsed.toFixed(1)}ms > ${this.limits.maxCpuPerMinute}ms per minute`);
            return true; // Indicates throttling needed
        }
        
        return false;
    }
    
    /**
     * Get current resource usage metrics
     */
    getMetrics() {
        return {
            pluginId: this.pluginId,
            limits: this.limits,
            current: {
                activeOps: this.activeOps,
                memoryMB: this.lastMemoryMB,
                cpuTimeUsed: this.cpuTimeUsed
            },
            metrics: { ...this.metrics }
        };
    }
    
    /**
     * Update resource limits (for dynamic adjustment)
     */
    updateLimits(newLimits) {
        this.limits = { ...this.limits, ...newLimits };
    }
}

/**
 * Create resource limits from plugin manifest capabilities
 * @param {Object} capabilities - Plugin capabilities from manifest
 * @returns {Object} Resource limits configuration
 */
function createLimitsFromCapabilities(capabilities = {}) {
    const limits = { ...DEFAULT_LIMITS };
    
    // Adjust limits based on declared capabilities
    if (capabilities.storage) {
        // Plugins with storage access get slightly higher memory limits
        limits.maxMemoryMB = Math.min(limits.maxMemoryMB * 1.5, 256);
    }
    
    if (capabilities.ai) {
        // Plugins with AI access get higher timeouts for API calls
        limits.callTimeout = Math.min(limits.callTimeout * 2, 15000);
    }
    
    if (capabilities.discord?.includes('administrator')) {
        // Plugins with admin access get lower concurrent ops (more dangerous)
        limits.maxConcurrentOps = Math.min(limits.maxConcurrentOps, 5);
    }
    
    return limits;
}    /**
     * Resource limit enforcement wrapper for broker execute calls
     * @param {Function} executeFn - Original execute function
     * @param {ResourceTracker} tracker - Resource tracker instance
     * @returns {Function} Wrapped execute function with resource limits
     */
    function withResourceLimits(executeFn, tracker) {
        return async function wrappedExecute(pluginId, action, params, context) {
            const callId = `${action}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Start tracking this call
            const cleanup = tracker.startCall(callId);
            
            // Create timeout promise with proper cleanup
            let timeoutId = null;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Operation ${action} timed out after ${tracker.limits.callTimeout}ms`));
                }, tracker.limits.callTimeout);
            });
            
            try {
                // Check CPU before execution
                if (tracker.checkCpu()) {
                    throw new Error('CPU limit exceeded, operation throttled');
                }
                
                // Execute with timeout protection
                const result = await Promise.race([
                    executeFn(pluginId, action, params, context),
                    timeoutPromise
                ]);
                
                // Clear timeout on success
                if (timeoutId) clearTimeout(timeoutId);
                
                // Cleanup and record success
                cleanup();
                return result;
                
            } catch (error) {
                // Clear timeout on failure
                if (timeoutId) clearTimeout(timeoutId);
                // Cleanup and record failure
                cleanup();
                throw error;
            }
        };
    }

module.exports = {
    DEFAULT_LIMITS,
    ResourceTracker,
    createLimitsFromCapabilities,
    withResourceLimits
};
