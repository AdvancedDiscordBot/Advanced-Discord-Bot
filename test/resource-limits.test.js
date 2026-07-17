const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { ResourceTracker, createLimitsFromCapabilities, withResourceLimits, DEFAULT_LIMITS } = require("../core/rpc/resource-limits");
const { MetricsCollector, metricsCollector } = require("../core/rpc/metrics");

describe("ResourceTracker", () => {
    let tracker;
    
    before(() => {
        tracker = new ResourceTracker("test-plugin", { callTimeout: 100, maxMemoryMB: 64 });
    });
    
    after(() => {
        if (tracker) tracker.stop();
    });
    
    it("should create tracker with default limits", () => {
        const defaultTracker = new ResourceTracker("plugin1");
        assert.equal(defaultTracker.limits.callTimeout, DEFAULT_LIMITS.callTimeout);
        assert.equal(defaultTracker.limits.maxMemoryMB, DEFAULT_LIMITS.maxMemoryMB);
        defaultTracker.stop();
    });
    
    it("should create tracker with custom limits", () => {
        assert.equal(tracker.limits.callTimeout, 100);
        assert.equal(tracker.limits.maxMemoryMB, 64);
    });
    
    it("should track active operations", () => {
        assert.equal(tracker.activeOps, 0);
        
        const cleanup = tracker.startCall("call1");
        assert.equal(tracker.activeOps, 1);
        
        cleanup();
        assert.equal(tracker.activeOps, 0);
    });
    
    it("should enforce concurrent operations limit", () => {
        const limitedTracker = new ResourceTracker("plugin2", { maxConcurrentOps: 2 });
        
        limitedTracker.startCall("call1");
        limitedTracker.startCall("call2");
        
        assert.throws(() => {
            limitedTracker.startCall("call3");
        }, /Too many concurrent operations/);
        
        limitedTracker.stop();
    });
    
    it("should track call metrics", () => {
        const freshTracker = new ResourceTracker("metric-plugin", { callTimeout: 100 });
        
        const cleanup = freshTracker.startCall("metric-test");
        cleanup();
        
        const metrics = freshTracker.getMetrics();
        assert.equal(metrics.metrics.totalCalls, 1);
        assert.equal(metrics.metrics.successfulCalls, 1);
        
        freshTracker.stop();
    });
    
    it("should update limits dynamically", () => {
        tracker.updateLimits({ callTimeout: 200 });
        assert.equal(tracker.limits.callTimeout, 200);
        
        // Reset
        tracker.updateLimits({ callTimeout: 100 });
    });
    
    it("should return metrics with correct structure", () => {
        const metrics = tracker.getMetrics();
        assert.ok(metrics.pluginId);
        assert.ok(metrics.limits);
        assert.ok(metrics.current);
        assert.ok(metrics.metrics);
        assert.equal(metrics.pluginId, "test-plugin");
    });
});

describe("createLimitsFromCapabilities", () => {
    it("should return default limits for empty capabilities", () => {
        const limits = createLimitsFromCapabilities({});
        assert.equal(limits.maxMemoryMB, DEFAULT_LIMITS.maxMemoryMB);
        assert.equal(limits.callTimeout, DEFAULT_LIMITS.callTimeout);
    });
    
    it("should increase memory limits for storage plugins", () => {
        const limits = createLimitsFromCapabilities({ storage: ["own-collection"] });
        assert.ok(limits.maxMemoryMB > DEFAULT_LIMITS.maxMemoryMB);
        assert.ok(limits.maxMemoryMB <= 256);
    });
    
    it("should increase timeout for AI plugins", () => {
        const limits = createLimitsFromCapabilities({ ai: ["gemini-proxy"] });
        assert.ok(limits.callTimeout > DEFAULT_LIMITS.callTimeout);
        assert.ok(limits.callTimeout <= 15000);
    });
    
    it("should decrease concurrent ops for admin plugins", () => {
        const limits = createLimitsFromCapabilities({ discord: ["administrator"] });
        assert.ok(limits.maxConcurrentOps <= 5);
    });
    
    it("should handle multiple capabilities", () => {
        const limits = createLimitsFromCapabilities({
            storage: ["own-collection"],
            ai: ["gemini-proxy"],
            discord: ["SendMessages"]
        });
        // Storage + AI should increase both memory and timeout
        assert.ok(limits.maxMemoryMB > DEFAULT_LIMITS.maxMemoryMB);
        assert.ok(limits.callTimeout > DEFAULT_LIMITS.callTimeout);
    });
});

