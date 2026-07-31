import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Puzzle, Settings, SlidersHorizontal, ExternalLink, ShieldCheck } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

// Core nav items, each gated on a dashboard permission. `perm: null` means
// always shown to anyone who can see the guild at all.
const NAV = [
  { to: '',         icon: LayoutDashboard, label: 'Dashboard', perm: null },
  { to: 'plugins',  icon: Puzzle,          label: 'Plugins',   perm: 'plugins.manage' },
  { to: 'roles',    icon: ShieldCheck,     label: 'Access',    perm: 'roles.manage' },
  { to: 'settings', icon: Settings,        label: 'Settings',  perm: 'guild.configure' },
];

export function Sidebar({ guild, plugins = [], access = null }) {
  if (!guild) {
    return (
      <aside style={styles.sidebar}>
        <div style={styles.selectPrompt}>Select a server to manage</div>
      </aside>
    );
  }

  const perms = new Set(access?.permissions || []);
  const can = (perm) => !perm || perms.has(perm);
  const navItems = NAV.filter((item) => can(item.perm));

  // A plugin shows in the nav only when it's enabled for THIS guild, has
  // something to configure, and the viewer may view it.
  const pluginNavItems = plugins.filter(
    (p) =>
      p.enabledForGuild &&
      (p.settingsSchema?.length > 0 || p.commandPermissions || p.webUi) &&
      can(`plugin.${p.name}.view`),
  );

  return (
    <aside style={styles.sidebar}>
      <div style={styles.guildInfo}>
        <div style={styles.guildName}>{guild.name}</div>
        <div style={styles.guildId}>{guild.id}</div>
      </div>

      <nav style={styles.nav}>
        <p style={styles.navSection}>CORE</p>
        {navItems.map(({ to, icon: Icon, label }) => {
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

        {pluginNavItems.length > 0 && (
          <>
            <p style={{ ...styles.navSection, marginTop: '16px' }}>PLUGINS</p>
            {pluginNavItems.map((p) => (
              <div key={p.name}>
                <NavLink
                  to={`/guild/${guild.id}/plugins/${p.name}/settings`}
                  style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
                >
                  <SlidersHorizontal size={16} />
                  <span style={{ flex: 1 }}>{p.displayName || p.name}</span>
                </NavLink>
                {p.webUi && (
                  <a
                    href={`/plugin-ui/${p.name}/`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...styles.navLink, paddingLeft: '32px', fontSize: '12px', color: colors.inkFaint, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <ExternalLink size={12} />
                    <span>{p.webUi.label || 'Open UI'}</span>
                  </a>
                )}
              </div>
            ))}
          </>
        )}
      </nav>
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
};
