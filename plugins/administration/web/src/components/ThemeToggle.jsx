import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { colors, radius, applyTheme, getStoredTheme } from '../theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') || getStoredTheme() || 'light'
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const isDark = theme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle dark mode"
      style={styles.button}
    >
      {isDark ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

const styles = {
  button: {
    width: '32px',
    height: '32px',
    borderRadius: `${radius.control}px`,
    border: `1.5px solid ${colors.hairlineStrong}`,
    background: 'transparent',
    color: colors.inkMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color .18s, border-color .18s, background .18s',
  },
};
