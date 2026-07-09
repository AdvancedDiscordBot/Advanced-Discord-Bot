# Dashboard Rework — Plugin-Centric UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tear out all feature-specific settings pages from the admin dashboard and replace them with a plugin-centric UI: widget grid home, best-in-class plugin manager, command palette, and a lean settings page.

**Architecture:** Single-page React app (`plugins/administration/web/src/`) keeps its existing Vite/CRA build, theme system (CSS custom properties via `theme.js`/`theme.css`), and auth flow. All feature pages (AI, XP, Economy, Tickets, Birthdays, AntiRaid, ActivityLogs) are deleted. `App.jsx` routes collapse to 3 destinations under the guild layout: `/`, `/plugins`, `/settings`. A new `Dashboard.jsx` renders a widget grid; the only built-in widget is `ServerStatsWidget` backed by a new `/api/guild/:id/server-stats` endpoint. `Plugins.jsx` is fully rewritten as the centrepiece. A `CommandPalette` overlay component wires to `⌘K`/`Ctrl+K`. The `plugins/ai/` and `plugins/economy/` directories (external-plugin-grade features) are deleted from the repository. The `plugins/administration/` plugin stays and its `index.js` moves into core (`core/adminPlugin.js`) so the web app is always available without a separate plugin folder.

**Tech Stack:** React 18, React Router v6, Lucide React, DM Sans + Cormorant Garamond (already loaded), signature-ui CSS token system (existing `theme.css`/`theme.js`), Fastify (backend), existing `useApi`/`useApiFetch`/`useAuth` hooks.

## Global Constraints

- Never hardcode hex colour values in components — always import from `theme.js`
- `radius.card = 16`, `radius.control = 10`, `radius.pill = 100` — use these constants
- `fonts.display` = `'Cormorant Garamond', serif` — headings only; `fonts.body` = `'DM Sans', sans-serif` — everything else
- No new npm packages — work only with what is already in `package.json`
- All inline style objects — no CSS modules, no Tailwind, no styled-components (existing pattern)
- `plugins/administration/web/` is the CRA app root; build output goes to `plugins/administration/web/build/`
- The backend (`core/api/server.js`) serves the built app from `/dashboard/` via `@fastify/static`
- `enabled: true` and `lastError: null` on a plugin object means loaded OK; `enabled: false` with `lastError` = error state; `enabled: false` with no `lastError` = manually disabled

---

## File Map

### Deleted files
- `plugins/ai/` — entire directory
- `plugins/economy/` — entire directory
- `plugins/administration/` — move `index.js` to core (see Task 1), delete the folder entry from plugin discovery
- `src/pages/AISettings.jsx`
- `src/pages/EconomySettings.jsx`
- `src/pages/BirthdaySettings.jsx`
- `src/pages/XPSettings.jsx`
- `src/pages/TicketSettings.jsx`
- `src/pages/AntiRaidSettings.jsx`
- `src/pages/ActivityLogs.jsx`

### New / rewritten files
| File | Responsibility |
|---|---|
| `core/adminPlugin.js` | Moved from `plugins/administration/index.js` — registers dashboard static + all `/api/guild/*` routes |
| `core/api/server.js` | Add new `/api/guild/:id/server-stats` route; remove `antiRaid`/`economy` special-case from PUT config |
| `src/App.jsx` | 3 routes: `/`, `/plugins`, `/settings` |
| `src/components/Sidebar.jsx` | 3 nav items: Dashboard, Plugins, Settings |
| `src/components/Header.jsx` | Add `⌘K` search pill button |
| `src/components/CommandPalette.jsx` | NEW — full-screen overlay, fuzzy search, keyboard nav |
| `src/components/UI.jsx` | Add `Badge`, `StatusDot`, `EmptyState`, `SlideOver` to existing exports |
| `src/pages/Dashboard.jsx` | Widget grid + `ServerStatsWidget` |
| `src/pages/Plugins.jsx` | Full rewrite — Installed/Browse/Core tabs, slide-over detail panel |
| `src/pages/Settings.jsx` | Slim down — server info, restart, raw config JSON viewer |

---

## Task 1 — Move administration plugin into core

**Files:**
- Create: `core/adminPlugin.js`
- Modify: `core/api/server.js` (call `adminPlugin.register(fastify, ctx)` after auth is set up)
- Modify: `index.js` (pass fastify + db to admin plugin init, stop loading `plugins/administration`)

**Interfaces:**
- Produces: `adminPlugin.register(fastify, { client, db, pluginManager })` — called once at server start
- Produces: all existing `/api/guilds`, `/api/guild/:id`, `/api/guild/:id/leaderboard`, `/api/guild/:id/tickets`, `/api/guild/:id/activity`, `/api/guild/:id/shop` routes unchanged

- [ ] **Step 1: Create `core/adminPlugin.js`**

Copy `plugins/administration/index.js` content, change the export to:
```js
// core/adminPlugin.js
const path = require('path');
const fs = require('fs');

async function register(fastify, { client, db }) {
  const webDir = path.join(__dirname, '..', 'plugins', 'administration', 'web', 'build');
  if (fs.existsSync(webDir)) {
    fastify.register(require('@fastify/static'), {
      root: webDir,
      prefix: '/dashboard/',
      decorateReply: false,
    });
  }

  const requireGuildAccess = (request, reply) => {
    const guildId = request.params.guildId;
    const ownerIds = request.session.ownerIds || [];
    if (ownerIds.includes(request.session.user?.id)) return true;
    const allowed = request.session.adminGuildIds || [];
    if (!allowed.includes(guildId)) {
      reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  fastify.get('/api/guilds', async (request) => {
    const guildIds = request.session.adminGuildIds || [];
    const botGuilds = client.guilds.cache;
    const guilds = guildIds
      .filter((id) => botGuilds.has(id))
      .map((id) => {
        const g = botGuilds.get(id);
        return { id: g.id, name: g.name, icon: g.icon, memberCount: g.memberCount };
      });
    return { guilds };
  });

  fastify.get('/api/guild/:guildId', async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;
    const guild = client.guilds.cache.get(request.params.guildId);
    if (!guild) return reply.code(404).send({ error: 'Guild not found' });
    await db.ensureConnection();
    const serverConfig = await db.getServerConfig(request.params.guildId);
    const channels = guild.channels.cache
      .filter((c) => c.type === 0)
      .map((c) => ({ id: c.id, name: c.name }));
    const roles = guild.roles.cache
      .filter((r) => !r.managed && r.name !== '@everyone')
      .map((r) => ({ id: r.id, name: r.name, color: r.color }))
      .sort((a, b) => b.position - a.position);
    return {
      guild: { id: guild.id, name: guild.name, icon: guild.iconURL(), memberCount: guild.memberCount },
      config: serverConfig.toObject(),
      channels,
      roles,
    };
  });

  fastify.get('/api/guild/:guildId/leaderboard', async (request, reply) => {
    if (!requireGuildAccess(request, reply)) return;
    await db.ensureConnection();
    const limit = Number(request.query.limit) || 10;
    const users = await db.getTopUsers(request.params.guildId, limit);
    return { users };
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    const indexPath = path.join(webDir, 'index.html');
    if (fs.existsSync(indexPath)) return reply.code(200).type('text/html').send(fs.readFileSync(indexPath));
    return reply.code(404).send({ error: 'Not found' });
  });
}

module.exports = { register };
```

