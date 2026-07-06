import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatDate } from '../utils/helpers';
import { colors, fonts, radius, fontSize } from '../theme';

export function ActivityLogs() {
  const { guildData } = useOutletContext();
  const { guild } = guildData || {};
  const guildId = guild?.id;

  const { data: logsData } = useApi(
    guildId ? `/api/guild/${guildId}/activity?days=7` : null
  );

  const transactions = logsData?.transactions || [];

  if (!guild) return null;

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Activity Logs</h1>
      <p style={styles.pageSubtitle}>
        Recent activity for {guild.name}
      </p>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>XP Transactions (Last 7 Days)</h3>
        {transactions.length > 0 ? (
          <div style={styles.logsList}>
            {transactions.map((tx) => (
              <div key={tx._id} style={styles.logRow}>
                <div style={styles.logIcon}>
                  {tx.amount >= 0 ? (
                    <ArrowUpRight size={18} color={colors.successText} />
                  ) : (
                    <ArrowDownRight size={18} color={colors.dangerText} />
                  )}
                </div>
                <div style={styles.logContent}>
                  <div style={styles.logTitle}>
                    {tx.type === 'message' && 'Message XP'}
                    {tx.type === 'voice' && 'Voice XP'}
                    {tx.type === 'bonus' && 'Bonus XP'}
                    {tx.type === 'penalty' && 'XP Penalty'}
                    {tx.type === 'manual' && 'Manual Adjustment'}
                  </div>
                  <div style={styles.logMeta}>
                    User: {tx.userId} | {formatDate(tx.createdAt)}
                  </div>
                </div>
                <div
                  style={{
                    ...styles.logAmount,
                    color: tx.amount >= 0 ? colors.successText : colors.dangerText,
                  }}
                >
                  {tx.amount >= 0 ? '+' : ''}{tx.amount} XP
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.empty}>
            <Activity size={32} color={colors.inkMuted} />
            <p>No activity recorded yet</p>
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Activity Summary</h3>
        <div style={styles.summary}>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Total Transactions</span>
            <span style={styles.summaryValue}>{transactions.length}</span>
          </div>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>XP Gained</span>
            <span style={{ ...styles.summaryValue, color: colors.successText }}>
              +{transactions.filter(t => t.amount >= 0).reduce((sum, t) => sum + t.amount, 0)}
            </span>
          </div>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Active Days</span>
            <span style={styles.summaryValue}>
              {new Set(transactions.map(t => new Date(t.createdAt).toDateString())).size}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '900px',
  },
  pageTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.heading}px`,
    fontWeight: 400,
    marginBottom: '4px',
  },
  pageSubtitle: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    marginBottom: '24px',
  },
  card: {
    background: colors.surface1,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`,
    padding: '16px',
    marginBottom: '16px',
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 400,
    marginBottom: '16px',
  },
  logsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  logRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    background: colors.cream,
    borderRadius: `${radius.control}px`,
    border: `1.5px solid ${colors.hairline}`,
  },
  logIcon: {
    width: '32px',
    height: '32px',
    borderRadius: `${radius.control}px`,
    background: colors.surface2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logContent: {
    flex: 1,
  },
  logTitle: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 500,
  },
  logMeta: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    marginTop: '2px',
  },
  logAmount: {
    fontFamily: fonts.body,
    fontWeight: 600,
    fontSize: `${fontSize.meta}px`,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '48px',
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    textAlign: 'center',
  },
  summary: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: `1.5px solid ${colors.hairline}`,
  },
  summaryLabel: {
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
  },
  summaryValue: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.body}px`,
    fontWeight: 600,
  },
};
