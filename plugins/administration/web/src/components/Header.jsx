import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getAvatarUrl } from '../utils/helpers';
import { LogOut, Search, Eye, LayoutGrid, ChevronDown, ExternalLink } from 'lucide-react';
import { colors, fonts, fontSize, radius } from '../theme';
import { ThemeToggle } from './ThemeToggle';

// Cross-surface hop: the admin dashboard runs under the /dashboard router
// basename, the member portal under /me (see App.jsx). Router navigation would
// stay inside /dashboard, so we do a real navigation to switch surfaces. The
// ?preview=1 flag tells the member portal an admin is previewing, so it can
// offer a way back (see MemberApp).
function viewAsMember() {
  window.location.assign('/me?preview=1');
}

export function Header({ onOpenPalette, guild = null, plugins = [] }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!user) return null;

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  // Plugin dashboards a member could reach for this guild: enabled here and
  // shipping a web UI. Mirrors the Sidebar's plugin-UI links.
  const pluginDashboards = plugins.filter((p) => p.enabledForGuild && p.webUi);

  return (
    <header style={styles.header}>
      <div style={styles.left}>
        <div style={styles.brand}>
          <span style={styles.seal} />
          <span style={styles.brandText}>VAISH</span>
        </div>
      </div>

      <button
        onClick={onOpenPalette}
        style={styles.searchPill}
        title="Open command palette"
      >
        <Search size={13} style={{ flexShrink: 0 }} />
        <span style={styles.searchText}>Search…</span>
        <span style={styles.kbd}>{isMac ? '⌘K' : 'Ctrl K'}</span>
      </button>

      <div style={styles.right}>
        {guild && (
          <>
            <button
              onClick={viewAsMember}
              style={styles.viewAsBtn}
              title="Preview the dashboard as a regular member sees it"
            >
              <Eye size={14} />
              <span>View as member</span>
            </button>

            <div style={styles.menuWrap} onMouseLeave={() => setMenuOpen(false)}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                style={styles.viewAsBtn}
                title="Open a member or plugin dashboard"
              >
                <LayoutGrid size={14} />
                <span>Dashboards</span>
                <ChevronDown size={13} />
              </button>
              {menuOpen && (
                <div style={styles.menu}>
                  <button style={styles.menuItem} onClick={viewAsMember}>
                    <Eye size={14} />
                    <span>Member dashboard</span>
                  </button>
                  {pluginDashboards.length > 0 && <div style={styles.menuDivider} />}
                  {pluginDashboards.map((p) => (
                    <a
                      key={p.name}
                      href={`/plugin-ui/${p.name}/`}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.menuItem}
                    >
                      <ExternalLink size={13} />
                      <span style={{ flex: 1 }}>{p.displayName || p.name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <ThemeToggle />
        <img src={getAvatarUrl(user.user)} alt="" style={styles.avatar} />
        <span style={styles.username}>{user.user.global_name || user.user.username}</span>
        <button onClick={logout} style={styles.logoutBtn} title="Logout">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    height: '56px',
    background: colors.surface1,
    borderBottom: `1.5px solid ${colors.hairline}`,
    flexShrink: 0,
    gap: '16px',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  seal: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: colors.accent,
  },
  brandText: {
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 600,
    color: colors.ink,
    letterSpacing: '0.04em',
  },
  searchPill: {
    flex: 1,
    maxWidth: '360px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 14px',
    background: colors.cream,
    border: `1.5px solid ${colors.hairlineStrong}`,
    borderRadius: `${radius.pill}px`,
    cursor: 'pointer',
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    transition: 'border-color .15s, color .15s',
  },
  searchText: {
    flex: 1,
    textAlign: 'left',
  },
  kbd: {
    fontFamily: fonts.body,
    fontSize: '11px',
    color: colors.inkFaint,
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: '4px',
    padding: '1px 5px',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexShrink: 0,
  },
  viewAsBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 12px',
    borderRadius: `${radius.pill}px`,
    border: `1.5px solid ${colors.hairlineStrong}`,
    background: 'transparent',
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  menuWrap: {
    position: 'relative',
    display: 'inline-flex',
  },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    minWidth: '220px',
    background: colors.surface1,
    border: `1.5px solid ${colors.hairline}`,
    borderRadius: `${radius.control}px`,
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    padding: '6px',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: `${radius.control}px`,
    border: 'none',
    background: 'transparent',
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 400,
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'left',
    width: '100%',
  },
  menuDivider: {
    height: '1px',
    background: colors.hairline,
    margin: '4px 2px',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
  },
  username: {
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
  },
  logoutBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.inkMuted,
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '6px',
  },
};