- [ ] **Step 2: Wire `adminPlugin` into `core/api/server.js`**

After the auth routes block (around line 375 in `server.js`), add:
```js
const adminPlugin = require('../adminPlugin');
await adminPlugin.register(fastify, { client, db });
```

Remove the old `fastify.get('/api/guilds', ...)` and `fastify.get('/api/guild/:guildId', ...)` and `fastify.get('/api/guild/:guildId/leaderboard', ...)` routes that were previously in `server.js` (if any duplicates exist from the administration plugin's `index.js` contribution — verify by grepping for them first).

- [ ] **Step 3: Delete `plugins/administration/index.js` plugin loader logic**

The folder `plugins/administration/` stays (it still contains the web app at `web/`). But `plugins/administration/index.js` should now just be:
```js
// Intentionally empty — functionality moved to core/adminPlugin.js
module.exports = {};
```

- [ ] **Step 4: Start bot, verify `/dashboard/` still loads and `/api/guilds` responds**

Run: `node index.js`
Expected: no error about `@fastify/static` double-registration, dashboard loads at `localhost:<PORT>/dashboard/`

- [ ] **Step 5: Commit**
```bash
git add core/adminPlugin.js core/api/server.js plugins/administration/index.js
git commit -m "refactor: move administration plugin to core"
```

---

## Task 2 — Delete legacy plugins and page files

**Files:**
- Delete: `plugins/ai/` (entire directory)
- Delete: `plugins/economy/` (entire directory)
- Delete: `src/pages/AISettings.jsx`
- Delete: `src/pages/EconomySettings.jsx`
- Delete: `src/pages/BirthdaySettings.jsx`
- Delete: `src/pages/XPSettings.jsx`
- Delete: `src/pages/TicketSettings.jsx`
- Delete: `src/pages/AntiRaidSettings.jsx`
- Delete: `src/pages/ActivityLogs.jsx`

**Interfaces:**
- Consumes: nothing
- Produces: clean file tree — no orphan imports

- [ ] **Step 1: Remove plugin directories**
```bash
rm -rf plugins/ai plugins/economy
```

- [ ] **Step 2: Remove page files**
```bash
rm plugins/administration/web/src/pages/AISettings.jsx
rm plugins/administration/web/src/pages/EconomySettings.jsx
rm plugins/administration/web/src/pages/BirthdaySettings.jsx
rm plugins/administration/web/src/pages/XPSettings.jsx
rm plugins/administration/web/src/pages/TicketSettings.jsx
rm plugins/administration/web/src/pages/AntiRaidSettings.jsx
rm plugins/administration/web/src/pages/ActivityLogs.jsx
```

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "chore: remove legacy feature plugins and settings pages"
```

---

## Task 3 — New `/api/guild/:id/server-stats` endpoint

**Files:**
- Modify: `core/api/server.js` lines ~663-707 (replace the old `/api/guild/:guildId/stats` handler or add alongside it)

**Interfaces:**
- Produces: `GET /api/guild/:guildId/server-stats` → `{ members, botPing, pluginCount, commandCount, uptime }`

- [ ] **Step 1: Add the route in `core/api/server.js` after the existing stats route**

```js
fastify.get('/api/guild/:guildId/server-stats', async (request, reply) => {
  if (!requireGuildAccess(request, reply)) return;
  const guild = client.guilds.cache.get(request.params.guildId);
  if (!guild) return reply.code(404).send({ error: 'Guild not found' });
  return {
    members: guild.memberCount || 0,
    botPing: client.ws.ping || 0,
    pluginCount: pluginManager.getPluginList().filter((p) => p.enabled).length,
    commandCount: client.commands.size || 0,
    uptime: process.uptime(),
  };
});
```

Note: `requireGuildAccess` is already defined in `server.js` scope — no import needed.

- [ ] **Step 2: Verify response shape manually**

Run: `curl -s http://localhost:<PORT>/api/guild/<GUILD_ID>/server-stats`
Expected JSON: `{ "members": <n>, "botPing": <n>, "pluginCount": <n>, "commandCount": <n>, "uptime": <n> }`

- [ ] **Step 3: Commit**
```bash
git add core/api/server.js
git commit -m "feat: add /api/guild/:id/server-stats endpoint"
```

---

## Task 4 — Extend `UI.jsx` with new shared primitives

**Files:**
- Modify: `plugins/administration/web/src/components/UI.jsx` (append new exports, do not break existing ones)

**Interfaces:**
- Produces: `Badge({ label, variant })` — `variant`: `'default' | 'success' | 'warning' | 'danger'`
- Produces: `StatusDot({ status })` — `status`: `'ok' | 'error' | 'disabled'`
- Produces: `EmptyState({ icon: ReactNode, title, body, action })` — centred empty state card
- Produces: `SlideOver({ open, onClose, title, children })` — right-side overlay panel

- [ ] **Step 1: Append `Badge` to `UI.jsx`**

```jsx
export function Badge({ label, variant = 'default' }) {
  const variantMap = {
    default:  { bg: colors.surface2,    text: colors.inkMuted  },
    success:  { bg: colors.successTint, text: colors.successText },
    warning:  { bg: colors.warningTint, text: colors.warningText },
    danger:   { bg: colors.dangerTint,  text: colors.dangerText  },
  };
  const v = variantMap[variant] || variantMap.default;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: `${radius.pill}px`,
      background: v.bg, color: v.text,
      fontFamily: fonts.body, fontSize: '11px', fontWeight: 600,
      letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Append `StatusDot` to `UI.jsx`**

```jsx
export function StatusDot({ status }) {
  const colorMap = {
    ok:       colors.pine,
    error:    colors.danger,
    disabled: colors.inkFaint,
  };
  return (
    <span style={{
      display: 'inline-block', width: '8px', height: '8px',
      borderRadius: '50%', background: colorMap[status] || colorMap.disabled,
      flexShrink: 0,
    }} />
  );
}
```

- [ ] **Step 3: Append `EmptyState` to `UI.jsx`**

```jsx
export function EmptyState({ icon, title, body, action }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '48px 24px', textAlign: 'center',
      color: colors.inkMuted,
    }}>
      {icon && <div style={{ marginBottom: '16px', opacity: 0.5 }}>{icon}</div>}
      <div style={{ fontFamily: fonts.display, fontSize: `${fontSize.title}px`, fontWeight: 400, color: colors.ink, marginBottom: '8px' }}>
        {title}
      </div>
      {body && (
        <p style={{ fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, maxWidth: '360px', lineHeight: 1.6, marginBottom: action ? '24px' : 0 }}>
          {body}
        </p>
      )}
      {action}
    </div>
  );
}
```

- [ ] **Step 4: Append `SlideOver` to `UI.jsx`**

```jsx
export function SlideOver({ open, onClose, title, children }) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(30,26,20,0.45)',
          zIndex: 200, backdropFilter: 'blur(2px)',
        }}
      />
      {/* panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '480px', maxWidth: '100vw',
        background: colors.cream, borderLeft: `1.5px solid ${colors.hairline}`,
        zIndex: 201, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: `1.5px solid ${colors.hairline}`,
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: fonts.display, fontSize: `${fontSize.title}px`, fontWeight: 400, color: colors.ink }}>
            {title}
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: colors.inkMuted, padding: '4px', borderRadius: `${radius.control}px`,
            display: 'flex', alignItems: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {children}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Verify build compiles**
```bash
cd plugins/administration/web && npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**
```bash
git add plugins/administration/web/src/components/UI.jsx
git commit -m "feat(ui): add Badge, StatusDot, EmptyState, SlideOver primitives"
```

---

## Task 5 — Rewrite `App.jsx` and `Sidebar.jsx`

**Files:**
- Modify: `plugins/administration/web/src/App.jsx`
- Modify: `plugins/administration/web/src/components/Sidebar.jsx`

**Interfaces:**
- Consumes: `Dashboard` from `./pages/Dashboard`, `Plugins` from `./pages/Plugins`, `GuildSettings` from `./pages/Settings`
- Produces: routes `""` → Dashboard, `"plugins"` → Plugins, `"settings"` → Settings; no AI/XP/etc. routes

- [ ] **Step 1: Rewrite `App.jsx`**

```jsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
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
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', color: colors.inkMuted, background: colors.cream }}>
        <div style={{ width: '40px', height: '40px', border: `3px solid ${colors.hairlineStrong}`, borderTopColor: colors.accent, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
      <Route path="/" element={user ? <GuildLayout /> : <Navigate to="/login" />}>
        <Route index element={<GuildPicker />} />
        <Route path="guild/:guildId" element={<Dashboard />} />
        <Route path="guild/:guildId/plugins" element={<Plugins />} />
        <Route path="guild/:guildId/settings" element={<GuildSettings />} />
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
```

- [ ] **Step 2: Rewrite `Sidebar.jsx`**

```jsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Puzzle, Settings } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

const NAV = [
  { to: '',        icon: LayoutDashboard, label: 'Dashboard' },
  { to: 'plugins', icon: Puzzle,          label: 'Plugins'   },
  { to: 'settings',icon: Settings,        label: 'Settings'  },
];

export function Sidebar({ guild }) {
  if (!guild) {
    return (
      <aside style={styles.sidebar}>
        <div style={styles.selectPrompt}>Select a server to manage</div>
      </aside>
    );
  }

  return (
    <aside style={styles.sidebar}>
      <div style={styles.guildInfo}>
        <div style={styles.guildName}>{guild.name}</div>
        <div style={styles.guildId}>{guild.id}</div>
      </div>

      <nav style={styles.nav}>
        <p style={styles.navSection}>CORE</p>
        {NAV.map(({ to, icon: Icon, label }) => {
          const path = to ? `/guild/${guild.id}/${to}` : `/guild/${guild.id}`;
          return (
            <NavLink
              key={to}
              to={path}
              end={to === ''}
              style={({ isActive }) => ({ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) })}
            >
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          );
        })}

        {/* Plugin-injected nav items land here in future */}
        <div id="plugin-nav-items" />
      </nav>

      <div style={styles.footer}>
        <div style={styles.hostingCard}>
          Managed hosting?{' '}
          <span style={styles.hostingHandle}>@deadindian</span> on Discord.
        </div>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: { width: '220px', background: colors.surface1, borderRight: `1.5px solid ${colors.hairline}`, display: 'flex', flexDirection: 'column', flexShrink: 0 },
  selectPrompt: { padding: '24px 16px', color: colors.inkMuted, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, textAlign: 'center' },
  guildInfo: { padding: '16px', borderBottom: `1.5px solid ${colors.hairline}` },
  guildName: { color: colors.ink, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  guildId: { color: colors.inkFaint, fontFamily: fonts.body, fontSize: '11px' },
  nav: { flex: 1, padding: '12px 8px', overflowY: 'auto' },
  navSection: { fontFamily: fonts.body, fontSize: '10px', fontWeight: 600, letterSpacing: '0.12em', color: colors.inkFaint, padding: '0 8px', marginBottom: '4px', marginTop: '4px' },
  navLink: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', borderRadius: `${radius.control}px`, color: colors.ink2, textDecoration: 'none', fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 400, marginBottom: '2px', transition: 'background .15s, color .15s' },
  navLinkActive: { background: colors.accentTint, color: colors.accentOnTint, fontWeight: 500 },
  footer: { padding: '12px', borderTop: `1.5px solid ${colors.hairline}` },
  hostingCard: { background: colors.accentTint, borderRadius: `${radius.card}px`, padding: '10px 12px', color: colors.accentOnTint, fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, lineHeight: 1.4 },
  hostingHandle: { color: colors.accent, fontWeight: 700 },
};
```

- [ ] **Step 3: Verify build compiles**
```bash
cd plugins/administration/web && npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**
```bash
git add plugins/administration/web/src/App.jsx plugins/administration/web/src/components/Sidebar.jsx
git commit -m "feat(nav): collapse routes to 3 core pages, remove feature nav items"
```

