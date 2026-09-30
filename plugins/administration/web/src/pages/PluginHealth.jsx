import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { useApiFetch } from "../hooks/useApi";
import { colors, fonts, fontSize, radius } from "../theme";

function formatUptime(ms) {
  if (!ms || ms < 1000) return "—";

  const seconds = Math.floor(ms / 1000);

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function StatusBadge({ status }) {
  const config = {
    healthy: {
      label: "Healthy",
      icon: CheckCircle2,
      color: colors.success || "#2e7d32",
    },
    starting: {
      label: "Starting",
      icon: Activity,
      color: colors.warning || "#b7791f",
    },
    crashed: {
      label: "Crashed",
      icon: AlertTriangle,
      color: colors.warning || "#b7791f",
    },
    quarantined: {
      label: "Quarantined",
      icon: XCircle,
      color: colors.danger || "#b42318",
    },
    stopped: {
      label: "Stopped",
      icon: XCircle,
      color: colors.inkMuted,
    },
  };

  const item = config[status] || {
    label: "Unknown",
    icon: AlertTriangle,
    color: colors.inkMuted,
  };

  const Icon = item.icon;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "5px 9px",
        borderRadius: `${radius.control}px`,
        background: `${item.color}18`,
        color: item.color,
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      <Icon size={13} />
      {item.label}
    </span>
  );
}

function SummaryCard({ label, value, description }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      {description && (
        <div style={styles.summaryDescription}>{description}</div>
      )}
    </div>
  );
}

