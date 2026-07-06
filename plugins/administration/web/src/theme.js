// signature-ui design tokens
// Single source of truth for colors, fonts, radii and type scale.
// Do not hardcode hex values elsewhere — import from here instead.
//
// Colors resolve through CSS custom properties (see theme.css) so that
// flipping [data-theme="dark"] on <html> re-points every token live,
// everywhere, with no component changes needed.
import './theme.css';

export const colors = {
  cream: 'var(--cream)',
  surface1: 'var(--surface1)',
  surface2: 'var(--surface2)',

  ink: 'var(--ink)',
  ink2: 'var(--ink2)',
  inkMuted: 'var(--inkMuted)',
  inkFaint: 'var(--inkFaint)', // decorative only, never text

  accent: 'var(--accent)',
  accentTint: 'var(--accentTint)',
  accentOnTint: 'var(--accentOnTint)',
  creamOnAccent: 'var(--creamOnAccent)',

  pine: 'var(--pine)',
  pineStrong: 'var(--pineStrong)',
  pineTint: 'var(--pineTint)',
  pineOnTint: 'var(--pineOnTint)',

  success: 'var(--success)',
  successTint: 'var(--successTint)',
  successText: 'var(--successText)',

  warning: 'var(--warning)',
  warningTint: 'var(--warningTint)',
  warningText: 'var(--warningText)',

  danger: 'var(--danger)',
  dangerTint: 'var(--dangerTint)',
  dangerText: 'var(--dangerText)',

  hairline: 'var(--hairline)',
  hairlineStrong: 'var(--hairlineStrong)',
};

// Theme (light/dark) persistence + toggle helpers, used by ThemeToggle.
const THEME_KEY = 'adb-theme';

export function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore (private browsing, etc.)
  }
}

export function initTheme() {
  const stored = getStoredTheme();
  const preferred =
    stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', preferred);
  return preferred;
}

export const fonts = {
  display: "'Cormorant Garamond', serif",
  body: "'DM Sans', sans-serif",
};

export const radius = {
  control: 10,
  card: 16,
  pill: 100,
};

export const fontSize = {
  hero: 61,
  display: 39,
  heading: 25,
  title: 20,
  body: 16,
  meta: 14,
  caption: 13,
};

export const tokens = { colors, fonts, radius, fontSize };

export default tokens;