---

## Task 6 — Rewrite `Header.jsx` with command palette trigger

**Files:**
- Modify: `plugins/administration/web/src/components/Header.jsx`

**Interfaces:**
- Consumes: `onOpenPalette` prop — `() => void`
- Produces: header with logo, `⌘K` pill button, theme toggle, avatar + logout

- [ ] **Step 1: Rewrite `Header.jsx`**

```jsx
import React from 'react';
import { useAuth } from '../hooks/useAuth';
import { getAvatarUrl } from '../utils/helpers';
import { LogOut, Search } from 'lucide-react';
import { colors, fonts, fontSize, radius } from '../theme';
import { ThemeToggle } from './ThemeToggle';

export function Header({ onOpenPalette }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

  return (
    <header style={styles.header}>
      <div style={styles.left}>
        <div style={styles.brand}>
          <span style={styles.seal} />
          <span style={styles.brandText}>VAISH</span>
        </div>
      </div>

      <button
        onClick={onOpenPalette}
        style={styles.searchPill}
        title="Open command palette"
      >
        <Search size={13} style={{ flexShrink: 0 }} />
        <span style={styles.searchText}>Search…</span>
        <span style={styles.kbd}>{isMac ? '⌘K' : 'Ctrl K'}</span>
      </button>

      <div style={styles.right}>
        <ThemeToggle />
        <img src={getAvatarUrl(user.user)} alt="" style={styles.avatar} />
        <span style={styles.username}>{user.user.global_name || user.user.username}</span>
        <button onClick={logout} style={styles.logoutBtn} title="Logout">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

const styles = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: '56px', background: colors.surface1, borderBottom: `1.5px solid ${colors.hairline}`, flexShrink: 0, gap: '16px' },
  left: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  brand: { display: 'flex', alignItems: 'center', gap: '8px' },
  seal: { width: '7px', height: '7px', borderRadius: '50%', background: colors.accent },
  brandText: { fontFamily: fonts.display, fontSize: `${fontSize.title}px`, fontWeight: 600, color: colors.ink, letterSpacing: '0.04em' },
  searchPill: { flex: 1, maxWidth: '360px', display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 14px', background: colors.cream, border: `1.5px solid ${colors.hairlineStrong}`, borderRadius: `${radius.pill}px`, cursor: 'pointer', color: colors.inkMuted, fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, transition: 'border-color .15s, color .15s' },
  searchText: { flex: 1, textAlign: 'left' },
  kbd: { fontFamily: fonts.body, fontSize: '11px', color: colors.inkFaint, border: `1px solid ${colors.hairlineStrong}`, borderRadius: '4px', padding: '1px 5px' },
  right: { display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 },
  avatar: { width: '28px', height: '28px', borderRadius: '50%' },
  username: { color: colors.ink2, fontFamily: fonts.body, fontSize: `${fontSize.caption}px` },
  logoutBtn: { background: 'transparent', border: 'none', color: colors.inkMuted, cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '6px' },
};
```

