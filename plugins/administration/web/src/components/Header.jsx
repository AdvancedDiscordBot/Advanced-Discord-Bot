import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { getAvatarUrl } from '../utils/helpers';
import { LogOut } from 'lucide-react';
import { colors, fonts, fontSize } from '../theme';
import { ThemeToggle } from './ThemeToggle';

export function Header() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header style={styles.header}>
      <div style={styles.brand}>
        <span style={styles.seal} />
        <span style={styles.brandText}>ADB Admin</span>
      </div>
      <div style={styles.userInfo}>
        <ThemeToggle />
        <img
          src={getAvatarUrl(user.user)}
          alt="Avatar"
          style={styles.avatar}
        />
        <span style={styles.username}>
          {user.user.global_name || user.user.username}
        </span>
        <button onClick={logout} style={styles.logoutBtn} title="Logout">
          <LogOut size={18} />
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
    padding: '12px 24px',
    background: colors.surface1,
    borderBottom: `1.5px solid ${colors.hairline}`,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  seal: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: colors.accent,
    flexShrink: 0,
  },
  brandText: {
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 600,
    color: colors.ink,
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  avatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
  },
  username: {
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
  },
  logoutBtn: {
    background: 'transparent',
    border: 'none',
    color: colors.inkMuted,
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '4px',
    transition: 'color .18s, background .18s',
  },
};
