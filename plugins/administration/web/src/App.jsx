import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { GuildLayout } from './components/GuildLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { AISettings } from './pages/AISettings';
import { XPSettings } from './pages/XPSettings';
import { TicketSettings } from './pages/TicketSettings';
import { EconomySettings } from './pages/EconomySettings';
import { BirthdaySettings } from './pages/BirthdaySettings';
import { AntiRaidSettings } from './pages/AntiRaidSettings';
import { ActivityLogs } from './pages/ActivityLogs';
import { GuildSettings } from './pages/Settings';
import { Plugins } from './pages/Plugins';
import { GuildPicker } from './components/GuildPicker';
import { colors } from './theme';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}></div>
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
      <Route
        path="/"
        element={
          user ? (
            <GuildLayout />
          ) : (
            <Navigate to="/login" />
          )
        }
      >
        <Route index element={<GuildPicker />} />
        <Route path="guild/:guildId" element={<Dashboard />} />
        <Route path="guild/:guildId/ai" element={<AISettings />} />
        <Route path="guild/:guildId/xp" element={<XPSettings />} />
        <Route path="guild/:guildId/tickets" element={<TicketSettings />} />
        <Route path="guild/:guildId/economy" element={<EconomySettings />} />
        <Route path="guild/:guildId/birthdays" element={<BirthdaySettings />} />
        <Route path="guild/:guildId/antiraid" element={<AntiRaidSettings />} />
        <Route path="guild/:guildId/logs" element={<ActivityLogs />} />
        <Route path="guild/:guildId/settings" element={<GuildSettings />} />
        <Route path="guild/:guildId/plugins" element={<Plugins />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/dashboard">
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

const styles = {
  loading: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    color: colors.inkMuted,
    background: colors.cream,
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