- [ ] **Step 2: Update `GuildLayout.jsx` to thread `onOpenPalette` prop**

In `GuildLayout.jsx`, add state for palette open and pass it down:
```jsx
// At top of GuildLayout function body, add:
const [paletteOpen, setPaletteOpen] = React.useState(false);

// Replace <Header /> with:
<Header onOpenPalette={() => setPaletteOpen(true)} />

// After <Header />, add:
<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} guild={guildData?.guild} />
```

Add import at top of `GuildLayout.jsx`:
```jsx
import { CommandPalette } from './CommandPalette';
```

- [ ] **Step 3: Verify build compiles**
```bash
cd plugins/administration/web && npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.` (CommandPalette import will fail until Task 7 — do Task 7 immediately after)

- [ ] **Step 4: Commit** (after Task 7 passes build)
```bash
git add plugins/administration/web/src/components/Header.jsx plugins/administration/web/src/components/GuildLayout.jsx
git commit -m "feat(header): add command palette trigger button"
```

---

## Task 7 — Build `CommandPalette.jsx`

**Files:**
- Create: `plugins/administration/web/src/components/CommandPalette.jsx`

**Interfaces:**
- Consumes: `open: bool`, `onClose: () => void`, `guild: { id, name } | null`
- Produces: overlay modal with fuzzy search over static actions, keyboard navigation

- [ ] **Step 1: Create `CommandPalette.jsx`**

```jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Puzzle, Settings, RotateCcw, ExternalLink } from 'lucide-react';
import { colors, fonts, fontSize, radius } from '../theme';

function buildItems(guild) {
  const gid = guild?.id;
  const nav = gid ? [
    { id: 'go-dashboard', label: 'Dashboard',        icon: LayoutDashboard, action: 'nav', to: `/guild/${gid}`          },
    { id: 'go-plugins',   label: 'Plugins',          icon: Puzzle,          action: 'nav', to: `/guild/${gid}/plugins`  },
    { id: 'go-settings',  label: 'Server Settings',  icon: Settings,        action: 'nav', to: `/guild/${gid}/settings` },
  ] : [];

  const actions = [
    { id: 'restart',  label: 'Restart Bot',  icon: RotateCcw,     action: 'restart'                                        },
    { id: 'github',   label: 'GitHub Repo',  icon: ExternalLink,  action: 'url', url: 'https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot' },
  ];

  return [...nav, ...actions];
}

function fuzzyMatch(query, label) {
  if (!query) return true;
  const q = query.toLowerCase();
  return label.toLowerCase().includes(q);
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); open ? onClose() : null; }
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === 'Enter')     { e.preventDefault(); runItem(filtered[active]); }
      if (e.key === 'Escape')    { onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, active, onClose]);

  useEffect(() => { setActive(0); }, [query]);

  function runItem(item) {
    if (!item) return;
    if (item.action === 'nav') { navigate(item.to); onClose(); }
    if (item.action === 'url') { window.open(item.url, '_blank', 'noopener'); onClose(); }
    if (item.action === 'restart') {
      fetch('/api/plugins/restart', { method: 'POST' });
      onClose();
    }
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
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(30,26,20,0.55)', zIndex: 300, backdropFilter: 'blur(3px)' },
  modal: { position: 'fixed', top: '15vh', left: '50%', transform: 'translateX(-50%)', width: '540px', maxWidth: 'calc(100vw - 32px)', background: colors.cream, borderRadius: `${radius.card}px`, border: `1.5px solid ${colors.hairlineStrong}`, zIndex: 301, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' },
  inputWrap: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', borderBottom: `1.5px solid ${colors.hairline}` },
  input: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: colors.ink, fontFamily: fonts.body, fontSize: `${fontSize.body}px` },
  clearBtn: { background: 'none', border: 'none', cursor: 'pointer', color: colors.inkMuted, padding: '2px', display: 'flex', alignItems: 'center', borderRadius: '4px' },
  results: { maxHeight: '340px', overflowY: 'auto', padding: '8px' },
  resultItem: { width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: 'transparent', border: 'none', borderRadius: `${radius.control}px`, cursor: 'pointer', textAlign: 'left', transition: 'background .1s' },
  resultItemActive: { background: colors.surface1 },
  iconWrap: { width: '30px', height: '30px', borderRadius: `${radius.control - 2}px`, background: colors.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.inkMuted, flexShrink: 0 },
  iconWrapActive: { background: colors.accentTint, color: colors.accent },
  resultLabel: { color: colors.ink, fontFamily: fonts.body, fontSize: `${fontSize.meta}px` },
  noResults: { padding: '24px', textAlign: 'center', color: colors.inkMuted, fontFamily: fonts.body, fontSize: `${fontSize.meta}px` },
  footer: { display: 'flex', gap: '16px', padding: '10px 16px', borderTop: `1.5px solid ${colors.hairline}`, background: colors.surface1 },
  footerHint: { display: 'flex', alignItems: 'center', gap: '5px', color: colors.inkFaint, fontFamily: fonts.body, fontSize: '11px' },
  key: { fontFamily: fonts.body, fontSize: '10px', border: `1px solid ${colors.hairlineStrong}`, borderRadius: '4px', padding: '1px 5px', color: colors.inkMuted, background: colors.cream },
};
```

- [ ] **Step 2: Add global `⌘K` opener in `GuildLayout.jsx`**

In the `useEffect` for the palette open, add a global listener:
```jsx
// Add inside GuildLayout function body (alongside the paletteOpen state):
useEffect(() => {
  const handler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true); }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

- [ ] **Step 3: Verify build compiles**
```bash
cd plugins/administration/web && npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**
```bash
git add plugins/administration/web/src/components/CommandPalette.jsx plugins/administration/web/src/components/GuildLayout.jsx
git commit -m "feat: command palette with fuzzy search and keyboard nav"
```

---

## Task 8 — New `Dashboard.jsx` with widget grid

**Files:**
- Modify: `plugins/administration/web/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `/api/guild/:id/server-stats` → `{ members, botPing, pluginCount, commandCount, uptime }`
- Produces: widget grid page; `ServerStatsWidget` renders 4 stat tiles (Members, Ping, Plugins, Commands) + uptime

- [ ] **Step 1: Rewrite `Dashboard.jsx`**

```jsx
import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { EmptyState } from '../components/UI';
import { Users, Wifi, Puzzle, Zap, Clock } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatTile({ icon: Icon, label, value, sub }) {
  return (
    <div style={tileSt.tile}>
      <div style={tileSt.iconWrap}>
        <Icon size={18} color={colors.accent} />
      </div>
      <div style={tileSt.body}>
        <div style={tileSt.value}>{value}</div>
        <div style={tileSt.label}>{label}</div>
        {sub && <div style={tileSt.sub}>{sub}</div>}
      </div>
    </div>
  );
}

