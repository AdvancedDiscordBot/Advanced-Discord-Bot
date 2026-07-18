/**
 * Metrics Collection for Plugin Isolation
 * 
 * Tracks resource usage, performance metrics, and operational statistics
 * for all plugins running in isolated workers.
 */

const { EventEmitter } = require('events');

class MetricsCollector extends EventEmitter {
    constructor() {
        super();
        
        // Plugin metrics storage
        this.pluginMetrics = new Map();
        
        // Global metrics
        this.globalMetrics = {
            totalPlugins: 0,
            activePlugins: 0,
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            totalExecutionTime: 0,
            averageExecutionTime: 0,
            peakMemoryMB: 0,
            systemUptime: Date.now()
        };
        
        // Time-series data for graphs (last 24 hours, 1-minute intervals)
        this.timeSeries = {
            timestamps: [],
            calls: [],
            successRate: [],
            memoryUsage: [],
            cpuUsage: []
        };
        
        // Alert thresholds
        this.alerts = {
            memoryThresholdMB: 100,
            callTimeoutThreshold: 5000,
            errorRateThreshold: 0.1, // 10%
            cpuUsageThreshold: 0.8 // 80%
        };
        
        // Collection interval
        this.collectionInterval = null;
    }
    
    /**
     * Start metrics collection
     * @param {number} intervalMs - Collection interval in milliseconds
     */
    start(intervalMs = 60000) {
        this.collectionInterval = setInterval(() => {
            this._collectSystemMetrics();
            this._updateGlobalMetrics();
            this._checkAlerts();
        }, intervalMs);
        // Background collection must not keep the process (or a test run) alive
        // on its own — it only matters while real work is in flight.
        if (typeof this.collectionInterval.unref === "function") {
            this.collectionInterval.unref();
        }

        console.log(`[MetricsCollector] Started with ${intervalMs}ms interval`);
        return this;
    }
    
    /**
     * Stop metrics collection
     */
    stop() {
        if (this.collectionInterval) {
            clearInterval(this.collectionInterval);
            this.collectionInterval = null;
        }
        console.log('[MetricsCollector] Stopped');
    }
    
    /**
     * Register a plugin for metrics tracking
     * @param {string} pluginId - Plugin identifier
     * @param {Object} limits - Resource limits for the plugin
     */
    registerPlugin(pluginId, limits = {}) {
        this.pluginMetrics.set(pluginId, {
            pluginId,
            limits,
            metrics: {
                totalCalls: 0,
                successfulCalls: 0,
                failedCalls: 0,
                timeoutCalls: 0,
                totalExecutionTime: 0,
                averageExecutionTime: 0,
                peakMemoryMB: 0,
                currentMemoryMB: 0,
                lastActivity: Date.now(),
                registrationTime: Date.now()
            },
            timeSeries: {
                timestamps: [],
                calls: [],
                memoryUsage: []
            }
        });
        
        this.globalMetrics.totalPlugins++;
        this.emit('plugin:registered', pluginId);
    }
    
    /**
     * Unregister a plugin
     * @param {string} pluginId - Plugin identifier
     */
    unregisterPlugin(pluginId) {
        this.pluginMetrics.delete(pluginId);
        this.globalMetrics.totalPlugins--;
        this.emit('plugin:unregistered', pluginId);
    }
    
