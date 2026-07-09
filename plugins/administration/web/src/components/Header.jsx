import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { getAvatarUrl } from '../utils/helpers';
import { LogOut, Search } from 'lucide-react';
import { colors, fonts, fontSize, radius } from '../theme';
import { ThemeToggle } from './ThemeToggle';

export function Header({ onOpenPalette }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

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
