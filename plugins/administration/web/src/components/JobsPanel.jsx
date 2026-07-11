import React, { useState } from 'react';
import { ChevronUp, ChevronDown, Terminal, CheckCircle2, XCircle, Loader2, X, RefreshCw } from 'lucide-react';
import { colors, fonts, fontSize, radius } from '../theme';
import { useJobs } from '../hooks/useJobs';

// Bottom-left activity dock, KDE-Discover style: a compact list of running /
// finished operations, each with a progress bar and an expandable CLI log.

export function JobsPanel() {
  const { jobs, clearDone, toggleExpand } = useJobs();
  const [collapsed, setCollapsed] = useState(false);

  if (!jobs.length) return null;

  const running = jobs.filter((j) => j.status === 'running').length;
  const anyDone = jobs.some((j) => j.status !== 'running');

  return (
    <div style={styles.dock}>
      <button style={styles.head} onClick={() => setCollapsed((c) => !c)}>
        <span style={styles.headLeft}>
          {running > 0
            ? <Loader2 size={14} style={styles.spin} />
            : <CheckCircle2 size={14} color={colors.success} />}
          <span style={styles.headTitle}>
            {running > 0 ? `${running} running` : 'Activity'}
          </span>
          <span style={styles.count}>{jobs.length}</span>
        </span>
        {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {!collapsed && (
        <div style={styles.list}>
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} onToggle={() => toggleExpand(job.id)} />
          ))}
          {anyDone && (
            <button style={styles.clear} onClick={clearDone}>
              <X size={12} /> Clear finished
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function JobRow({ job, onToggle }) {
  const { status, label, log = [], error, expanded } = job;

  const StatusIcon = status === 'running' ? Loader2
    : status === 'failed' ? XCircle
    : CheckCircle2;
  const statusColor = status === 'running' ? colors.accent
    : status === 'failed' ? colors.danger
    : colors.success;

  return (
    <div style={styles.row}>
      <div style={styles.rowHead}>
        <StatusIcon
          size={14}
          color={statusColor}
          style={status === 'running' ? styles.spin : undefined}
        />
        <span style={styles.label} title={label}>{label}</span>
        {log.length > 0 && (
          <button style={styles.logToggle} onClick={onToggle} title="Show output">
            <Terminal size={13} />
            {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        )}
      </div>

      <div style={styles.barTrack}>
        <div
          style={{
            ...styles.barFill,
            ...(status === 'running'
              ? styles.barIndeterminate
              : { width: '100%', background: statusColor, animation: 'none' }),
          }}
        />
      </div>

      {error && <div style={styles.errorText}>{error}</div>}

      {expanded && log.length > 0 && (
        <pre style={styles.log}>{log.join('')}</pre>
      )}

      {job.action === 'reload' && status !== 'running' && (
        <button style={styles.reloadBtn} onClick={() => window.location.reload()}>
          <RefreshCw size={13} />
          Reload page
        </button>
      )}
    </div>
  );
}

const styles = {
  dock: {
    position: 'fixed',
    left: 16,
    bottom: 16,
    width: 340,
    maxWidth: 'calc(100vw - 32px)',
    background: colors.surface1,
    border: `1.5px solid ${colors.hairlineStrong}`,
    borderRadius: `${radius.card}px`,
    boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
    zIndex: 60,
    overflow: 'hidden',
    fontFamily: fonts.body,
  },
  head: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: colors.ink,
  },
  headLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headTitle: { fontSize: `${fontSize.meta}px`, fontWeight: 600 },
  count: {
    fontSize: '11px',
    fontWeight: 600,
    color: colors.accentOnTint,
    background: colors.accentTint,
    borderRadius: `${radius.pill}px`,
    padding: '1px 7px',
  },
  list: {
    borderTop: `1.5px solid ${colors.hairline}`,
    padding: '8px',
    maxHeight: '46vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    background: colors.surface2,
    border: `1px solid ${colors.hairline}`,
    borderRadius: `${radius.control}px`,
    padding: '8px 9px',
  },
  rowHead: { display: 'flex', alignItems: 'center', gap: 7 },
  label: {
    flex: 1,
    fontSize: `${fontSize.caption}px`,
    color: colors.ink,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  logToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    background: 'transparent',
    border: 'none',
    color: colors.inkMuted,
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 6,
  },
  barTrack: {
    marginTop: 7,
    height: 4,
    borderRadius: 2,
    background: colors.hairline,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    background: colors.accent,
  },
  barIndeterminate: {
    width: '40%',
    background: colors.accent,
    animation: 'jobbar 1.1s ease-in-out infinite',
  },
  errorText: {
    marginTop: 6,
    fontSize: '11px',
    color: colors.dangerText,
  },
  log: {
    marginTop: 8,
    marginBottom: 0,
    maxHeight: 160,
    overflow: 'auto',
    background: '#12140f',
    color: '#d7dbc8',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    lineHeight: 1.45,
    padding: '8px 9px',
    borderRadius: 8,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  spin: { animation: 'spin 1s linear infinite' },
  clear: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    background: 'transparent',
    border: 'none',
    color: colors.inkMuted,
    cursor: 'pointer',
    fontSize: '11px',
    fontFamily: fonts.body,
    padding: '2px 4px',
  },
  reloadBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    padding: '6px 14px',
    borderRadius: `${radius.pill}px`,
    border: `1.5px solid ${colors.accent}`,
    background: colors.accentTint,
    color: colors.accentOnTint,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
