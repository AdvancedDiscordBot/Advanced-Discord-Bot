import React, { useEffect, useState } from 'react';
import { useParams, Outlet, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { colors, fonts, fontSize } from '../theme';

export function GuildLayout() {
  const { guildId } = useParams();
  const navigate = useNavigate();
  const [guildData, setGuildData] = useState(null);
  const [loading, setLoading] = useState(!!guildId);

  useEffect(() => {
    if (!guildId) {
      setGuildData(null);
      return;
    }

    async function fetchGuild() {
      setLoading(true);
      try {
        const res = await fetch(`/api/guild/${guildId}`);
        if (!res.ok) {
          navigate('/');
          return;
        }
        const data = await res.json();
        setGuildData(data);
      } catch (err) {
        console.error('Failed to fetch guild:', err);
        navigate('/');
      } finally {
        setLoading(false);
      }
    }

    fetchGuild();
  }, [guildId, navigate]);

  if (!guildId) {
    return (
      <div style={styles.layout}>
        <Header />
        <div style={styles.main}>
          <Outlet context={{ guildData: null }} />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.layout}>
        <Header />
        <div style={styles.loading}>
          <div style={styles.spinner}></div>
          <span>Loading server data...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.layout}>
      <Header />
      <div style={styles.container}>
        <Sidebar guild={guildData?.guild} />
        <main style={styles.main}>
          <Outlet context={{ guildData, refreshGuild: () => setLoading(true) }} />
        </main>
      </div>
    </div>
  );
}

const styles = {
  layout: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: colors.cream,
  },
  container: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
  },
  loading: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: `3px solid ${colors.hairlineStrong}`,
    borderTopColor: colors.accent,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
};
