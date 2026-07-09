import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Server, Github, Shield, RotateCcw, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

export function GuildSettings() {
  const { guildData } = useOutletContext();
  const { guild, config } = guildData || {};
  const { user } = useAuth();
  const [isOwner, setIsOwner] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    async function checkOwner() {
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          setIsOwner(data.isOwner || false);
        }
      } catch {}
    }
    checkOwner();
  }, [user]);

  async function handleRestart() {
    if (!window.confirm('Restart the bot? This will briefly disconnect all services.')) return;
    setRestarting(true);
    try {
      const res = await fetch('/api/plugins/restart', { method: 'POST' });
      if (!res.ok) alert('Failed to restart. Only bot owners can do this.');
    } catch {
      alert('Failed to restart bot.');
    } finally {
      setRestarting(false);
    }
  }

  function handleCopyConfig() {
    navigator.clipboard.writeText(JSON.stringify(config, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!guild) return null;

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>Settings</h1>
        <p style={s.pageSubtitle}>{guild.name}</p>
      </div>

      <div style={s.stack}>
        {/* Server info */}
        <section style={s.card}>
          <h3 style={s.cardTitle}>Server Info</h3>
          <div style={s.infoList}>
            {[
              { label: "Server ID", value: guild.id },
              { label: "Members", value: (guild.memberCount || 0).toLocaleString() },
              { label: "Bot joined", value: config?.createdAt ? new Date(config.createdAt).toLocaleDateString() : "Unknown" },
              { label: "Config updated", value: config?.updatedAt ? new Date(config.updatedAt).toLocaleDateString() : "Never" },
            ].map(({ label, value }) => (
              <div key={label} style={s.infoRow}>
                <span style={s.infoLabel}>{label}</span>
                <span style={s.infoValue}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Config accordion */}
        <section style={s.card}>
          <button style={s.accordionBtn} onClick={() => setConfigOpen((o) => !o)}>
            <h3 style={{ ...s.cardTitle, margin: 0 }}>Raw Configuration</h3>
            <div style={s.accordionRight}>
              {configOpen && (
                <button style={s.copyBtn} onClick={(e) => { e.stopPropagation(); handleCopyConfig(); }}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
              {configOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>
          {configOpen && (
            <pre style={s.codeBlock}>{JSON.stringify(config, null, 2)}</pre>
          )}
        </section>

        {/* Resources */}
        <section style={s.card}>
          <h3 style={s.cardTitle}>Resources</h3>
          <div style={s.linkList}>
            <a href="https://github.com/ADB-bot" target="_blank" rel="noopener noreferrer" style={s.linkRow}>
              <Github size={16} color={colors.inkMuted} />
              <span style={s.linkLabel}>GitHub Repository</span>
              <span style={s.linkArrow}>↗</span>
            </a>
            <div style={s.linkRow}>
              <Server size={16} color={colors.inkMuted} />
              <span style={s.linkLabel}>Support Server</span>
              <span style={{ ...s.linkArrow, color: colors.inkFaint }}>Soon</span>
            </div>
            <div style={s.linkRow}>
              <Shield size={16} color={colors.inkMuted} />
              <span style={s.linkLabel}>Documentation</span>
              <span style={{ ...s.linkArrow, color: colors.inkFaint }}>Soon</span>
            </div>
          </div>
        </section>

        {/* Bot admin (owner only) */}
        {isOwner && (
          <section style={{ ...s.card, border: `1.5px solid ${colors.dangerTint}` }}>
            <h3 style={{ ...s.cardTitle, color: colors.dangerText }}>Bot Administration</h3>
            <p style={s.dangerDesc}>
              Restart the bot process. This disconnects all services briefly and reconnects them.
            </p>
            <button
              style={{ ...s.dangerActionBtn, ...(restarting ? s.btnBusy : {}) }}
              onClick={handleRestart}
              disabled={restarting}
            >
              <RotateCcw size={15} />
              {restarting ? "Restarting…" : "Restart Bot"}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

const s = {
  page: { maxWidth: 680 },
  pageHeader: { marginBottom: 28 },
  pageTitle: {
    fontFamily: fonts.display, fontSize: `${fontSize.display}px`, fontWeight: 600,
    color: colors.ink, margin: 0, lineHeight: 1.1,
  },
  pageSubtitle: {
    fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, margin: "4px 0 0",
  },
  stack: { display: "flex", flexDirection: "column", gap: 14 },
  card: {
    background: colors.surface1, borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`, padding: "20px 20px 0",
    overflow: "hidden",
  },
  cardTitle: {
    fontFamily: fonts.display, fontSize: `${fontSize.title}px`, fontWeight: 400,
    color: colors.ink, marginBottom: 14,
  },
  infoList: { display: "flex", flexDirection: "column" },
  infoRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "11px 0", borderBottom: `1px solid ${colors.hairline}`,
  },
  infoLabel: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted },
  infoValue: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink, fontWeight: 500 },
  accordionBtn: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    width: "100%", background: "none", border: "none", cursor: "pointer",
    color: colors.inkMuted, padding: "0 0 14px",
    textAlign: "left",
  },
  accordionRight: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  copyBtn: {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "4px 10px", borderRadius: radius.pill,
    border: `1px solid ${colors.hairlineStrong}`, background: "transparent",
    color: colors.inkMuted, fontFamily: fonts.body, fontSize: 12, cursor: "pointer",
  },
  codeBlock: {
    background: colors.cream, border: `1px solid ${colors.hairline}`,
    borderRadius: `${radius.control}px`, padding: 14,
    color: colors.ink2, fontSize: 12, fontFamily: "monospace",
    overflowX: "auto", maxHeight: 360, margin: "0 0 20px",
  },
  linkList: { display: "flex", flexDirection: "column" },
  linkRow: {
    display: "flex", alignItems: "center", gap: 12,
    padding: "12px 0", borderBottom: `1px solid ${colors.hairline}`,
    textDecoration: "none", cursor: "pointer",
  },
  linkLabel: { flex: 1, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink2 },
  linkArrow: { fontFamily: fonts.body, fontSize: 13, color: colors.accent },
  dangerDesc: {
    fontFamily: fonts.body, fontSize: `${fontSize.caption}px`,
    color: colors.inkMuted, marginBottom: 14,
  },
  dangerActionBtn: {
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "9px 20px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.danger}`, background: "transparent",
    color: colors.dangerText, fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, fontWeight: 500,
    cursor: "pointer", marginBottom: 20,
  },
  btnBusy: { opacity: 0.6, cursor: "not-allowed" },
};
