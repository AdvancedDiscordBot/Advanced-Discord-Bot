import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Zap,
  Ticket,
  Coins,
  Cake,
  ShieldAlert,
  Activity,
  Settings,
  Puzzle,
} from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

const navItems = [
  { to: '', icon: LayoutDashboard, label: 'Dashboard' },
  { to: 'ai', icon: Bot, label: 'AI Assistant' },
  { to: 'xp', icon: Zap, label: 'XP & Leveling' },
  { to: 'tickets', icon: Ticket, label: 'Tickets' },
  { to: 'economy', icon: Coins, label: 'Economy' },
  { to: 'birthdays', icon: Cake, label: 'Birthdays' },
  { to: 'antiraid', icon: ShieldAlert, label: 'Anti-Raid' },
  { to: 'logs', icon: Activity, label: 'Activity Logs' },
  { to: 'plugins', icon: Puzzle, label: 'Plugins' },
  { to: 'settings', icon: Settings, label: 'Settings' },
];

export function Sidebar({ guild }) {
  if (!guild) {
    return (
      <aside style={styles.sidebar}>
        <div style={styles.selectPrompt}>Select a server to manage</div>
      </aside>
    );
  }

  return (
    <aside style={styles.sidebar}>
      <div style={styles.guildInfo}>
        <div style={styles.guildName}>{guild.name}</div>
        <div style={styles.guildId}>ID: {guild.id}</div>
      </div>
      <nav style={styles.nav}>
        {navItems.map((item) => {
          const path = item.to ? `/guild/${guild.id}/${item.to}` : `/guild/${guild.id}`;
          return (
          <NavLink
            key={item.to}
            to={path}
            end={item.to === ''}
            style={({ isActive }) => ({
              ...styles.navLink,
              ...(isActive ? styles.navLinkActive : {}),
            })}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
          );
        })}
      </nav>

      <div style={styles.footer}>
        <div style={styles.hostingCard}>
          Want managed hosting? DM{' '}
          <span style={styles.hostingHandle}>@deadindian</span> on Discord.
        </div>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: '240px',
    background: colors.surface1,
    borderRight: `1.5px solid ${colors.hairline}`,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  selectPrompt: {
    padding: '24px 16px',
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    textAlign: 'center',
  },
  guildInfo: {
    padding: '16px',
    borderBottom: `1.5px solid ${colors.hairline}`,
  },
  guildName: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 600,
    marginBottom: '4px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  guildId: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: '11px',
  },
  nav: {
    flex: 1,
    padding: '8px',
    overflowY: 'auto',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: `${radius.control}px`,
    color: colors.ink2,
    textDecoration: 'none',
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 400,
    marginBottom: '2px',
    transition: 'background .18s, color .18s',
  },
  navLinkActive: {
    background: colors.accentTint,
    color: colors.accentOnTint,
    fontWeight: 500,
  },
  footer: {
    padding: '12px',
    borderTop: `1.5px solid ${colors.hairline}`,
  },
  hostingCard: {
    background: colors.accentTint,
    borderRadius: `${radius.card}px`,
    padding: '10px 12px',
    color: colors.accentOnTint,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 400,
    lineHeight: 1.4,
  },
  hostingHandle: {
    color: colors.accent,
    fontWeight: 700,
  },
};
