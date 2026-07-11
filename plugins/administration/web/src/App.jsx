import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { JobsProvider } from './hooks/useJobs';
import { JobsPanel } from './components/JobsPanel';
import { GuildLayout } from './components/GuildLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { GuildSettings } from './pages/Settings';
import { Plugins } from './pages/Plugins';
import { GuildPicker } from './components/GuildPicker';
import { colors } from './theme';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '16px',
        color: colors.inkMuted, background: colors.cream,
      }}>
        <div style={{
          width: '40px', height: '40px',
          border: `3px solid ${colors.hairlineStrong}`,
          borderTopColor: colors.accent,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <JobsProvider>
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
        <Route path="/" element={user ? <GuildLayout /> : <Navigate to="/login" />}>
          <Route index element={<GuildPicker />} />
          <Route path="guild/:guildId" element={<Dashboard />} />
          <Route path="guild/:guildId/plugins" element={<Plugins />} />
          <Route path="guild/:guildId/settings" element={<GuildSettings />} />
        </Route>
      </Routes>
      {user && <JobsPanel />}
    </JobsProvider>
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
