import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from './hooks/useAuth';
import { getGuildIcon } from './utils/helpers';
import { colors, fonts, radius, fontSize } from './theme';
import { Server, ChevronRight, ChevronLeft, LogOut, User as UserIcon } from 'lucide-react';
import MemberPluginPage from './pages/MemberPluginPage';

// ── Member portal ───────────────────────────────────────────────────────────
// A self-service surface, separate from the admin dashboard. A member logs in,
// picks one of the guilds they are IN, and sees the member pages that guild's
// active plugins expose (their own rank/XP, reminders, tickets, …). Access is
// resolved live server-side: any tier above NONE can be here — no dashboard
// permission is required. Guild config lives in the admin dashboard, not here.

function Shell({ children }) {
  const { user, logout } = useAuth();
  const profile = user?.user || user || {};
  return (
    <div style={s.shell}>
      <header style={s.topbar}>
        <div style={s.brand}>
          <UserIcon size={18} color={colors.accent} />
          <span style={s.brandText}>My ADB</span>
        </div>
        <div style={s.topRight}>
          {profile?.username && <span style={s.who}>{profile.username}</span>}
          <button style={s.logout} onClick={logout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main style={s.main}>{children}</main>
    </div>
  );
}

function MemberGuildPicker() {
  const navigate = useNavigate();
  const [guilds, setGuilds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/me');
        const data = res.ok ? await res.json() : {};
        if (alive) setGuilds(data.guilds || []);
      } catch {
        if (alive) setGuilds([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div style={s.loading}>Loading your servers…</div>;

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <Server size={30} color={colors.accent} />
        <h1 style={s.h1}>Your Servers</h1>
        <p style={s.sub}>Pick a server to see what’s available to you.</p>
      </div>
      {guilds.length === 0 ? (
        <div style={s.empty}>
          You’re not in any servers that use ADB yet.
        </div>
      ) : (
        <div style={s.grid}>
          {guilds.map((g) => (
            <button
              key={g.id}
              style={s.card}
              onClick={() => navigate(`/guild/${g.id}`)}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.surface2)}
              onMouseLeave={(e) => (e.currentTarget.style.background = colors.surface1)}
            >
              <img src={getGuildIcon(g)} alt={g.name} style={s.icon} />
              <span style={s.cardName}>{g.name}</span>
              <ChevronRight size={18} color={colors.inkMuted} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberGuildPages() {
  const { guildId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, guild: null, pages: [], error: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/me/guild/${guildId}/pages`);
        if (!res.ok) {
          if (alive) setState({ loading: false, guild: null, pages: [], error: res.status });
          return;
        }
        const data = await res.json();
        if (alive) setState({ loading: false, guild: data.guild, pages: data.pages || [], error: null });
      } catch {
        if (alive) setState({ loading: false, guild: null, pages: [], error: 'network' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [guildId]);

  if (state.loading) return <div style={s.loading}>Loading…</div>;
  if (state.error === 403) {
    return (
      <div style={s.wrap}>
        <BackLink onClick={() => navigate('/')} />
        <div style={s.empty}>You don’t have access to this server.</div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <BackLink onClick={() => navigate('/')} />
      <div style={s.head}>
        {state.guild?.name && <h1 style={s.h1}>{state.guild.name}</h1>}
        <p style={s.sub}>Your pages for this server.</p>
      </div>
      {state.pages.length === 0 ? (
        <div style={s.empty}>
          No member pages are available here yet. The server’s admins decide
          which plugins are turned on.
        </div>
      ) : (
        <div style={s.grid}>
          {state.pages.map((p) => (
            <button
              key={`${p.pluginName}:${p.path}`}
              style={s.card}
              onClick={() => navigate(`/guild/${guildId}/p/${encodeURIComponent(p.pluginName)}?path=${encodeURIComponent(p.path)}&label=${encodeURIComponent(p.label)}${p.rendered ? '&rendered=1' : ''}`)}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.surface2)}
              onMouseLeave={(e) => (e.currentTarget.style.background = colors.surface1)}
            >
              <span style={s.cardName}>{p.label}</span>
              <ChevronRight size={18} color={colors.inkMuted} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberPageEmbed() {
  const { guildId, pluginName } = useParams();
  const navigate = useNavigate();
  // The page path is carried as a query param so plugin-defined subpaths (which
  // may contain slashes) don't collide with the router.
  const params = new URLSearchParams(window.location.search);
  const path = params.get('path') || '/';
  // Reuse the same watchdog-proxied plugin UI mount the admin dashboard uses.
  // guildId is forwarded so the plugin backend can scope to this member+guild.
  const sep = path.includes('?') ? '&' : '?';
  const src = `/plugin-ui/${pluginName}${path}${sep}guildId=${encodeURIComponent(guildId)}`;

  return (
    <div style={s.embedWrap}>
      <div style={s.embedBar}>
        <BackLink onClick={() => navigate(`/guild/${guildId}`)} label="Back to pages" />
      </div>
      <iframe title={pluginName} src={src} style={s.iframe} />
    </div>
  );
}

// Dispatch a member page to the right renderer: platform-rendered pages (source
// + view declared in the manifest) go through the built-in view library;
// everything else falls back to the plugin-hosted iframe. The `rendered` flag
// is carried from the pages list as a query param.
function MemberPageRoute() {
  const params = new URLSearchParams(window.location.search);
  return params.get('rendered') === '1' ? <MemberPluginPage /> : <MemberPageEmbed />;
}

function BackLink({ onClick, label = 'All servers' }) {
  return (
    <button style={s.back} onClick={onClick}>
      <ChevronLeft size={16} />
      <span>{label}</span>
    </button>
  );
}

export default function MemberApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <span>Loading…</span>
      </div>
    );
  }

  if (!user) {
    // Send unauthenticated members through the same Discord OAuth flow, then
    // back to the member portal.
    window.location.href = '/auth/discord?redirect=/me';
    return null;
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<MemberGuildPicker />} />
        <Route path="/guild/:guildId" element={<MemberGuildPages />} />
        <Route path="/guild/:guildId/p/:pluginName" element={<MemberPageRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

const s = {
  shell: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: colors.cream },
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 24px', borderBottom: `1px solid ${colors.hairlineStrong}`,
  },
  brand: { display: 'flex', alignItems: 'center', gap: '8px' },
  brandText: { fontFamily: fonts.display, fontSize: `${fontSize.h4 || 20}px`, color: colors.ink },
  topRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  who: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted },
  logout: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '32px', height: '32px', borderRadius: radius.sm || '8px',
    border: `1px solid ${colors.hairlineStrong}`, background: 'transparent',
    color: colors.inkMuted, cursor: 'pointer',
  },
  main: { flex: 1, overflow: 'auto', padding: '24px' },
  wrap: { maxWidth: '760px', margin: '0 auto' },
  head: { textAlign: 'center', marginBottom: '24px' },
  h1: { fontFamily: fonts.display, fontWeight: 300, color: colors.ink, margin: '12px 0 4px' },
  sub: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, margin: 0 },
  grid: { display: 'flex', flexDirection: 'column', gap: '12px' },
  card: {
    display: 'flex', alignItems: 'center', gap: '14px', width: '100%',
    padding: '16px 18px', borderRadius: radius.md || '14px',
    border: `1px solid ${colors.hairlineStrong}`, background: colors.surface1,
    cursor: 'pointer', textAlign: 'left', transition: 'background .15s',
  },
  icon: { width: '36px', height: '36px', borderRadius: '50%' },
  cardName: { flex: 1, fontFamily: fonts.body, fontSize: `${fontSize.body}px`, color: colors.ink },
  empty: {
    padding: '32px', textAlign: 'center', color: colors.inkMuted,
    fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
    border: `1px dashed ${colors.hairlineStrong}`, borderRadius: radius.md || '14px',
  },
  loading: { padding: '48px', textAlign: 'center', color: colors.inkMuted, fontFamily: fonts.body },
  back: {
    display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '16px',
    padding: '6px 10px', borderRadius: radius.sm || '8px', border: 'none',
    background: 'transparent', color: colors.inkMuted, cursor: 'pointer',
    fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
  },
  embedWrap: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' },
  embedBar: { marginBottom: '8px' },
  iframe: {
    flex: 1, width: '100%', border: `1px solid ${colors.hairlineStrong}`,
    borderRadius: radius.md || '14px', background: colors.surface1,
  },
  center: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: '16px',
    color: colors.inkMuted, background: colors.cream, fontFamily: fonts.body,
  },
  spinner: {
    width: '40px', height: '40px', border: `3px solid ${colors.hairlineStrong}`,
    borderTopColor: colors.accent, borderRadius: '50%', animation: 'spin 1s linear infinite',
  },
};
