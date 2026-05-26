import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/UI';
import { formatNumber, formatTime } from '../utils/helpers';
import {
  Users,
  Zap,
  MessageSquare,
  Clock,
  Ticket,
  Bot,
  TrendingUp,
} from 'lucide-react';

export function Dashboard() {
  const { guildData } = useOutletContext();
  const { guild, config } = guildData || {};

  const { data: statsData } = useApi(
    guild?.id ? `/api/guild/${guild.id}/stats` : null
  );

  const { data: leaderboardData } = useApi(
    guild?.id ? `/api/guild/${guild.id}/leaderboard?limit=5` : null
  );

  if (!guild) return null;

  const stats = statsData || {};
  const leaderboard = leaderboardData?.users || [];

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Dashboard</h1>
      <p style={styles.pageSubtitle}>Overview of {guild.name}</p>

      <div style={styles.statsGrid}>
        <StatCard
          icon={Users}
          label="Members"
          value={formatNumber(stats.members)}
          subValue={`${formatNumber(stats.activeUsers)} active`}
          color="#10B981"
        />
        <StatCard
          icon={Zap}
          label="Total XP"
          value={formatNumber(stats.totalXp)}
          subValue="Server total"
          color="#6366F1"
        />
        <StatCard
          icon={MessageSquare}
          label="Messages"
          value={formatNumber(stats.totalMessages)}
          subValue="All time"
          color="#8B5CF6"
        />
        <StatCard
          icon={Clock}
          label="Voice Time"
          value={formatTime(stats.totalVoiceMinutes)}
          subValue="Total minutes"
          color="#F59E0B"
        />
        <StatCard
          icon={Ticket}
          label="Tickets"
          value={stats.tickets?.total || 0}
          subValue={`${stats.tickets?.open || 0} open`}
          color="#EC4899"
        />
        <StatCard
          icon={Bot}
          label="AI Status"
          value={config?.aiEnabled ? 'Active' : 'Disabled'}
          subValue={`Mode: ${config?.aiMode || 'disabled'}`}
          color={config?.aiEnabled ? '#10B981' : '#64748b'}
        />
      </div>

      <div style={styles.columns}>
        <div style={styles.column}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Quick Stats</h3>
            <div style={styles.quickStats}>
              <div style={styles.quickStatRow}>
                <span>XP Enabled</span>
                <span style={config?.xpEnabled ? styles.enabled : styles.disabled}>
                  {config?.xpEnabled ? 'Yes' : 'No'}
                </span>
              </div>
              <div style={styles.quickStatRow}>
                <span>XP per Message</span>
                <span style={styles.statValue}>{config?.xpPerMessage || 1}</span>
              </div>
              <div style={styles.quickStatRow}>
                <span>XP per Voice Minute</span>
                <span style={styles.statValue}>{config?.xpPerVoiceMinute || 2}</span>
              </div>
              <div style={styles.quickStatRow}>
                <span>Role Automation</span>
                <span style={config?.roleAutomation ? styles.enabled : styles.disabled}>
                  {config?.roleAutomation ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div style={styles.quickStatRow}>
                <span>Birthday System</span>
                <span style={config?.birthdayEnabled ? styles.enabled : styles.disabled}>
                  {config?.birthdayEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.column}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Top Users</h3>
            {leaderboard.length > 0 ? (
              <div style={styles.leaderboard}>
                {leaderboard.map((user, i) => (
                  <div key={user.userId} style={styles.leaderboardRow}>
                    <div style={styles.rank}>#{i + 1}</div>
                    <div style={styles.userInfo}>
                      <span style={styles.username}>{user.username || 'Unknown'}</span>
                      <span style={styles.level}>Level {user.level}</span>
                    </div>
                    <div style={styles.xp}>{formatNumber(user.totalXp)} XP</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.empty}>No user data yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '1200px',
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
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '16px',
  },
  column: {
    minWidth: 0,
  },
  card: {
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    border: '1px solid #334155',
    padding: '16px',
  },
  cardTitle: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '16px',
  },
  quickStats: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  quickStatRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #334155',
    color: '#94a3b8',
    fontSize: '14px',
  },
  statValue: {
    color: '#f1f5f9',
    fontWeight: 500,
  },
  enabled: {
    color: '#10B981',
    fontWeight: 500,
  },
  disabled: {
    color: '#64748b',
    fontWeight: 500,
  },
  leaderboard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  leaderboardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    background: '#0f172a',
    borderRadius: '8px',
  },
  rank: {
    color: '#6366F1',
    fontWeight: 700,
    width: '32px',
  },
  userInfo: {
    flex: 1,
  },
  username: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontWeight: 500,
    display: 'block',
  },
  level: {
    color: '#64748b',
    fontSize: '12px',
  },
  xp: {
    color: '#8B5CF6',
    fontWeight: 600,
  },
  empty: {
    color: '#64748b',
    textAlign: 'center',
    padding: '16px',
  },
};
