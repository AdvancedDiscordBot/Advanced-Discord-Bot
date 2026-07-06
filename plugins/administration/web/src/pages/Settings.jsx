import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Server, Github, Shield, RotateCcw } from 'lucide-react';
import { Button } from '../components/UI';
import { colors, fonts, radius, fontSize } from '../theme';

export function GuildSettings() {
  const { guildData } = useOutletContext();
  const { guild, config } = guildData || {};
  const { user } = useAuth();
  const [isOwner, setIsOwner] = useState(() => {
    const stored = localStorage.getItem('adb_isOwner');
    return stored === 'true';
  });
  const [restarting, setRestarting] = useState(false);

  React.useEffect(() => {
    async function checkOwner() {
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          setIsOwner(data.isOwner || false);
          localStorage.setItem('adb_isOwner', String(data.isOwner || false));
        }
      } catch {}
    }
    checkOwner();
  }, [user]);

  async function handleRestart() {
    // eslint-disable-next-line no-restricted-globals
    const confirmed = window.confirm('Are you sure you want to restart the bot? This will briefly disconnect all services.');
    if (!confirmed) {
      return;
    }
    setRestarting(true);
    try {
      const res = await fetch('/api/plugins/restart', { method: 'POST' });
      if (res.ok) {
        // eslint-disable-next-line no-alert
        alert('Bot is restarting...');
      } else {
        // eslint-disable-next-line no-alert
        alert('Failed to restart bot. Only bot owners can do this.');
      }
    } catch (err) {
      alert('Failed to restart bot');
    } finally {
      setRestarting(false);
    }
  }

  if (!guild) return null;

  const configJson = JSON.stringify(config, null, 2);

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Server Settings</h1>
      <p style={styles.pageSubtitle}>
        Advanced configuration and data for {guild.name}
      </p>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Server Info</h3>
          <div style={styles.infoList}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Server ID</span>
              <span style={styles.infoValue}>{guild.id}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Member Count</span>
              <span style={styles.infoValue}>{guild.memberCount}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Bot Join Date</span>
              <span style={styles.infoValue}>
                {config?.createdAt ? new Date(config.createdAt).toLocaleDateString() : 'Unknown'}
              </span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Last Updated</span>
              <span style={styles.infoValue}>
                {config?.updatedAt ? new Date(config.updatedAt).toLocaleDateString() : 'Never'}
              </span>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Configuration Export</h3>
          <p style={styles.exportDesc}>
            Export the current server configuration as JSON. This can be useful for backups or debugging.
          </p>
          <pre style={styles.codeBlock}>{configJson}</pre>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Resources</h3>
          <div style={styles.links}>
            <a
              href="https://github.com/ADB-bot"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              <Github size={18} />
              <span>GitHub Repository</span>
            </a>
            <button
              style={styles.link}
              onClick={() => alert('Support server coming soon!')}
            >
              <Server size={18} />
              <span>Support Server</span>
            </button>
            <button
              style={styles.link}
              onClick={() => alert('Documentation coming soon!')}
            >
              <Shield size={18} />
              <span>Documentation</span>
            </button>
          </div>
        </div>

        {isOwner && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Bot Administration</h3>
            <p style={styles.exportDesc}>
              Restart the bot process. This will briefly disconnect all services and reconnect them.
            </p>
            <Button onClick={handleRestart} loading={restarting} variant="danger">
              <RotateCcw size={16} style={{ marginRight: 8 }} />
              Restart Bot
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '900px',
  },
  pageTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.heading}px`,
    fontWeight: 400,
    marginBottom: '4px',
  },
  pageSubtitle: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    marginBottom: '24px',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  card: {
    background: colors.surface1,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`,
    padding: '16px',
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 400,
    marginBottom: '16px',
  },
  infoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: `1.5px solid ${colors.hairline}`,
  },
  infoLabel: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
  },
  infoValue: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 500,
  },
  exportDesc: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    marginBottom: '12px',
  },
  codeBlock: {
    background: colors.cream,
    border: `1.5px solid ${colors.hairline}`,
    borderRadius: `${radius.control}px`,
    padding: '12px',
    color: colors.ink2,
    fontSize: '12px',
    fontFamily: 'monospace',
    overflow: 'auto',
    maxHeight: '400px',
    margin: 0,
  },
  links: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    background: colors.cream,
    borderRadius: `${radius.control}px`,
    color: colors.accent,
    textDecoration: 'none',
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
};
