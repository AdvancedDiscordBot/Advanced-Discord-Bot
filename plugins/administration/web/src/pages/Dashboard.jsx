import React, { useState, useEffect } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { Users, Wifi, Puzzle, Zap, Clock, LayoutGrid } from 'lucide-react';
import { colors, fonts, fontSize, radius } from '../theme';
import { EmptyState } from '../components/UI';

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <div style={styles.statTile}>
      <div style={styles.statIcon}>
        <Icon size={16} />
      </div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function ServerStatsWidget({ guildId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!guildId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/guild/${guildId}/server-stats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) { setData(json); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [guildId]);

  return (
    <div style={styles.widget}>
      <div style={styles.widgetHeader}>
        <div style={styles.widgetTitle}>
          <div style={styles.widgetDot} />
          Server Stats
        </div>
        {data && <span style={styles.liveBadge}>Live</span>}
      </div>

      {loading && (
        <div style={styles.widgetLoading}>
          <div style={styles.spinner} />
        </div>
      )}

      {error && !loading && (
        <div style={styles.widgetError}>Failed to load stats</div>
      )}

      {data && !loading && (
        <>
          <div style={styles.statsGrid}>
            <StatTile icon={Users} label="Members" value={data.members.toLocaleString()} />
            <StatTile icon={Wifi} label="Bot Ping" value={`${data.botPing}ms`} />
            <StatTile icon={Puzzle} label="Plugins" value={data.pluginCount} />
            <StatTile icon={Zap} label="Commands" value={data.commandCount} />
          </div>
          <div style={styles.uptimeRow}>
            <Clock size={13} style={{ color: colors.inkFaint, flexShrink: 0 }} />
            <span style={styles.uptimeLabel}>Uptime</span>
            <span style={styles.uptimeValue}>{formatUptime(data.uptime)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function AddWidgetPlaceholder() {
  return (
    <div style={{ ...styles.widget, ...styles.placeholderWidget }}>
      <EmptyState
        icon={<LayoutGrid size={32} />}
        title="Add a widget"
        body="Plugins can contribute widgets to your dashboard."
      />
    </div>
  );
}

export function Dashboard() {
  const { guildId } = useParams();
  const { guildData } = useOutletContext();
  const guild = guildData?.guild;

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Dashboard</h1>
        {guild && (
          <p style={styles.pageSubtitle}>
            {guild.name} · {(guild.memberCount || 0).toLocaleString()} members
          </p>
        )}
      </div>

      <div style={styles.widgetGrid}>
        <div style={styles.widgetSpan2}>
          <ServerStatsWidget guildId={guildId} />
        </div>
        <AddWidgetPlaceholder />
      </div>
    </div>
  );
}

const styles = {
  page: {
    maxWidth: '1100px',
  },
  pageHeader: {
    marginBottom: '24px',
  },
  pageTitle: {
    fontFamily: fonts.display,
    fontSize: `${fontSize.display}px`,
    fontWeight: 600,
    color: colors.ink,
    margin: 0,
    lineHeight: 1.1,
  },
  pageSubtitle: {
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    color: colors.inkMuted,
    margin: '4px 0 0',
  },
  widgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    alignItems: 'start',
  },
  widgetSpan2: {
    gridColumn: 'span 2',
  },
  widget: {
    background: colors.surface1,
    border: `1.5px solid ${colors.hairline}`,
    borderRadius: `${radius.card}px`,
    padding: '20px',
    overflow: 'hidden',
  },
  placeholderWidget: {
    minHeight: '220px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1.5px dashed ${colors.hairlineStrong}`,
    background: 'transparent',
  },
  widgetHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  widgetTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 600,
    color: colors.ink2,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  widgetDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: colors.accent,
    flexShrink: 0,
  },
  liveBadge: {
    fontFamily: fonts.body,
    fontSize: '10px',
    fontWeight: 600,
    color: colors.pineOnTint,
    background: colors.pineTint,
    borderRadius: `${radius.pill}px`,
    padding: '2px 8px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  widgetLoading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '120px',
  },
  spinner: {
    width: '28px',
    height: '28px',
    border: `2.5px solid ${colors.hairlineStrong}`,
    borderTopColor: colors.accent,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  widgetError: {
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    color: colors.dangerText,
    textAlign: 'center',
    padding: '24px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '16px',
  },
  statTile: {
    background: colors.cream,
    borderRadius: `${radius.control}px`,
    padding: '14px 16px',
    border: `1px solid ${colors.hairline}`,
  },
  statIcon: {
    width: '30px',
    height: '30px',
    borderRadius: `${radius.control - 2}px`,
    background: colors.accentTint,
    color: colors.accent,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '10px',
  },
  statValue: {
    fontFamily: fonts.display,
    fontSize: `${fontSize.heading}px`,
    fontWeight: 600,
    color: colors.ink,
    lineHeight: 1,
    marginBottom: '4px',
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: '11px',
    fontWeight: 600,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  uptimeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingTop: '12px',
    borderTop: `1px solid ${colors.hairline}`,
  },
  uptimeLabel: {
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    color: colors.inkMuted,
    flex: 1,
  },
  uptimeValue: {
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 600,
    color: colors.ink2,
  },
};
