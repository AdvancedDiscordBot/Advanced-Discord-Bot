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
} from 'lucide-react';

const navItems = [
  { to: '', icon: LayoutDashboard, label: 'Dashboard' },
  { to: 'ai', icon: Bot, label: 'AI Assistant' },
  { to: 'xp', icon: Zap, label: 'XP & Leveling' },
  { to: 'tickets', icon: Ticket, label: 'Tickets' },
  { to: 'economy', icon: Coins, label: 'Economy' },
  { to: 'birthdays', icon: Cake, label: 'Birthdays' },
  { to: 'antiraid', icon: ShieldAlert, label: 'Anti-Raid' },
  { to: 'logs', icon: Activity, label: 'Activity Logs' },
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
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === ''}
            style={({ isActive }) => ({
              ...styles.navLink,
              ...(isActive ? styles.navLinkActive : {}),
            })}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: '240px',
    background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
    borderRight: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  selectPrompt: {
    padding: '24px 16px',
    color: '#64748b',
    fontSize: '14px',
    textAlign: 'center',
  },
  guildInfo: {
    padding: '16px',
    borderBottom: '1px solid #334155',
  },
  guildName: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '4px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  guildId: {
    color: '#64748b',
    fontSize: '11px',
    fontFamily: 'monospace',
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
    borderRadius: '8px',
    color: '#94a3b8',
    textDecoration: 'none',
    fontSize: '14px',
    marginBottom: '2px',
    transition: 'all 0.2s',
  },
  navLinkActive: {
    background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
    color: '#ffffff',
  },
};
