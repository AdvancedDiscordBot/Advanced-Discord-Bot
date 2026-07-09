import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Puzzle, Settings } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

const NAV = [
  { to: '',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: 'plugins',  icon: Puzzle,          label: 'Plugins'   },
  { to: 'settings', icon: Settings,        label: 'Settings'  },
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
        <div style={styles.guildId}>{guild.id}</div>
      </div>

      <nav style={styles.nav}>
        <p style={styles.navSection}>CORE</p>
        {NAV.map(({ to, icon: Icon, label }) => {
          const path = to ? `/guild/${guild.id}/${to}` : `/guild/${guild.id}`;
          return (
            <NavLink
              key={to}
              to={path}
              end={to === ''}
              style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          );
        })}

        {/* Plugin-injected nav items land here in future */}
        <div id="plugin-nav-items" />
      </nav>

      <div style={styles.footer}>
        <div style={styles.hostingCard}>
          Managed hosting?{' '}
          <span style={styles.hostingHandle}>@deadindian</span> on Discord.
        </div>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: '220px',
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
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 600,
    marginBottom: '2px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  guildId: {
    color: colors.inkFaint,
    fontFamily: fonts.body,
    fontSize: '11px',
  },
  nav: {
    flex: 1,
    padding: '12px 8px',
    overflowY: 'auto',
  },
  navSection: {
    fontFamily: fonts.body,
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.12em',
    color: colors.inkFaint,
    padding: '0 8px',
    marginBottom: '4px',
    marginTop: '4px',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 10px',
    borderRadius: `${radius.control}px`,
    color: colors.ink2,
    textDecoration: 'none',
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 400,
    marginBottom: '2px',
    transition: 'background .15s, color .15s',
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
    lineHeight: 1.4,
  },
  hostingHandle: {
    color: colors.accent,
    fontWeight: 700,
  },
};