const tileSt = {
  tile: { background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`, padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: '14px', transition: 'border-color .15s' },
  iconWrap: { width: '38px', height: '38px', borderRadius: `${radius.control}px`, background: colors.accentTint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  body: { flex: 1, minWidth: 0 },
  value: { fontFamily: fonts.display, fontSize: `${fontSize.heading}px`, fontWeight: 400, color: colors.ink, lineHeight: 1.1, marginBottom: '2px' },
  label: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, fontWeight: 500, color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: '0.06em' },
  sub: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.inkFaint, marginTop: '2px' },
};

function ServerStatsWidget({ guildId }) {
  const { data, loading } = useApi(`/api/guild/${guildId}/server-stats`);

  return (
    <div style={widgetSt.widget}>
      <div style={widgetSt.header}>
        <span style={widgetSt.title}>Server Stats</span>
        <span style={widgetSt.chip}>CORE</span>
      </div>
      {loading ? (
        <div style={widgetSt.skeleton}>Loading…</div>
      ) : (
        <div style={widgetSt.grid}>
          <StatTile icon={Users}  label="Members"  value={data?.members?.toLocaleString() || '—'} />
          <StatTile icon={Wifi}   label="Bot Ping" value={data?.botPing ? `${data.botPing}ms` : '—'} sub={data?.botPing < 100 ? 'Excellent' : data?.botPing < 250 ? 'Good' : 'High'} />
          <StatTile icon={Puzzle} label="Plugins"  value={data?.pluginCount ?? '—'} sub="loaded" />
          <StatTile icon={Zap}    label="Commands" value={data?.commandCount ?? '—'} sub="registered" />
        </div>
      )}
      {!loading && data?.uptime != null && (
        <div style={widgetSt.uptimeRow}>
          <Clock size={13} color={colors.pine} />
          <span style={widgetSt.uptimeText}>Uptime {formatUptime(data.uptime)}</span>
        </div>
      )}
    </div>
  );
}

const widgetSt = {
  widget: { background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`, overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1.5px solid ${colors.hairline}` },
  title: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600, color: colors.ink },
  chip: { fontFamily: fonts.body, fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: colors.pine, background: colors.pineTint, borderRadius: `${radius.pill}px`, padding: '2px 8px' },
  skeleton: { padding: '24px', color: colors.inkMuted, fontFamily: fonts.body, fontSize: `${fontSize.meta}px` },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1px', background: colors.hairline },
  uptimeRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', borderTop: `1.5px solid ${colors.hairline}`, background: colors.cream },
  uptimeText: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.inkMuted },
};

export function Dashboard() {
  const { guildData } = useOutletContext();
  const { guild } = guildData || {};

  if (!guild) return null;

  return (
    <div style={styles.page}>
      <div style={styles.pageHead}>
        <h1 style={styles.pageTitle}>Dashboard</h1>
        <p style={styles.pageSubtitle}>{guild.name}</p>
      </div>

      {/* Widget grid — 12-col, auto-flow */}
      <div style={styles.grid}>
        <div style={styles.widgetSpan2}>
          <ServerStatsWidget guildId={guild.id} />
        </div>

        {/* Placeholder for future plugin-added widgets */}
        <div style={styles.widgetSpan1}>
          <div style={{ ...widgetSt.widget, display: 'flex', minHeight: '200px' }}>
            <EmptyState
              icon={<Puzzle size={28} />}
              title="Add a widget"
              body="Plugins can add widgets here."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { maxWidth: '1200px', padding: '0 2px' },
  pageHead: { marginBottom: '24px' },
  pageTitle: { fontFamily: fonts.display, fontSize: `${fontSize.heading}px`, fontWeight: 400, color: colors.ink, marginBottom: '2px' },
  pageSubtitle: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
  widgetSpan2: { gridColumn: 'span 2' },
  widgetSpan1: { gridColumn: 'span 1' },
};
```

- [ ] **Step 2: Build and verify**
```bash
cd plugins/administration/web && npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**
```bash
git add plugins/administration/web/src/pages/Dashboard.jsx
git commit -m "feat(dashboard): widget grid with ServerStatsWidget"
```

---

## Task 9 — Rewrite `Plugins.jsx` (centrepiece)

**Files:**
- Modify: `plugins/administration/web/src/pages/Plugins.jsx`

**Interfaces:**
- Consumes: `GET /api/plugins` → `{ plugins: PluginRecord[] }` where `PluginRecord = { name, displayName, version, description, author, category, enabled, lastError, hasBrochure, commands: string[], npmPackage }`
- Consumes: `GET /api/plugins/brochure/:name` → markdown string (plain text response)
- Consumes: `POST /api/plugins/install` body `{ package: string }`
- Consumes: `POST /api/plugins/uninstall` body `{ name: string }`
- Consumes: `POST /api/plugins/reload/:name`
- Produces: tabbed plugin manager page with slide-over detail panel

- [ ] **Step 1: Rewrite `Plugins.jsx`**

```jsx
import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, RefreshCw, Trash2, Package, BookOpen, AlertCircle, CheckCircle2, Puzzle, Download, ExternalLink, ChevronRight } from 'lucide-react';
import { Badge, StatusDot, EmptyState, SlideOver, Button, Input } from '../components/UI';
import { colors, fonts, radius, fontSize } from '../theme';

const CORE_ALWAYS = new Set(['core', 'administration']);

const CATEGORY_LABELS = {
  moderation: 'Moderation', features: 'Features',
  entertainment: 'Entertainment', utility: 'Utility',
  analytics: 'Analytics',
};

function pluginStatus(p) {
  if (p.lastError) return 'error';
  if (!p.enabled) return 'disabled';
  return 'ok';
}

function pluginBadgeVariant(p) {
  if (p.lastError) return 'danger';
  if (!p.enabled) return 'default';
  return 'success';
}

function pluginBadgeLabel(p) {
  if (p.lastError) return 'Error';
  if (!p.enabled) return 'Disabled';
  return 'Active';
}

function PluginCard({ plugin, onSelect, isBrowse }) {
  const initial = (plugin.displayName || plugin.name).slice(0, 2).toUpperCase();
  return (
    <button
      onClick={() => onSelect(plugin)}
      style={cardSt.card}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.hairlineStrong; e.currentTarget.style.background = colors.surface2; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.hairline; e.currentTarget.style.background = colors.surface1; }}
    >
      <div style={cardSt.initial}>{initial}</div>
      <div style={cardSt.body}>
        <div style={cardSt.nameRow}>
          <span style={cardSt.name}>{plugin.displayName || plugin.name}</span>
          {!isBrowse && <Badge label={pluginBadgeLabel(plugin)} variant={pluginBadgeVariant(plugin)} />}
        </div>
        {plugin.version && <span style={cardSt.version}>v{plugin.version}</span>}
        <p style={cardSt.desc}>{plugin.description || 'No description.'}</p>
        {!isBrowse && plugin.commands?.length > 0 && (
          <div style={cardSt.commands}>
            {plugin.commands.slice(0, 4).map((cmd) => (
              <span key={cmd} style={cardSt.cmd}>/{cmd}</span>
            ))}
            {plugin.commands.length > 4 && <span style={cardSt.cmd}>+{plugin.commands.length - 4}</span>}
          </div>
        )}
      </div>
      <ChevronRight size={16} color={colors.inkFaint} style={{ flexShrink: 0 }} />
    </button>
  );
}