    /**
     * Record a call completion
     * @param {string} pluginId - Plugin identifier
     * @param {string} action - Action performed
     * @param {number} duration - Execution time in ms
     * @param {boolean} success - Whether call succeeded
     * @param {string} error - Error message if failed
     */
    recordCall(pluginId, action, duration, success, error = null) {
        const pluginData = this.pluginMetrics.get(pluginId);
        if (!pluginData) return;
        
        // Update plugin metrics
        pluginData.metrics.totalCalls++;
        if (success) {
            pluginData.metrics.successfulCalls++;
        } else {
            pluginData.metrics.failedCalls++;
            if (error && error.includes('timed out')) {
                pluginData.metrics.timeoutCalls++;
            }
        }
        
        pluginData.metrics.totalExecutionTime += duration;
        pluginData.metrics.averageExecutionTime = 
            pluginData.metrics.totalExecutionTime / pluginData.metrics.totalCalls;
        pluginData.metrics.lastActivity = Date.now();
        
        // Update time series (every minute)
        const now = new Date();
        const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
        
        if (pluginData.timeSeries.timestamps.length === 0 || 
            pluginData.timeSeries.timestamps[pluginData.timeSeries.timestamps.length - 1] !== minuteKey) {
            pluginData.timeSeries.timestamps.push(minuteKey);
            pluginData.timeSeries.calls.push(1);
            pluginData.timeSeries.memoryUsage.push(pluginData.metrics.currentMemoryMB);
            
            // Keep only last 60 minutes
            if (pluginData.timeSeries.timestamps.length > 60) {
                pluginData.timeSeries.timestamps.shift();
                pluginData.timeSeries.calls.shift();
                pluginData.timeSeries.memoryUsage.shift();
            }
        } else {
            pluginData.timeSeries.calls[pluginData.timeSeries.calls.length - 1]++;
        }
        
        // Update global metrics
        this.globalMetrics.totalCalls++;
        if (success) {
            this.globalMetrics.successfulCalls++;
        } else {
            this.globalMetrics.failedCalls++;
        }
        this.globalMetrics.totalExecutionTime += duration;
        this.globalMetrics.averageExecutionTime = 
            this.globalMetrics.totalExecutionTime / this.globalMetrics.totalCalls;
        
        // Emit event for real-time monitoring
        this.emit('call:recorded', {
            pluginId,
            action,
            duration,
            success,
            error,
            timestamp: Date.now()
        });
    }
    
    /**
     * Update memory usage for a plugin
     * @param {string} pluginId - Plugin identifier
     * @param {number} memoryMB - Current memory usage in MB
     */
    updateMemoryUsage(pluginId, memoryMB) {
        const pluginData = this.pluginMetrics.get(pluginId);
        if (!pluginData) return;
        
        pluginData.metrics.currentMemoryMB = memoryMB;
        if (memoryMB > pluginData.metrics.peakMemoryMB) {
            pluginData.metrics.peakMemoryMB = memoryMB;
        }
        
        // Update global peak memory
        if (memoryMB > this.globalMetrics.peakMemoryMB) {
            this.globalMetrics.peakMemoryMB = memoryMB;
        }
        
        // Check memory alert threshold
        if (memoryMB > this.alerts.memoryThresholdMB) {
            this.emit('alert:memory', {
                pluginId,
                memoryMB,
                threshold: this.alerts.memoryThresholdMB,
                timestamp: Date.now()
            });
        }
    }
    
    /**
     * Get metrics for a specific plugin
     * @param {string} pluginId - Plugin identifier
     * @returns {Object|null} Plugin metrics
     */
    getPluginMetrics(pluginId) {
        return this.pluginMetrics.get(pluginId) || null;
    }
    
    /**
     * Get all plugin metrics
     * @returns {Object} All plugin metrics
     */
    getAllPluginMetrics() {
        const result = {};
        for (const [pluginId, data] of this.pluginMetrics) {
            result[pluginId] = data;
        }
        return result;
    }
    
    /**
     * Get global metrics
     * @returns {Object} Global metrics
     */
    getGlobalMetrics() {
        return { ...this.globalMetrics };
    }
    
    /**
     * Get time series data for a plugin
     * @param {string} pluginId - Plugin identifier
     * @param {number} minutes - Number of minutes of data to return
     * @returns {Object} Time series data
     */
    getPluginTimeSeries(pluginId, minutes = 60) {
        const pluginData = this.pluginMetrics.get(pluginId);
        if (!pluginData) return null;
        
        const cutoff = minutes;
        const startIndex = Math.max(0, pluginData.timeSeries.timestamps.length - cutoff);
        
        return {
            timestamps: pluginData.timeSeries.timestamps.slice(startIndex),
            calls: pluginData.timeSeries.calls.slice(startIndex),
            memoryUsage: pluginData.timeSeries.memoryUsage.slice(startIndex)
        };
    }
    
    /**
     * Get system health summary
     * @returns {Object} Health summary
     */
    getHealthSummary() {
        const successRate = this.globalMetrics.totalCalls > 0 
            ? this.globalMetrics.successfulCalls / this.globalMetrics.totalCalls 
            : 1;
        
        const errorRate = 1 - successRate;
        
        const memUsage = process.memoryUsage();
        const systemMemoryMB = memUsage.heapUsed / (1024 * 1024);
        
        return {
            status: errorRate < this.alerts.errorRateThreshold ? 'healthy' : 'degraded',
            uptime: Date.now() - this.globalMetrics.systemUptime,
            plugins: {
                total: this.globalMetrics.totalPlugins,
                active: this.globalMetrics.activePlugins
            },
            calls: {
                total: this.globalMetrics.totalCalls,
                successRate: successRate,
                errorRate: errorRate,
                averageTime: this.globalMetrics.averageExecutionTime
            },
            memory: {
                systemMB: systemMemoryMB,
                peakMB: this.globalMetrics.peakMemoryMB,
                thresholdMB: this.alerts.memoryThresholdMB
            },
            alerts: {
                memoryThreshold: this.alerts.memoryThresholdMB,
                errorRateThreshold: this.alerts.errorRateThreshold
            }
        };
    }
    
