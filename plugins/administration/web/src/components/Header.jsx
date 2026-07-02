import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { getAvatarUrl } from '../utils/helpers';
import { LogOut, Shield } from 'lucide-react';

export function Header() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header style={styles.header}>
      <div style={styles.brand}>
        <Shield size={24} color="#6366F1" />
        <span style={styles.brandText}>ADB Admin</span>
      </div>
      <div style={styles.userInfo}>
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
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderBottom: '1px solid #334155',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  brandText: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#f1f5f9',
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
    color: '#e2e8f0',
    fontSize: '14px',
  },
  logoutBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '4px',
    transition: 'color 0.2s, background 0.2s',
  },
};
