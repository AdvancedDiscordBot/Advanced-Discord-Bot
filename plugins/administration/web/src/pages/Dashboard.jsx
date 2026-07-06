import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/UI';
import { formatNumber, formatTime } from '../utils/helpers';
import { colors, fonts, radius, fontSize } from '../theme';
import {
  Users,
  Zap,
  MessageSquare,
  Clock,
  Ticket,
  Bot,
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
        />
        <StatCard
          icon={Zap}
          label="Total XP"
          value={formatNumber(stats.totalXp)}
          subValue="Server total"
        />
        <StatCard
          icon={MessageSquare}
          label="Messages"
          value={formatNumber(stats.totalMessages)}
          subValue="All time"
        />
        <StatCard
          icon={Clock}
          label="Voice Time"
          value={formatTime(stats.totalVoiceMinutes)}
          subValue="Total minutes"
        />
        <StatCard
          icon={Ticket}
          label="Tickets"
          value={stats.tickets?.total || 0}
          subValue={`${stats.tickets?.open || 0} open`}
        />
        <StatCard
          icon={Bot}
          label="AI Status"
          value={config?.aiEnabled ? 'Active' : 'Disabled'}
          subValue={`Mode: ${config?.aiMode || 'disabled'}`}
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
    background: colors.surface1,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`,
    padding: '16px',
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 400,
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
    borderBottom: `1.5px solid ${colors.hairline}`,
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
  },
  statValue: {
    color: colors.ink,
    fontWeight: 500,
  },
  enabled: {
    color: colors.successText,
    fontWeight: 500,
  },
  disabled: {
    color: colors.inkMuted,
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
    background: colors.cream,
    borderRadius: `${radius.control}px`,
  },
  rank: {
    color: colors.accent,
    fontWeight: 700,
    width: '32px',
  },
  userInfo: {
    flex: 1,
  },
  username: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 500,
    display: 'block',
  },
  level: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
  },
  xp: {
    color: colors.accent,
    fontWeight: 600,
  },
  empty: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    textAlign: 'center',
    padding: '16px',
  },
};
