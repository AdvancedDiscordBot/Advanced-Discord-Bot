import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Puzzle, Settings, RotateCcw, ExternalLink } from 'lucide-react';
import { colors, fonts, fontSize, radius } from '../theme';

function buildItems(guild) {
  const gid = guild?.id;
  const nav = gid ? [
    { id: 'go-dashboard', label: 'Dashboard',       icon: LayoutDashboard, action: 'nav', to: `/guild/${gid}`         },
    { id: 'go-plugins',   label: 'Plugins',         icon: Puzzle,          action: 'nav', to: `/guild/${gid}/plugins` },
    { id: 'go-settings',  label: 'Server Settings', icon: Settings,        action: 'nav', to: `/guild/${gid}/settings`},
  ] : [];

  const actions = [
    { id: 'restart', label: 'Restart Bot', icon: RotateCcw,    action: 'restart' },
    { id: 'github',  label: 'GitHub Repo', icon: ExternalLink, action: 'url', url: 'https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot' },
  ];

  return [...nav, ...actions];
}

function fuzzyMatch(query, label) {
  if (!query) return true;
  return label.toLowerCase().includes(query.toLowerCase());
}

export function CommandPalette({ open, onClose, guild }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const items = useMemo(() => buildItems(guild), [guild]);
  const filtered = useMemo(
    () => items.filter((item) => fuzzyMatch(query, item.label)),
    [items, query]
  );

  useEffect(() => {
    if (!open) { setQuery(''); setActive(0); return; }
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === 'Enter')     { e.preventDefault(); runItem(filtered[active]); }
      if (e.key === 'Escape')    { onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered, active, onClose]);

  useEffect(() => { setActive(0); }, [query]);

  function runItem(item) {
    if (!item) return;
    if (item.action === 'nav')     { navigate(item.to); onClose(); }
    if (item.action === 'url')     { window.open(item.url, '_blank', 'noopener'); onClose(); }
    if (item.action === 'restart') { fetch('/api/plugins/restart', { method: 'POST' }); onClose(); }
  }

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={styles.backdrop} />
      <div style={styles.modal} role="dialog" aria-label="Command palette" aria-modal="true">
        <div style={styles.inputWrap}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.inkMuted} strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            style={styles.input}
          />
          {query && (
            <button onClick={() => setQuery('')} style={styles.clearBtn}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        <div style={styles.results} role="listbox">
          {filtered.length === 0 ? (
            <div style={styles.noResults}>No results for "{query}"</div>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              const isActive = i === active;
              return (
                <button
                  key={item.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setActive(i)}
                  style={{ ...styles.resultItem, ...(isActive ? styles.resultItemActive : {}) }}
                >
                  <div style={{ ...styles.iconWrap, ...(isActive ? styles.iconWrapActive : {}) }}>
                    <Icon size={15} />
                  </div>
                  <span style={styles.resultLabel}>{item.label}</span>
                </button>
              );
            })
          )}
        </div>

        <div style={styles.footer}>
          <span style={styles.footerHint}><kbd style={styles.key}>↑↓</kbd> navigate</span>
          <span style={styles.footerHint}><kbd style={styles.key}>↵</kbd> select</span>
          <span style={styles.footerHint}><kbd style={styles.key}>Esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(30,26,20,0.55)',
    zIndex: 300, backdropFilter: 'blur(3px)',
  },
  modal: {
    position: 'fixed', top: '15vh', left: '50%',
    transform: 'translateX(-50%)',
    width: '540px', maxWidth: 'calc(100vw - 32px)',
    background: colors.cream,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairlineStrong}`,
    zIndex: 301, overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
  },
  inputWrap: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 16px',
    borderBottom: `1.5px solid ${colors.hairline}`,
  },
  input: {
    flex: 1, background: 'transparent', border: 'none', outline: 'none',
    color: colors.ink, fontFamily: fonts.body, fontSize: `${fontSize.body}px`,
  },
  clearBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: colors.inkMuted, padding: '2px',
    display: 'flex', alignItems: 'center', borderRadius: '4px',
  },
  results: {
    maxHeight: '340px', overflowY: 'auto', padding: '8px',
  },
  resultItem: {
    width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 12px', background: 'transparent', border: 'none',
    borderRadius: `${radius.control}px`, cursor: 'pointer',
    textAlign: 'left', transition: 'background .1s',
  },
  resultItemActive: { background: colors.surface1 },
  iconWrap: {
    width: '30px', height: '30px',
    borderRadius: `${radius.control - 2}px`,
    background: colors.surface2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: colors.inkMuted, flexShrink: 0,
  },
  iconWrapActive: { background: colors.accentTint, color: colors.accent },
  resultLabel: {
    color: colors.ink, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
  },
  noResults: {
    padding: '24px', textAlign: 'center',
    color: colors.inkMuted, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
  },
  footer: {
    display: 'flex', gap: '16px', padding: '10px 16px',
    borderTop: `1.5px solid ${colors.hairline}`,
    background: colors.surface1,
  },
  footerHint: {
    display: 'flex', alignItems: 'center', gap: '5px',
    color: colors.inkFaint, fontFamily: fonts.body, fontSize: '11px',
  },
  key: {
    fontFamily: fonts.body, fontSize: '10px',
    border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: '4px', padding: '1px 5px',
    color: colors.inkMuted, background: colors.cream,
  },
};
