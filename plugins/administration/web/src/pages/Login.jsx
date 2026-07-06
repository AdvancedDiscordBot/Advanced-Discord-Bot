import React from 'react';
import { colors, fonts, radius, fontSize } from '../theme';
import { ThemeToggle } from '../components/ThemeToggle';

function DiscordLogo({ size = 40 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 71 55"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g clipPath="url(#clip0)">
        <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.4407 45.4204 0.52526C44.7963 1.6352 44.1052 3.0833 43.6197 4.2216C38.1637 3.4046 32.6812 3.4046 27.3903 4.2216C26.9048 3.0581 26.1888 1.6352 25.5627 0.52526C25.5152 0.44279 25.4228 0.40059 25.3305 0.41542C20.2588 1.2894 15.4061 2.8192 10.8787 4.8978C10.8389 4.9147 10.8045 4.9429 10.7823 4.9792C1.57795 18.7307 -0.933341 32.1443 0.30724 45.4818C0.31424 45.5561 0.35587 45.6272 0.41487 45.6726C6.24176 50.049 11.8877 52.7155 17.4223 54.4823C17.5147 54.511 17.6129 54.4769 17.6719 54.4011C19.0063 52.5709 20.2015 50.6403 21.2328 48.6141C21.2948 48.4916 21.2348 48.3436 21.1089 48.2953C19.1703 47.5509 17.3227 46.6477 15.5487 45.5822C15.4088 45.4981 15.3979 45.2951 15.5279 45.1971C15.9022 44.9132 16.2765 44.6181 16.6351 44.3206C16.7001 44.2672 16.7904 44.2557 16.8678 44.2898C28.8316 49.8245 41.7731 49.8245 53.5839 44.2898C53.6613 44.2535 53.7515 44.266 53.8175 44.3185C54.1761 44.616 54.5504 44.9132 54.9257 45.1971C55.0557 45.2951 55.0457 45.4981 54.9048 45.5822C53.1317 46.666 51.2841 47.5509 49.3448 48.2939C49.2189 48.3422 49.1609 48.4916 49.2228 48.6141C50.2757 50.6382 51.4709 52.5688 52.7827 54.399C52.8407 54.4769 52.941 54.511 53.0334 54.4823C58.5809 52.7155 64.2269 50.049 70.0538 45.6726C70.1138 45.6272 70.1544 45.5582 70.1614 45.4839C71.6434 29.8995 67.6406 16.5946 60.1997 4.9792C60.1787 4.94071 60.1453 4.91089 60.1045 4.8978ZM23.5251 37.1493C20.0661 37.1493 17.2158 33.9525 17.2158 30.0463C17.2158 26.1401 20.0125 22.9432 23.5251 22.9432C27.0655 22.9432 29.8882 26.1672 29.8345 30.0463C29.8345 33.9525 27.0378 37.1493 23.5251 37.1493ZM47.4755 37.1493C44.0166 37.1493 41.1663 33.9525 41.1663 30.0463C41.1663 26.1401 43.9629 22.9432 47.4755 22.9432C51.016 22.9432 53.8386 26.1672 53.7849 30.0463C53.7849 33.9525 50.9882 37.1493 47.4755 37.1493Z" />
      </g>
    </svg>
  );
}

export function Login() {
  return (
    <div style={styles.container}>
      <div style={styles.themeToggleWrap}>
        <ThemeToggle />
      </div>
      <div style={styles.card}>
        <div style={styles.wordmark}>
          <span style={styles.seal} />
          <span style={styles.wordmarkText}>ADB</span>
        </div>
        <h1 style={styles.title}>
          Sign in to <em style={styles.emphasis}>your</em> dashboard
        </h1>
        <p style={styles.subtitle}>
          Manage your Discord bot with a calm, focused admin interface
        </p>
        <a
          href="/auth/discord"
          style={styles.button}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = 0.85)}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = 1)}
        >
          <DiscordLogo size={20} />
          <span>Sign in with Discord</span>
        </a>
        <p style={styles.disclaimer}>
          You must have Administrator or Manage Server permissions in a server
          where ADB is present.
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.cream,
    padding: '24px',
    position: 'relative',
  },
  themeToggleWrap: {
    position: 'absolute',
    top: '24px',
    right: '24px',
  },
  card: {
    background: colors.surface1,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`,
    padding: '48px',
    maxWidth: '440px',
    width: '100%',
    textAlign: 'center',
  },
  wordmark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '24px',
  },
  seal: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: colors.accent,
    flexShrink: 0,
  },
  wordmarkText: {
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 700,
    letterSpacing: '2px',
    color: colors.inkMuted,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.display}px`,
    fontWeight: 300,
    marginBottom: '12px',
    lineHeight: 1.15,
  },
  emphasis: {
    color: colors.accent,
    fontStyle: 'italic',
  },
  subtitle: {
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.body}px`,
    marginBottom: '32px',
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
    padding: '14px 24px',
    background: colors.accent,
    color: colors.creamOnAccent,
    borderRadius: `${radius.pill}px`,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 500,
    textDecoration: 'none',
    transition: 'opacity .18s',
    boxSizing: 'border-box',
  },
  disclaimer: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    marginTop: '24px',
    lineHeight: 1.5,
  },
};