const cardSt = {
  card: { width: '100%', display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '16px', background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`, cursor: 'pointer', textAlign: 'left', transition: 'background .15s, border-color .15s' },
  initial: { width: '44px', height: '44px', borderRadius: `${radius.control}px`, background: colors.accentTint, color: colors.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontSize: `${fontSize.title}px`, fontWeight: 600, flexShrink: 0, letterSpacing: '0.02em' },
  body: { flex: 1, minWidth: 0 },
  nameRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px', flexWrap: 'wrap' },
  name: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600, color: colors.ink },
  version: { fontFamily: fonts.body, fontSize: '11px', color: colors.inkFaint, display: 'block', marginBottom: '4px' },
  desc: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.inkMuted, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  commands: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' },
  cmd: { fontFamily: fonts.body, fontSize: '11px', color: colors.pine, background: colors.pineTint, borderRadius: `${radius.pill}px`, padding: '1px 7px' },
};

function DetailPanel({ plugin, onClose, onReload, onUninstall, reloading, uninstalling }) {
  const [brochure, setBrochure] = useState(null);
  const [brochureLoading, setBrochureLoading] = useState(false);

  useEffect(() => {
    if (!plugin?.hasBrochure) { setBrochure(null); return; }
    setBrochureLoading(true);
    fetch(`/api/plugins/${plugin.name}/brochure`)
      .then((r) => r.ok ? r.text() : null)
      .then((t) => setBrochure(t))
      .catch(() => setBrochure(null))
      .finally(() => setBrochureLoading(false));
  }, [plugin?.name]);

  if (!plugin) return null;

  const isCore = CORE_ALWAYS.has(plugin.name);

  return (
    <SlideOver open={!!plugin} onClose={onClose} title={plugin.displayName || plugin.name}>
      <div style={panelSt.section}>
        <div style={panelSt.metaGrid}>
          <div style={panelSt.metaItem}>
            <span style={panelSt.metaLabel}>Status</span>
            <span style={panelSt.metaValue}>
              <StatusDot status={pluginStatus(plugin)} />
              {' '}{pluginBadgeLabel(plugin)}
            </span>
          </div>
          {plugin.version && (
            <div style={panelSt.metaItem}>
              <span style={panelSt.metaLabel}>Version</span>
              <span style={panelSt.metaValue}>v{plugin.version}</span>
            </div>
          )}
          {plugin.author && (
            <div style={panelSt.metaItem}>
              <span style={panelSt.metaLabel}>Author</span>
              <span style={panelSt.metaValue}>{plugin.author}</span>
            </div>
          )}
          {plugin.category && (
            <div style={panelSt.metaItem}>
              <span style={panelSt.metaLabel}>Category</span>
              <span style={panelSt.metaValue}>{CATEGORY_LABELS[plugin.category] || plugin.category}</span>
            </div>
          )}
        </div>
      </div>

      {plugin.description && (
        <div style={panelSt.section}>
          <p style={panelSt.description}>{plugin.description}</p>
        </div>
      )}

      {plugin.lastError && (
        <div style={panelSt.errorBox}>
          <AlertCircle size={15} color={colors.dangerText} style={{ flexShrink: 0 }} />
          <span style={panelSt.errorText}>{plugin.lastError}</span>
        </div>
      )}

      {plugin.commands?.length > 0 && (
        <div style={panelSt.section}>
          <div style={panelSt.sectionLabel}>Commands</div>
          <div style={panelSt.cmdGrid}>
            {plugin.commands.map((cmd) => (
              <span key={cmd} style={panelSt.cmdPill}>/{cmd}</span>
            ))}
          </div>
        </div>
      )}

      {brochureLoading && <div style={panelSt.brochureLoading}>Loading docs…</div>}
      {brochure && (
        <div style={panelSt.section}>
          <div style={panelSt.sectionLabel}>Documentation</div>
          <pre style={panelSt.brochure}>{brochure}</pre>
        </div>
      )}

      {!isCore && (
        <div style={panelSt.actions}>
          {plugin.hotReloadEligible && (
            <Button onClick={() => onReload(plugin.name)} loading={reloading} variant="secondary">
              <RefreshCw size={14} /> Reload
            </Button>
          )}
          <Button onClick={() => onUninstall(plugin.name)} loading={uninstalling} variant="danger">
            <Trash2 size={14} /> Uninstall
          </Button>
        </div>
      )}
    </SlideOver>
  );
}

const panelSt = {
  section: { marginBottom: '20px' },
  sectionLabel: { fontFamily: fonts.body, fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', color: colors.inkMuted, textTransform: 'uppercase', marginBottom: '8px' },
  metaGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  metaItem: { display: 'flex', flexDirection: 'column', gap: '2px' },
  metaLabel: { fontFamily: fonts.body, fontSize: '11px', color: colors.inkFaint, textTransform: 'uppercase', letterSpacing: '0.08em' },
  metaValue: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink, display: 'flex', alignItems: 'center', gap: '6px' },
  description: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink2, lineHeight: 1.65 },
  errorBox: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px', background: colors.dangerTint, border: `1.5px solid ${colors.danger}`, borderRadius: `${radius.control}px`, marginBottom: '16px' },
  errorText: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.dangerText, lineHeight: 1.5 },
  cmdGrid: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  cmdPill: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.pine, background: colors.pineTint, borderRadius: `${radius.pill}px`, padding: '3px 10px' },
  brochureLoading: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, padding: '12px 0' },
  brochure: { fontFamily: "'SFMono-Regular','Consolas','Monaco',monospace", fontSize: '12px', color: colors.ink2, background: colors.surface2, border: `1px solid ${colors.hairline}`, borderRadius: `${radius.control}px`, padding: '14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 },
  actions: { display: 'flex', gap: '10px', marginTop: '8px', paddingTop: '16px', borderTop: `1.5px solid ${colors.hairline}` },
};

function InstallModal({ open, onClose, onInstall, installing }) {
  const [value, setValue] = useState('');
  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(30,26,20,0.45)', zIndex: 200, backdropFilter: 'blur(2px)' }} />
      <div style={modalSt.modal}>
        <div style={modalSt.head}>
          <span style={modalSt.title}>Install Plugin</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.inkMuted, padding: '4px', borderRadius: '6px', display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={modalSt.body}>
          <Input label="npm package name" value={value} onChange={setValue} placeholder="adb-plugin-my-feature" />
          <p style={modalSt.hint}>Package must export a <code style={modalSt.code}>load(ctx)</code> function and include a <code style={modalSt.code}>plugin.json</code> manifest.</p>
        </div>
        <div style={modalSt.footer}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onInstall(value)} loading={installing} disabled={!value.trim()}>
            <Download size={14} /> Install
          </Button>
        </div>
      </div>
    </>
  );
}

const modalSt = {
  modal: { position: 'fixed', top: '20vh', left: '50%', transform: 'translateX(-50%)', width: '440px', maxWidth: 'calc(100vw - 32px)', background: colors.cream, border: `1.5px solid ${colors.hairlineStrong}`, borderRadius: `${radius.card}px`, zIndex: 201, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1.5px solid ${colors.hairline}` },
  title: { fontFamily: fonts.display, fontSize: `${fontSize.title}px`, fontWeight: 400, color: colors.ink },
  body: { padding: '20px' },
  hint: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.inkMuted, marginTop: '10px', lineHeight: 1.5 },
  code: { fontFamily: "'SFMono-Regular','Consolas','Monaco',monospace", fontSize: '12px', background: colors.surface2, padding: '1px 5px', borderRadius: '4px' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px', borderTop: `1.5px solid ${colors.hairline}` },
};

