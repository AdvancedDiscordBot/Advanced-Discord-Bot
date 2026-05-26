import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Activity, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatDate } from '../utils/helpers';

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
                    <ArrowUpRight size={18} color="#10B981" />
                  ) : (
                    <ArrowDownRight size={18} color="#EF4444" />
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
                <div style={{ ...styles.logAmount, color: tx.amount >= 0 ? '#10B981' : '#EF4444' }}>
                  {tx.amount >= 0 ? '+' : ''}{tx.amount} XP
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.empty}>
            <Activity size={32} color="#64748b" />
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
            <span style={{ ...styles.summaryValue, color: '#10B981' }}>
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
    color: '#f1f5f9',
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '4px',
  },
  pageSubtitle: {
    color: '#64748b',
    fontSize: '14px',
    marginBottom: '24px',
  },
  card: {
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    border: '1px solid #334155',
    padding: '16px',
    marginBottom: '16px',
  },
  cardTitle: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
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
    padding: '12px',
    background: '#0f172a',
    borderRadius: '8px',
    border: '1px solid #334155',
  },
  logIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: '#1e293b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logContent: {
    flex: 1,
  },
  logTitle: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontWeight: 500,
  },
  logMeta: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '2px',
  },
  logAmount: {
    fontWeight: 600,
    fontSize: '14px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '48px',
    color: '#64748b',
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
    borderBottom: '1px solid #334155',
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: '14px',
  },
  summaryValue: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
  },
};
