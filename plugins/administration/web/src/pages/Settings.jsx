import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { Server, Github, Shield } from 'lucide-react';

export function GuildSettings() {
  const { guildData } = useOutletContext();
  const { guild, config } = guildData || {};

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
              href="https://github.com/VAISH-bot"
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
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '900px',
  },
  pageTitle: {
    color: '#f1f5f9',
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '4px',
  },
  pageSubtitle: {
    color: '#64748b',
    fontSize: '14px',
    marginBottom: '24px',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  card: {
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    border: '1px solid #334155',
    padding: '16px',
  },
  cardTitle: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
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
    borderBottom: '1px solid #334155',
  },
  infoLabel: {
    color: '#94a3b8',
    fontSize: '14px',
  },
  infoValue: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontWeight: 500,
  },
  exportDesc: {
    color: '#64748b',
    fontSize: '13px',
    marginBottom: '12px',
  },
  codeBlock: {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '12px',
    color: '#e2e8f0',
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
    background: '#0f172a',
    borderRadius: '8px',
    color: '#6366F1',
    textDecoration: 'none',
    fontSize: '14px',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
};