const TABS = ['Installed', 'Browse', 'Core'];

export function Plugins() {
  const [plugins, setPlugins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Installed');
  const [query, setQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [marketplacePlugins, setMarketplacePlugins] = useState([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);

  async function loadPlugins() {
    setLoading(true);
    try {
      const res = await fetch('/api/plugins');
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadPlugins(); }, []);

  useEffect(() => {
    if (tab !== 'Browse' || marketplacePlugins.length > 0) return;
    setMarketplaceLoading(true);
    fetch('/api/plugins/marketplace')
      .then((r) => r.ok ? r.json() : { plugins: [] })
      .then((d) => setMarketplacePlugins(d.plugins || []))
      .catch(() => {})
      .finally(() => setMarketplaceLoading(false));
  }, [tab]);

  async function handleInstall(pkg) {
    if (!pkg.trim()) return;
    setInstalling(true);
    try {
      const res = await fetch('/api/plugins/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package: pkg.trim() }) });
      if (res.ok) { setShowInstall(false); await loadPlugins(); }
    } catch {}
    setInstalling(false);
  }

  async function handleReload(name) {
    setReloading(true);
    try {
      await fetch(`/api/plugins/reload/${name}`, { method: 'POST' });
      await loadPlugins();
      setSelectedPlugin((p) => plugins.find((x) => x.name === p?.name) || null);
    } catch {}
    setReloading(false);
  }

  async function handleUninstall(name) {
    setUninstalling(true);
    try {
      const res = await fetch('/api/plugins/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (res.ok) { setSelectedPlugin(null); await loadPlugins(); }
    } catch {}
    setUninstalling(false);
  }

  const lq = query.toLowerCase();
  const installedPlugins = plugins.filter((p) => !CORE_ALWAYS.has(p.name));
  const corePlugins = plugins.filter((p) => CORE_ALWAYS.has(p.name));

  function filterList(list) {
    return list.filter((p) => !lq || (p.displayName || p.name).toLowerCase().includes(lq) || p.description?.toLowerCase().includes(lq));
  }

  function tabList() {
    if (tab === 'Installed') return filterList(installedPlugins);
    if (tab === 'Browse')    return filterList(marketplacePlugins);
    if (tab === 'Core')      return filterList(corePlugins);
    return [];
  }

  const visible = tabList();

  return (
    <div style={styles.page}>
      <div style={styles.pageHead}>
        <div>
          <h1 style={styles.pageTitle}>Plugins</h1>
          <p style={styles.pageSubtitle}>{installedPlugins.length} installed · {installedPlugins.filter((p) => p.enabled).length} active</p>
        </div>
        <Button onClick={() => setShowInstall(true)}>
          <Plus size={15} /> Install Plugin
        </Button>
      </div>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}>
            {t}
            {t === 'Installed' && <span style={styles.tabCount}>{installedPlugins.length}</span>}
            {t === 'Core' && <span style={styles.tabCount}>{corePlugins.length}</span>}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={styles.searchRow}>
        <div style={styles.searchWrap}>
          <Search size={14} color={colors.inkMuted} style={{ flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tab.toLowerCase()} plugins…`}
            style={styles.searchInput}
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={styles.loadingMsg}>Loading plugins…</div>
      ) : tab === 'Browse' && marketplaceLoading ? (
        <div style={styles.loadingMsg}>Fetching marketplace…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Puzzle size={32} />}
          title={tab === 'Browse' ? 'No marketplace plugins found' : `No ${tab.toLowerCase()} plugins`}
          body={tab === 'Installed' ? 'Install plugins from the Browse tab or via npm package name.' : undefined}
          action={tab === 'Installed' ? <Button onClick={() => setTab('Browse')}><ExternalLink size={14} /> Browse Marketplace</Button> : undefined}
        />
      ) : (
        <div style={styles.list}>
          {visible.map((p) => (
            <PluginCard key={p.name} plugin={p} onSelect={setSelectedPlugin} isBrowse={tab === 'Browse'} />
          ))}
        </div>
      )}

      <DetailPanel
        plugin={selectedPlugin}
        onClose={() => setSelectedPlugin(null)}
        onReload={handleReload}
        onUninstall={handleUninstall}
        reloading={reloading}
        uninstalling={uninstalling}
      />
      <InstallModal open={showInstall} onClose={() => setShowInstall(false)} onInstall={handleInstall} installing={installing} />
    </div>
  );
}

const styles = {
  page: { maxWidth: '900px' },
  pageHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', gap: '16px' },
  pageTitle: { fontFamily: fonts.display, fontSize: `${fontSize.heading}px`, fontWeight: 400, color: colors.ink, marginBottom: '2px' },
  pageSubtitle: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted },
  tabBar: { display: 'flex', gap: '2px', marginBottom: '16px', borderBottom: `1.5px solid ${colors.hairline}`, paddingBottom: '0' },
  tab: { display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 400, color: colors.inkMuted, transition: 'color .15s', marginBottom: '-1.5px' },
  tabActive: { color: colors.ink, borderBottomColor: colors.accent, fontWeight: 600 },
  tabCount: { fontFamily: fonts.body, fontSize: '11px', background: colors.surface2, color: colors.inkMuted, borderRadius: `${radius.pill}px`, padding: '1px 7px', minWidth: '20px', textAlign: 'center' },
  searchRow: { marginBottom: '16px' },
  searchWrap: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.control}px`, maxWidth: '400px' },
  searchInput: { background: 'transparent', border: 'none', outline: 'none', color: colors.ink, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, flex: 1 },
  loadingMsg: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, padding: '24px 0' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
};
```

- [ ] **Step 2: Build**
```bash
cd plugins/administration/web && npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**
```bash
git add plugins/administration/web/src/pages/Plugins.jsx
git commit -m "feat(plugins): full rewrite — tabs, slide-over panel, install modal"
```

---

## Task 10 — Slim down `Settings.jsx`

**Files:**
- Modify: `plugins/administration/web/src/pages/Settings.jsx`

**Interfaces:**
- Consumes: `guildData.guild` (id, name, memberCount), `guildData.config` (raw object)
- Produces: server info rows, raw config JSON viewer (collapsed), restart button (owner-only)

- [ ] **Step 1: Rewrite `Settings.jsx`**

```jsx
import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../components/UI';
import { colors, fonts, radius, fontSize } from '../theme';

export function GuildSettings() {
  const { guildData } = useOutletContext();
  const { guild, config } = guildData || {};
  const { user } = useAuth();
  const [isOwner, setIsOwner] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  React.useEffect(() => {
    fetch('/api/me').then((r) => r.ok ? r.json() : {}).then((d) => setIsOwner(!!d.isOwner)).catch(() => {});
  }, [user]);

  async function handleRestart() {
    if (!window.confirm('Restart the bot? This briefly disconnects all services.')) return;
    setRestarting(true);
    try {
      await fetch('/api/plugins/restart', { method: 'POST' });
    } catch {}
    setRestarting(false);
  }

  if (!guild) return null;

  const infoRows = [
    { label: 'Server ID',     value: guild.id },
    { label: 'Members',       value: guild.memberCount?.toLocaleString() },
  ];

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Settings</h1>
      <p style={styles.pageSubtitle}>Server info and bot controls for {guild.name}</p>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>Server Info</div>
        <div style={styles.card}>
          {infoRows.map(({ label, value }) => (
            <div key={label} style={styles.infoRow}>
              <span style={styles.infoLabel}>{label}</span>
              <span style={styles.infoValue}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Raw config accordion */}
      <div style={styles.section}>
        <button
          onClick={() => setConfigOpen((o) => !o)}
          style={styles.accordionBtn}
        >
          <span style={styles.accordionLabel}>Raw Config</span>
          {configOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {configOpen && (
          <pre style={styles.configBlock}>{JSON.stringify(config, null, 2)}</pre>
        )}
      </div>

      {isOwner && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Danger Zone</div>
          <div style={styles.card}>
            <div style={styles.dangerRow}>
              <div>
                <div style={styles.dangerTitle}>Restart Bot</div>
                <div style={styles.dangerDesc}>Reloads all plugins and reconnects to Discord. Takes ~5 seconds.</div>
              </div>
              <Button variant="danger" onClick={handleRestart} loading={restarting}>
                <RotateCcw size={14} /> Restart
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { maxWidth: '720px' },
  pageTitle: { fontFamily: fonts.display, fontSize: `${fontSize.heading}px`, fontWeight: 400, color: colors.ink, marginBottom: '2px' },
  pageSubtitle: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, marginBottom: '28px' },
  section: { marginBottom: '24px' },
  sectionLabel: { fontFamily: fonts.body, fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', color: colors.inkMuted, textTransform: 'uppercase', marginBottom: '8px' },
  card: { background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`, overflow: 'hidden' },
  infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${colors.hairline}` },
  infoLabel: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted },
  infoValue: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink, fontWeight: 500, fontVariantNumeric: 'tabular-nums' },
  accordionBtn: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '12px 16px', background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`, cursor: 'pointer', color: colors.ink2, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, transition: 'background .15s' },
  accordionLabel: { fontWeight: 500 },
  configBlock: { fontFamily: "'SFMono-Regular','Consolas','Monaco',monospace", fontSize: '12px', color: colors.ink2, background: colors.surface2, border: `1.5px solid ${colors.hairline}`, borderRadius: `0 0 ${radius.card}px ${radius.card}px`, padding: '16px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, overflowX: 'auto', borderTop: 'none', maxHeight: '400px', overflowY: 'auto' },
  dangerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px' },
  dangerTitle: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600, color: colors.ink, marginBottom: '2px' },
  dangerDesc: { fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.inkMuted, lineHeight: 1.5 },
};
```

- [ ] **Step 2: Build**
```bash
cd plugins/administration/web && npm run build 2>&1 | tail -5
```
Expected: `Compiled successfully.`

- [ ] **Step 3: Commit**
```bash
git add plugins/administration/web/src/pages/Settings.jsx
git commit -m "feat(settings): slim down to server info, raw config, restart"
```

---

## Task 11 — Update landing page `public/index.html` modules section

The landing page (`public/index.html`) still advertises "AI Assistant", "Birthdays", "Economy" etc. as hardcoded module tags and in the ticker. Replace with accurate, plugin-centric messaging.

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Produces: updated ticker, updated module tags, updated feature card copy — no mention of specific removed features

- [ ] **Step 1: Update ticker feature list in `public/index.html`**

Find the `const FEATURES = [...]` array in the script tag (~line 1073) and replace with:
```js
const FEATURES = [
  'Plugin-Driven', 'Self-Hosted', 'Open Source', 'Dashboard Included',
  'Hot Reload', 'Per-Guild Config', 'Plugin Marketplace', 'No Subscriptions',
  'Extend Anything', 'Your Data', 'No Lock-in', 'Community Plugins',
];
```

- [ ] **Step 2: Update the modules section tags** (~line 947–961)

Replace the entire `<div class="module-tags" ...>` block content with:
```html
<div class="module-tags reveal" role="list" aria-label="Available plugins">
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Plugin Marketplace</span>
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Web Dashboard</span>
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Per-guild Config</span>
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Hot Reload</span>
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Role Management</span>
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Activity Logs</span>
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Scheduled Tasks</span>
  <span class="module-tag" role="listitem"><span class="module-dot" aria-hidden="true"></span>Self-Hosted</span>
</div>
```

- [ ] **Step 3: Update the "AI that listens" feature card** (~line 902–904)

The fc-2 card now advertises the plugin system instead of AI:
```html
<article class="feature-card fc-2 reveal" aria-labelledby="fc2-title">
  <p class="fc-eyebrow">Extensibility</p>
  <h3 class="fc-title" id="fc2-title">Grows with community plugins.</h3>
  <p class="fc-body">Install from the marketplace or write your own in under 50 lines. Each plugin is isolated, hot-reloadable, and cleanly removable.</p>
</article>
```

- [ ] **Step 4: Commit**
```bash
git add public/index.html
git commit -m "chore(landing): update modules section for plugin-centric messaging"
```

---

## Task 12 — Final build and smoke test

**Files:** none new

- [ ] **Step 1: Clean build**
```bash
cd plugins/administration/web && rm -rf build && npm run build 2>&1 | tail -10
```
Expected: `Compiled successfully.`

- [ ] **Step 2: Start bot and verify**
```bash
node index.js
```
Check: no `Error` lines on startup, `Administration dashboard serving` log line appears

- [ ] **Step 3: Navigate to dashboard**

Open `http://localhost:<PORT>/dashboard/`
Expected: Login page loads (VAISH wordmark, Discord sign-in button)

After login:
- Guild picker shows available servers
- Click a server → Dashboard page with `ServerStatsWidget` showing 4 stat tiles
- Sidebar shows: Dashboard, Plugins, Settings only
- Plugins page loads with Installed/Browse/Core tabs
- `⌘K` opens command palette, arrow keys navigate, Enter runs action
- Settings page shows server info rows and (if owner) Restart button

- [ ] **Step 4: Final commit**
```bash
git add -A
git commit -m "chore: final build artifacts"
```
