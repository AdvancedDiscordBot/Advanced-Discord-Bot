import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getGuildIcon } from '../utils/helpers';
import { Server, ChevronRight } from 'lucide-react';

export function GuildPicker() {
  const navigate = useNavigate();
  const [guilds, setGuilds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchGuilds() {
      try {
        const res = await fetch('/api/guilds');
        const data = await res.json();
        setGuilds(data.guilds || []);
      } catch (err) {
        console.error('Failed to fetch guilds:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchGuilds();
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading your servers...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <Server size={32} color="#6366F1" />
        <h1 style={styles.title}>Select a Server</h1>
        <p style={styles.subtitle}>
          Choose a server where you have admin permissions to manage ADB
        </p>
      </div>
      <div style={styles.grid}>
        {guilds.map((guild) => (
          <button
            key={guild.id}
            onClick={() => navigate(`/guild/${guild.id}`)}
            style={styles.guildCard}
          >
            {guild.icon ? (
              <img
                src={getGuildIcon(guild)}
                alt={guild.name}
                style={styles.guildIcon}
              />
            ) : (
              <div style={styles.guildPlaceholder}>
                <Server size={32} />
              </div>
            )}
            <div style={styles.guildInfo}>
              <div style={styles.guildName}>{guild.name}</div>
              <div style={styles.guildMembers}>
                {guild.memberCount?.toLocaleString()} members
              </div>
            </div>
            <ChevronRight size={20} color="#64748b" />
          </button>
        ))}
      </div>
      {guilds.length === 0 && (
        <div style={styles.empty}>
          <p style={{ marginBottom: '16px' }}>
            No servers found. Make sure ADB is in a server where you have admin
            permissions.
          </p>
          <a
            href="/auth/invite"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              backgroundColor: '#6366F1',
              color: '#ffffff',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: '600',
              marginTop: '12px',
              transition: 'background-color 0.2s',
            }}
            onMouseOver={(e) => (e.target.style.backgroundColor = '#4f46e5')}
            onMouseOut={(e) => (e.target.style.backgroundColor = '#6366F1')}
          >
            Add ADB to Server
          </a>
        </div>
      )}
    </div>
  );
}

export function GuildGate({ children }) {
  const { guildId } = children.props;

  if (!guildId) {
    return <GuildPicker />;
  }

  return children;
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  title: {
    color: '#f1f5f9',
    fontSize: '28px',
    fontWeight: 700,
    marginTop: '16px',
    marginBottom: '8px',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: '16px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px',
    maxWidth: '1200px',
    width: '100%',
  },
  guildCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    border: '1px solid #334155',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left',
    width: '100%',
  },
  guildIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '12px',
  },
  guildPlaceholder: {
    width: '56px',
    height: '56px',
    borderRadius: '12px',
    background: '#334155',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
  },
  guildInfo: {
    flex: 1,
  },
  guildName: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '4px',
  },
  guildMembers: {
    color: '#64748b',
    fontSize: '13px',
  },
  empty: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: '24px',
  },
  loading: {
    color: '#94a3b8',
    fontSize: '16px',
  },
};
