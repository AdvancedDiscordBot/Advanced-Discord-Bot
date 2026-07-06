import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getGuildIcon } from '../utils/helpers';
import { Server, ChevronRight } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

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
        <Server size={32} color={colors.accent} />
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
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.surface2)}
            onMouseLeave={(e) => (e.currentTarget.style.background = colors.surface1)}
          >
            {guild.icon ? (
              <img
                src={getGuildIcon(guild)}
                alt={guild.name}
                style={styles.guildIcon}
              />
            ) : (
              <div style={styles.guildPlaceholder}>
                <Server size={32} color={colors.inkMuted} />
              </div>
            )}
            <div style={styles.guildInfo}>
              <div style={styles.guildName}>{guild.name}</div>
              <div style={styles.guildMembers}>
                {guild.memberCount?.toLocaleString()} members
              </div>
            </div>
            <ChevronRight size={20} color={colors.inkMuted} />
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
            style={styles.inviteButton}
            onMouseEnter={(e) => (e.target.style.opacity = 0.85)}
            onMouseLeave={(e) => (e.target.style.opacity = 1)}
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
    background: colors.cream,
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.display}px`,
    fontWeight: 300,
    marginTop: '16px',
    marginBottom: '8px',
  },
  subtitle: {
    color: colors.ink2,
    fontFamily: fonts.body,
    fontSize: `${fontSize.body}px`,
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
    background: colors.surface1,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`,
    cursor: 'pointer',
    transition: 'background .18s',
    textAlign: 'left',
    width: '100%',
  },
  guildIcon: {
    width: '56px',
    height: '56px',
    borderRadius: `${radius.card}px`,
  },
  guildPlaceholder: {
    width: '56px',
    height: '56px',
    borderRadius: `${radius.card}px`,
    background: colors.surface2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.inkMuted,
  },
  guildInfo: {
    flex: 1,
  },
  guildName: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.body}px`,
    fontWeight: 500,
    marginBottom: '4px',
  },
  guildMembers: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
  },
  empty: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    textAlign: 'center',
    marginTop: '24px',
  },
  loading: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.body}px`,
  },
  inviteButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    background: colors.accent,
    color: colors.creamOnAccent,
    borderRadius: `${radius.pill}px`,
    textDecoration: 'none',
    fontFamily: fonts.body,
    fontWeight: 500,
    fontSize: `${fontSize.caption}px`,
    marginTop: '12px',
    transition: 'opacity .18s',
  },
};