    /**
     * Collect system metrics (called periodically)
     * @private
     */
    _collectSystemMetrics() {
        const memUsage = process.memoryUsage();
        const memoryMB = memUsage.heapUsed / (1024 * 1024);
        
        // Update time series
        const now = new Date();
        const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
        
        if (this.timeSeries.timestamps.length === 0 || 
            this.timeSeries.timestamps[this.timeSeries.timestamps.length - 1] !== minuteKey) {
            this.timeSeries.timestamps.push(minuteKey);
            this.timeSeries.calls.push(this.globalMetrics.totalCalls);
            this.timeSeries.successRate.push(
                this.globalMetrics.totalCalls > 0 
                    ? this.globalMetrics.successfulCalls / this.globalMetrics.totalCalls 
                    : 1
            );
            this.timeSeries.memoryUsage.push(memoryMB);
            this.timeSeries.cpuUsage.push(process.cpuUsage().user / 1000); // Convert to ms
            
            // Keep only last 24 hours (1440 minutes)
            if (this.timeSeries.timestamps.length > 1440) {
                this.timeSeries.timestamps.shift();
                this.timeSeries.calls.shift();
                this.timeSeries.successRate.shift();
                this.timeSeries.memoryUsage.shift();
                this.timeSeries.cpuUsage.shift();
            }
        }
    }
    
    /**
     * Update global metrics
     * @private
     */
    _updateGlobalMetrics() {
        // Count active plugins (had activity in last 5 minutes)
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        let activeCount = 0;
        
        for (const [, data] of this.pluginMetrics) {
            if (data.metrics.lastActivity > fiveMinutesAgo) {
                activeCount++;
            }
        }
        
        this.globalMetrics.activePlugins = activeCount;
    }
    
    /**
     * Check alert conditions
     * @private
     */
    _checkAlerts() {
        const health = this.getHealthSummary();
        
        // Check error rate
        if (health.calls.errorRate > this.alerts.errorRateThreshold) {
            this.emit('alert:errorRate', {
                errorRate: health.calls.errorRate,
                threshold: this.alerts.errorRateThreshold,
                timestamp: Date.now()
            });
        }
        
        // Check system memory
        if (health.memory.systemMB > this.alerts.memoryThresholdMB) {
            this.emit('alert:systemMemory', {
                memoryMB: health.memory.systemMB,
                threshold: this.alerts.memoryThresholdMB,
                timestamp: Date.now()
            });
        }
    }
    
    /**
     * Generate summary report
     * @returns {Object} Summary report
     */
    generateReport() {
        const health = this.getHealthSummary();
        const pluginSummaries = [];
        
        for (const [pluginId, data] of this.pluginMetrics) {
            const successRate = data.metrics.totalCalls > 0
                ? data.metrics.successfulCalls / data.metrics.totalCalls
                : 1;
            
            pluginSummaries.push({
                pluginId,
                totalCalls: data.metrics.totalCalls,
                successRate: successRate,
                averageTime: data.metrics.averageExecutionTime,
                peakMemory: data.metrics.peakMemoryMB,
                lastActivity: data.metrics.lastActivity
            });
        }
        
        // Sort by total calls descending
        pluginSummaries.sort((a, b) => b.totalCalls - a.totalCalls);
        
        return {
            generatedAt: Date.now(),
            health,
            globalMetrics: this.getGlobalMetrics(),
            topPlugins: pluginSummaries.slice(0, 10),
            timeSeries: {
                timestamps: this.timeSeries.timestamps.slice(-60), // Last hour
                calls: this.timeSeries.calls.slice(-60),
                successRate: this.timeSeries.successRate.slice(-60),
                memoryUsage: this.timeSeries.memoryUsage.slice(-60)
            }
        };
    }
}

// Singleton instance
const metricsCollector = new MetricsCollector();

module.exports = {
    MetricsCollector,
    metricsCollector
};