describe("MetricsCollector", () => {
    let collector;
    
    before(() => {
        collector = new MetricsCollector();
    });
    
    after(() => {
        if (collector) collector.stop();
    });
    
    it("should register and unregister plugins", () => {
        collector.registerPlugin("plugin1", { maxMemoryMB: 128 });
        const metrics = collector.getPluginMetrics("plugin1");
        assert.ok(metrics);
        assert.equal(metrics.pluginId, "plugin1");
        
        collector.unregisterPlugin("plugin1");
        assert.equal(collector.getPluginMetrics("plugin1"), null);
    });
    
    it("should record calls", () => {
        collector.registerPlugin("plugin2");
        
        collector.recordCall("plugin2", "db.getPluginConfig", 100, true);
        collector.recordCall("plugin2", "db.updatePluginConfig", 200, false, "Test error");
        
        const metrics = collector.getPluginMetrics("plugin2");
        assert.equal(metrics.metrics.totalCalls, 2);
        assert.equal(metrics.metrics.successfulCalls, 1);
        assert.equal(metrics.metrics.failedCalls, 1);
        
        collector.unregisterPlugin("plugin2");
    });
    
    it("should track timeout calls", () => {
        collector.registerPlugin("plugin3");
        
        collector.recordCall("plugin3", "db.test", 5000, false, "Operation timed out");
        
        const metrics = collector.getPluginMetrics("plugin3");
        assert.equal(metrics.metrics.timeoutCalls, 1);
        
        collector.unregisterPlugin("plugin3");
    });
    
    it("should update memory usage", () => {
        collector.registerPlugin("plugin4");
        
        collector.updateMemoryUsage("plugin4", 50);
        let metrics = collector.getPluginMetrics("plugin4");
        assert.equal(metrics.metrics.currentMemoryMB, 50);
        assert.equal(metrics.metrics.peakMemoryMB, 50);
        
        collector.updateMemoryUsage("plugin4", 75);
        metrics = collector.getPluginMetrics("plugin4");
        assert.equal(metrics.metrics.currentMemoryMB, 75);
        assert.equal(metrics.metrics.peakMemoryMB, 75);
        
        // Peak should not decrease
        collector.updateMemoryUsage("plugin4", 60);
        metrics = collector.getPluginMetrics("plugin4");
        assert.equal(metrics.metrics.peakMemoryMB, 75);
        
        collector.unregisterPlugin("plugin4");
    });
    
    it("should get global metrics", () => {
        const global = collector.getGlobalMetrics();
        assert.ok(typeof global.totalPlugins === 'number');
        assert.ok(typeof global.totalCalls === 'number');
        assert.ok(typeof global.successfulCalls === 'number');
        assert.ok(typeof global.systemUptime === 'number');
    });
    
    it("should get health summary", () => {
        const health = collector.getHealthSummary();
        assert.ok(health.status);
        assert.ok(health.uptime);
        assert.ok(health.plugins);
        assert.ok(health.calls);
        assert.ok(health.memory);
        assert.ok(['healthy', 'degraded'].includes(health.status));
    });
    
    it("should generate report", () => {
        collector.registerPlugin("report-plugin");
        collector.recordCall("report-plugin", "test", 100, true);
        
        const report = collector.generateReport();
        assert.ok(report.generatedAt);
        assert.ok(report.health);
        assert.ok(report.globalMetrics);
        assert.ok(Array.isArray(report.topPlugins));
        
        collector.unregisterPlugin("report-plugin");
    });
    
    it("should handle time series data", () => {
        collector.registerPlugin("ts-plugin");
        
        // Record some calls to generate time series
        for (let i = 0; i < 5; i++) {
            collector.recordCall("ts-plugin", `call${i}`, 100, true);
        }
        
        const timeSeries = collector.getPluginTimeSeries("ts-plugin", 60);
        assert.ok(timeSeries);
        assert.ok(Array.isArray(timeSeries.timestamps));
        assert.ok(Array.isArray(timeSeries.calls));
        assert.ok(Array.isArray(timeSeries.memoryUsage));
        
        collector.unregisterPlugin("ts-plugin");
    });
});

describe("withResourceLimits", () => {
    it("should wrap execute function with resource limits", async () => {
        const tracker = new ResourceTracker("test", { callTimeout: 100 });
        tracker.start();
        
        const mockExecute = async (pluginId, action, params, context) => {
            return { success: true };
        };
        
        const wrappedExecute = withResourceLimits(mockExecute, tracker);
        
        const result = await wrappedExecute("test", "test.action", {}, {});
        assert.ok(result.success);
        
        tracker.stop();
    });
    
    it("should handle execution errors", async () => {
        const tracker = new ResourceTracker("test", { callTimeout: 100 });
        tracker.start();
        
        const mockExecute = async () => {
            throw new Error("Test error");
        };
        
        const wrappedExecute = withResourceLimits(mockExecute, tracker);
        
        await assert.rejects(
            async () => await wrappedExecute("test", "test.action", {}, {}),
            /Test error/
        );
        
        tracker.stop();
    });
});