export function PluginHealth() {
  const { request } = useApiFetch();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recovering, setRecovering] = useState(null);
  const [error, setError] = useState(null);

  const loadHealth = useCallback(async () => {
    try {
      setError(null);

      const result = await request("/api/plugins/health");

      setData(result);
    } catch (err) {
      setError(err.message || "Failed to load plugin health");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadHealth();

    const timer = setInterval(loadHealth, 10000);

    return () => clearInterval(timer);
  }, [loadHealth]);

  async function handleRefresh() {
    setRefreshing(true);

    try {
      await loadHealth();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRecover(pluginName) {
    if (
      !window.confirm(
        `Attempt to recover "${pluginName}" by reloading the plugin?`
      )
    ) {
      return;
    }

    setRecovering(pluginName);

    try {
      await request(`/api/plugins/${encodeURIComponent(pluginName)}/recover`, {
        method: "POST",
      });

      await loadHealth();
    } catch (err) {
      window.alert(`Recovery failed: ${err.message}`);
    } finally {
      setRecovering(null);
    }
  }

  if (loading) {
    return (
      <div style={styles.center}>
        <Activity size={28} />
        <span>Loading plugin diagnostics…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.page}>
        <div style={styles.errorBox}>
          <AlertTriangle size={18} />
          <div>
            <strong>Unable to load plugin diagnostics</strong>
            <div style={styles.errorText}>{error}</div>
          </div>
        </div>

        <button style={styles.primaryButton} onClick={loadHealth}>
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  if (!data?.isolationEnabled) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Plugin Health</h1>
            <p style={styles.subtitle}>
              Runtime diagnostics for isolated plugin workers.
            </p>
          </div>
        </div>

        <div style={styles.warningBox}>
          <AlertTriangle size={20} />
          <div>
            <strong>Plugin isolation is disabled</strong>
            <p style={{ margin: "6px 0 0" }}>
              Worker-level health monitoring is unavailable because
              PLUGIN_ISOLATION is disabled.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const summary = data.summary || {};
  const workers = Object.values(data.workers || {});

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Plugin Health</h1>
          <p style={styles.subtitle}>
            Monitor isolated plugin workers, crashes, restarts and runtime
            diagnostics.
          </p>
        </div>

        <button
          style={styles.secondaryButton}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            size={14}
            style={
              refreshing
                ? { animation: "spin 0.7s linear infinite" }
                : undefined
            }
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Overall status"
          value={summary.status || "unknown"}
          description="Current worker system state"
        />

        <SummaryCard
          label="Healthy"
          value={summary.healthy || 0}
          description={`${summary.total || 0} tracked workers`}
        />

        <SummaryCard
          label="Crashes"
          value={summary.crashed || 0}
          description="Workers currently reporting crashes"
        />

        <SummaryCard
          label="Quarantined"
          value={summary.quarantined || 0}
          description="Workers requiring manual recovery"
        />
      </div>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Workers</h2>
            <p style={styles.sectionSubtitle}>
              Live state and recent failure information.
            </p>
          </div>

          <span style={styles.timestamp}>
            Updated {new Date(data.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {workers.length === 0 ? (
          <div style={styles.empty}>
            No isolated plugin workers are currently registered.
          </div>
        ) : (
          <div style={styles.table}>
            <div style={styles.tableHeader}>
              <span>Plugin</span>
              <span>Status</span>
              <span>Uptime</span>
              <span>Crashes</span>
              <span>Restarts</span>
              <span>Last error</span>
              <span>Action</span>
            </div>

            {workers.map((worker) => (
              <div key={worker.pluginId} style={styles.tableRow}>
                <div>
                  <div style={styles.pluginName}>
                    {worker.pluginName || worker.pluginId}
                  </div>
                  <div style={styles.pluginId}>{worker.pluginId}</div>
                </div>

                <StatusBadge status={worker.status} />

                <span>{formatUptime(worker.uptime)}</span>

                <span>{worker.crashCount || 0}</span>

                <span>{worker.restartCount || 0}</span>

                <div style={styles.errorCell}>
                  {worker.lastError || "No recent errors"}
                </div>

                <div>
                  {(worker.status === "quarantined" ||
                    worker.status === "crashed") && (
                    <button
                      style={styles.recoverButton}
                      onClick={() => handleRecover(worker.pluginId)}
                      disabled={recovering === worker.pluginId}
                    >
                      <RotateCcw size={13} />
                      {recovering === worker.pluginId
                        ? "Recovering…"
                        : "Recover"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Capability violations</h2>
            <p style={styles.sectionSubtitle}>
              Runtime policy violations reported by the capability broker.
            </p>
          </div>
        </div>

        {(data.violations || []).length === 0 ? (
          <div style={styles.empty}>
            No capability violations recorded.
          </div>
        ) : (
          <div style={styles.violationList}>
            {data.violations.map((item, index) => (
              <div key={`${item.pluginId || "plugin"}-${index}`} style={styles.violation}>
                <AlertTriangle size={15} />

                <div style={{ flex: 1 }}>
                  <strong>{item.pluginId || item.plugin || "Unknown plugin"}</strong>

                  <div style={styles.violationMeta}>
                    {item.count || item.total || 1} violation(s)
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: {
    maxWidth: "1400px",
    margin: "0 auto",
    fontFamily: fonts.body,
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    marginBottom: "24px",
  },

  title: {
    margin: 0,
    color: colors.ink,
    fontSize: "30px",
    fontWeight: 600,
  },

  subtitle: {
    margin: "6px 0 0",
    color: colors.inkMuted,
    fontSize: `${fontSize.meta}px`,
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "24px",
  },

  summaryCard: {
    background: colors.surface1,
    border: `1px solid ${colors.hairline}`,
    borderRadius: `${radius.card}px`,
    padding: "18px",
  },

  summaryLabel: {
    color: colors.inkMuted,
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  summaryValue: {
    marginTop: "8px",
    color: colors.ink,
    fontSize: "25px",
    fontWeight: 600,
    textTransform: "capitalize",
  },

  summaryDescription: {
    marginTop: "4px",
    color: colors.inkFaint,
    fontSize: "12px",
  },

  section: {
    background: colors.surface1,
    border: `1px solid ${colors.hairline}`,
    borderRadius: `${radius.card}px`,
    marginBottom: "20px",
    overflow: "hidden",
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 20px",
    borderBottom: `1px solid ${colors.hairline}`,
  },

  sectionTitle: {
    margin: 0,
    color: colors.ink,
    fontSize: "18px",
    fontWeight: 600,
  },

  sectionSubtitle: {
    margin: "4px 0 0",
    color: colors.inkMuted,
    fontSize: "12px",
  },

  timestamp: {
    color: colors.inkFaint,
    fontSize: "12px",
  },

  table: {
    width: "100%",
    overflowX: "auto",
  },

  tableHeader: {
    display: "grid",
    gridTemplateColumns: "1.5fr .8fr .7fr .6fr .6fr 2fr .8fr",
    gap: "12px",
    padding: "12px 18px",
    color: colors.inkFaint,
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    borderBottom: `1px solid ${colors.hairline}`,
    minWidth: "1000px",
  },

  tableRow: {
    display: "grid",
    gridTemplateColumns: "1.5fr .8fr .7fr .6fr .6fr 2fr .8fr",
    gap: "12px",
    alignItems: "center",
    padding: "14px 18px",
    color: colors.ink2,
    fontSize: "13px",
    borderBottom: `1px solid ${colors.hairline}`,
    minWidth: "1000px",
  },

  pluginName: {
    color: colors.ink,
    fontWeight: 600,
  },

  pluginId: {
    marginTop: "3px",
    color: colors.inkFaint,
    fontSize: "11px",
  },

  errorCell: {
    color: colors.inkMuted,
    fontSize: "11px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  violationList: {
    display: "flex",
    flexDirection: "column",
  },

  violation: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px 18px",
    borderBottom: `1px solid ${colors.hairline}`,
    color: colors.warning || "#b7791f",
  },

  violationMeta: {
    marginTop: "3px",
    color: colors.inkMuted,
    fontSize: "11px",
  },

  empty: {
    padding: "28px",
    color: colors.inkMuted,
    textAlign: "center",
    fontSize: "13px",
  },

  center: {
    minHeight: "300px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    color: colors.inkMuted,
    fontFamily: fonts.body,
  },

  warningBox: {
    display: "flex",
    gap: "12px",
    padding: "18px",
    borderRadius: `${radius.card}px`,
    background: colors.accentTint,
    color: colors.ink2,
  },

  errorBox: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "18px",
    marginBottom: "14px",
    borderRadius: `${radius.card}px`,
    background: "#fff4ed",
    color: colors.ink2,
  },

  errorText: {
    marginTop: "5px",
    color: colors.inkMuted,
    fontSize: "12px",
  },

  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    border: "none",
    borderRadius: `${radius.control}px`,
    padding: "9px 13px",
    background: colors.accent,
    color: colors.creamOnAccent,
    cursor: "pointer",
    fontWeight: 600,
  },

  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: `${radius.control}px`,
    padding: "9px 13px",
    background: colors.surface1,
    color: colors.ink2,
    cursor: "pointer",
    fontWeight: 500,
  },

  recoverButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: `${radius.control}px`,
    padding: "6px 9px",
    background: colors.surface1,
    color: colors.ink2,
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 600,
  },
};
