import React from 'react';
import { colors, fonts, fontSize } from '../theme';

// App-wide footer. Holds the managed-hosting contact that used to sit in the sidebar.
export function Footer() {
  return (
    <footer style={styles.footer}>
      <span style={styles.left}>Advanced Discord Bot</span>
      <span style={styles.right}>
        Managed hosting?{' '}
        <a
          href="https://discord.com/users/deadindian"
          target="_blank"
          rel="noreferrer"
          style={styles.handle}
        >
          @deadindian
        </a>{' '}
        on Discord
      </span>
    </footer>
  );
}

const styles = {
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 20px',
    borderTop: `1.5px solid ${colors.hairline}`,
    background: colors.surface1,
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    flexWrap: 'wrap',
  },
  left: { fontWeight: 600, color: colors.ink2 },
  right: {},
  handle: {
    color: colors.accent,
    fontWeight: 700,
    textDecoration: 'none',
  },
};
