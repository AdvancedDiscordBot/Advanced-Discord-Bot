import React, { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { useApiFetch } from "../hooks/useApi";
import { Badge, StatusDot, EmptyState, SlideOver, Button, Input } from "../components/UI";
import { colors, fonts, fontSize, radius } from "../theme";
import {
  Package, Search, Download, Trash2,
  Puzzle, Shield, X, BookOpen, Zap, Gamepad2, Wrench, BarChart2,
  AlertCircle, RefreshCw, ArrowUpRight,
} from "lucide-react";

const TABS = ["Installed", "Browse", "Core"];

const CATEGORY_META = {
  features:      { label: "Features",      Icon: Zap },
  moderation:    { label: "Moderation",    Icon: Shield },
  entertainment: { label: "Entertainment", Icon: Gamepad2 },
  utility:       { label: "Utility",       Icon: Wrench },
  analytics:     { label: "Analytics",     Icon: BarChart2 },
};

export function Plugins() {
  const { guildData } = useOutletContext();
  const guild = guildData?.guild;
  const [tab, setTab] = useState("Installed");
  const [plugins, setPlugins] = useState([]);
  const [market, setMarket] = useState([]);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(null); // pluginName being acted on
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [customPackage, setCustomPackage] = useState("");
  const [detailPlugin, setDetailPlugin] = useState(null);
  const [brochureContent, setBrochureContent] = useState("");
  const [brochureLoading, setBrochureLoading] = useState(false);

  const { request } = useApiFetch();

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [pluginsRes, catRes] = await Promise.all([
        request("/api/plugins"),
        request("/api/plugins/categories").catch(() => ({ categories: [] })),
      ]);
      setPlugins(pluginsRes?.plugins || []);
      setCategories(catRes?.categories || []);
      const marketRes = await request("/api/plugins/marketplace").catch(() => ({ plugins: [] }));
      setMarket(marketRes?.plugins || []);
    } catch (err) {
      console.error("Failed to load plugins:", err);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleInstall(pkgName) {
    setOperating(pkgName);
    try {
      await request("/api/plugins/install", { method: "POST", body: JSON.stringify({ packageName: pkgName }) });
      await loadAll();
    } catch (err) {
      console.error("Install failed:", err);
    } finally {
      setOperating(null);
    }
  }

  async function handleUninstall(pkgName) {
    if (!window.confirm(`Uninstall ${pkgName}? This removes all its data.`)) return;
    setOperating(pkgName);
    try {
      await request("/api/plugins/uninstall", { method: "POST", body: JSON.stringify({ packageName: pkgName }) });
      if (detailPlugin?.name === pkgName) setDetailPlugin(null);
      await loadAll();
    } catch (err) {
      console.error("Uninstall failed:", err);
    } finally {
      setOperating(null);
    }
  }

  async function handleReload(pluginName) {
    setOperating(pluginName);
    try {
      await request(`/api/plugins/reload/${pluginName}`, { method: "POST" });
      await loadAll();
    } catch (err) {
      console.error("Reload failed:", err);
    } finally {
      setOperating(null);
    }
  }

  async function openDetail(plugin) {
    setDetailPlugin(plugin);
    setBrochureContent("");
    setBrochureLoading(true);
    try {
      if (plugin._local) {
        const res = await request(`/api/plugins/${plugin.name}/brochure`).catch(() => null);
        setBrochureContent(res?.content || `# ${plugin.displayName || plugin.name}\n\n${plugin.description || ""}`);
      } else {
        const pkg = plugin.npmPackage || plugin.name;
        const res = await fetch(`https://registry.npmjs.org/${pkg}`);
        if (res.ok) {
          const data = await res.json();
          setBrochureContent(data.readme || `# ${plugin.displayName || plugin.name}\n\n${plugin.description || ""}`);
        } else {
          setBrochureContent(`# ${plugin.displayName || plugin.name}\n\n${plugin.description || ""}`);
        }
      }
    } catch {
      setBrochureContent(`# ${plugin.displayName || plugin.name}\n\n${plugin.description || ""}`);
    } finally {
      setBrochureLoading(false);
    }
  }

  async function handleCustomInstall() {
    if (!customPackage.trim()) return;
    await handleInstall(customPackage.trim());
    setShowInstallModal(false);
    setCustomPackage("");
  }

  const installedNames = new Set(plugins.map((p) => p.name));
  const corePlugins = plugins.filter((p) => p.isCore);
  const userPlugins = plugins.filter((p) => !p.isCore);
  const availableMarket = market.filter((p) => !installedNames.has(p.npmPackage) && !installedNames.has(p.name));

  const filteredInstalled = userPlugins.filter((p) =>
    !query || (p.displayName || p.name).toLowerCase().includes(query.toLowerCase())
  );
  const filteredMarket = availableMarket.filter((p) => {
    const nameMatch = !query || (p.displayName || p.name).toLowerCase().includes(query.toLowerCase());
    const catMatch = !selectedCat || p.category === selectedCat;
    return nameMatch && catMatch;
  });

  if (!guild) return null;

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Plugins</h1>
          <p style={s.pageSubtitle}>Manage and discover plugins for {guild.name}</p>
        </div>
        <div style={s.headerActions}>
          <button style={s.ghostBtn} onClick={() => window.open("https://github.com/adb-plugin-registry/registry", "_blank")}>
            <ArrowUpRight size={14} />
            Submit Plugin
          </button>
          <button style={s.primaryBtn} onClick={() => setShowInstallModal(true)}>
            <Download size={14} />
            Install Custom
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabBar}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>
            {t}
            {t === "Installed" && userPlugins.length > 0 && (
              <span style={{ ...s.tabCount, ...(tab === t ? s.tabCountActive : {}) }}>
                {userPlugins.length}
              </span>
            )}
            {t === "Core" && (
              <span style={{ ...s.tabCount, ...(tab === t ? s.tabCountActive : {}) }}>
                {corePlugins.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search + filters (Browse tab) */}
      {tab === "Browse" && (
        <div style={s.filterBar}>
          <div style={s.searchBox}>
            <Search size={15} color={colors.inkMuted} />
            <input
              type="text"
              placeholder="Search plugins…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={s.searchInput}
            />
            {query && (
              <button style={s.clearBtn} onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            )}
          </div>
          <div style={s.pills}>
            {[{ id: "", label: "All" }, ...categories.map((c) => ({ id: c.id, label: c.name }))].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCat(cat.id)}
                style={{ ...s.pill, ...(selectedCat === cat.id ? s.pillActive : {}) }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab content */}
      <div style={s.content}>
        {tab === "Installed" && (
          loading ? <SkeletonGrid /> :
          filteredInstalled.length === 0 ? (
            <EmptyState
              icon={<Puzzle size={40} />}
              title={query ? "No matching plugins" : "No plugins installed"}
              body={query ? "Try a different search." : "Head to Browse to discover and install plugins."}
              action={!query && (
                <button style={s.primaryBtn} onClick={() => setTab("Browse")}>
                  Browse plugins
                </button>
              )}
            />
          ) : (
            <div style={s.grid}>
              {filteredInstalled.map((p) => (
                <PluginCard
                  key={p.name}
                  plugin={{ ...p, _local: true }}
                  onDetail={() => openDetail({ ...p, _local: true })}
                  onUninstall={() => handleUninstall(p.npmPackage || p.name)}
                  onReload={() => handleReload(p.name)}
                  operating={operating === p.name || operating === (p.npmPackage || p.name)}
                />
              ))}
            </div>
          )
        )}

        {tab === "Browse" && (
          loading ? <SkeletonGrid /> :
          filteredMarket.length === 0 ? (
            <EmptyState
              icon={<Search size={40} />}
              title="No plugins found"
              body="Try a different search term or category."
            />
          ) : (
            <div style={s.grid}>
              {filteredMarket.map((p) => (
                <PluginCard
                  key={p.npmPackage || p.name}
                  plugin={p}
                  marketplace
                  onDetail={() => openDetail(p)}
                  onInstall={() => handleInstall(p.npmPackage || p.name)}
                  operating={operating === p.name || operating === (p.npmPackage || p.name)}
                />
              ))}
            </div>
          )
        )}

        {tab === "Core" && (
          <div style={s.coreList}>
            <p style={s.coreNote}>
              Core plugins are always active and cannot be removed. They power the VAISH foundation.
            </p>
            {corePlugins.length === 0 ? (
              <EmptyState icon={<Shield size={40} />} title="No core plugins reported" body="" />
            ) : (
              corePlugins.map((p) => (
                <CorePluginRow key={p.name} plugin={p} onDetail={() => openDetail({ ...p, _local: true })} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Detail SlideOver */}
      <SlideOver
        open={!!detailPlugin}
        onClose={() => setDetailPlugin(null)}
        title={detailPlugin?.displayName || detailPlugin?.name || "Plugin"}
      >
        {detailPlugin && (
          <PluginDetail
            plugin={detailPlugin}
            brochureContent={brochureContent}
            brochureLoading={brochureLoading}
            operating={operating === detailPlugin.name || operating === (detailPlugin.npmPackage || detailPlugin.name)}
            onInstall={() => {
              handleInstall(detailPlugin.npmPackage || detailPlugin.name);
              setDetailPlugin(null);
            }}
            onUninstall={() => {
              handleUninstall(detailPlugin.npmPackage || detailPlugin.name);
            }}
            onReload={() => handleReload(detailPlugin.name)}
          />
        )}
      </SlideOver>

      {/* Custom install modal */}
      {showInstallModal && (
        <div style={s.overlay} onClick={() => setShowInstallModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Install Custom Plugin</h2>
              <button style={s.modalClose} onClick={() => setShowInstallModal(false)}>
                <X size={18} />
              </button>
            </div>
            <p style={s.modalHint}>npm package name (must start with <code style={s.inlineCode}>adb-plugin-</code>)</p>
            <Input
              value={customPackage}
              onChange={setCustomPackage}
              placeholder="adb-plugin-my-plugin"
            />
            <div style={s.modalActions}>
              <Button variant="secondary" onClick={() => setShowInstallModal(false)}>Cancel</Button>
              <Button onClick={handleCustomInstall} disabled={!customPackage.trim() || !!operating}>
                {operating ? "Installing…" : "Install"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <style>{animationCSS}</style>
    </div>
  );
}

/* ── PLUGIN CARD ─────────────────────────────────────────────── */
function PluginCard({ plugin, marketplace, onDetail, onInstall, onUninstall, onReload, operating }) {
  const catMeta = CATEGORY_META[plugin.category] || null;
  const hasError = !!plugin.lastError;
  const isLoaded = plugin.enabled && !hasError;

  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        <div style={s.cardIcon}>
          <Package size={20} color={colors.accent} />
        </div>
        <div style={s.cardBadges}>
          {catMeta && (
            <span style={s.catPill}>
              <catMeta.Icon size={11} />
              {catMeta.label}
            </span>
          )}
          {plugin.verified && <Badge label="Verified" variant="success" />}
          {!marketplace && (
            hasError ? <Badge label="Error" variant="danger" /> :
            !plugin.enabled ? <Badge label="Disabled" variant="default" /> :
            null
          )}
        </div>
      </div>

      <div style={s.cardBody}>
        <h3 style={s.cardName}>{plugin.displayName || plugin.name}</h3>
        <p style={s.cardDesc}>{plugin.description || "No description provided."}</p>
      </div>

      <div style={s.cardMeta}>
        <span style={s.metaText}>by {plugin.author || "Unknown"}</span>
        <span style={s.metaDot}>·</span>
        <span style={s.metaText}>v{plugin.version || "1.0.0"}</span>
        {!marketplace && <StatusDot status={isLoaded ? "ok" : hasError ? "error" : "disabled"} />}
      </div>

      <div style={s.cardActions}>
        <button style={s.docsBtn} onClick={onDetail}>
          <BookOpen size={13} />
          Details
        </button>

        {marketplace ? (
          <button
            style={{ ...s.accentBtn, ...(operating ? s.btnBusy : {}) }}
            onClick={onInstall}
            disabled={!!operating}
          >
            {operating ? <span style={s.spinnerInline} /> : <Download size={13} />}
            {operating ? "Installing…" : "Install"}
          </button>
        ) : (
          <div style={s.installedCtrl}>
            <button style={s.iconCtrlBtn} onClick={onReload} disabled={!!operating} title="Reload plugin">
              <RefreshCw size={14} />
            </button>
            <button
              style={{ ...s.iconCtrlBtn, ...s.dangerCtrlBtn }}
              onClick={onUninstall}
              disabled={!!operating}
              title="Uninstall"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── CORE PLUGIN ROW ─────────────────────────────────────────── */
function CorePluginRow({ plugin, onDetail }) {
  const isOk = plugin.enabled && !plugin.lastError;
  return (
    <div style={s.coreRow}>
      <div style={s.coreRowLeft}>
        <div style={s.coreRowIcon}>
          <Shield size={16} color={colors.accent} />
        </div>
        <div>
          <div style={s.coreRowName}>{plugin.displayName || plugin.name}</div>
          <div style={s.coreRowDesc}>{plugin.description || ""}</div>
        </div>
      </div>
      <div style={s.coreRowRight}>
        <StatusDot status={isOk ? "ok" : plugin.lastError ? "error" : "disabled"} />
        <button style={s.docsBtn} onClick={onDetail}>
          <BookOpen size={13} />
          Details
        </button>
      </div>
    </div>
  );
}

/* ── PLUGIN DETAIL (SlideOver content) ──────────────────────── */
function PluginDetail({ plugin, brochureContent, brochureLoading, operating, onInstall, onUninstall, onReload }) {
  const isInstalled = plugin._local;
  const hasError = !!plugin.lastError;
  const isLoaded = plugin.enabled && !hasError;
  const html = brochureContent ? parseMarkdown(brochureContent) : "";

  return (
    <div>
      {/* Meta block */}
      <div style={s.detailMeta}>
        <div style={s.detailMetaRow}>
          <span style={s.detailMetaKey}>Version</span>
          <span style={s.detailMetaVal}>v{plugin.version || "1.0.0"}</span>
        </div>
        <div style={s.detailMetaRow}>
          <span style={s.detailMetaKey}>Author</span>
          <span style={s.detailMetaVal}>{plugin.author || "Unknown"}</span>
        </div>
        {plugin.category && (
          <div style={s.detailMetaRow}>
            <span style={s.detailMetaKey}>Category</span>
            <span style={s.detailMetaVal}>{CATEGORY_META[plugin.category]?.label || plugin.category}</span>
          </div>
        )}
        {isInstalled && (
          <div style={s.detailMetaRow}>
            <span style={s.detailMetaKey}>Status</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatusDot status={isLoaded ? "ok" : hasError ? "error" : "disabled"} />
              <span style={s.detailMetaVal}>
                {isLoaded ? "Loaded" : hasError ? "Error" : "Disabled"}
              </span>
            </span>
          </div>
        )}
        {hasError && (
          <div style={s.errorBox}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{plugin.lastError}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={s.detailActions}>
        {isInstalled ? (
          <>
            <button style={{ ...s.ghostBtn, flex: 1 }} onClick={onReload} disabled={!!operating}>
              <RefreshCw size={14} />
              Reload
            </button>
            <button style={{ ...s.dangerBtn, flex: 1 }} onClick={onUninstall} disabled={!!operating}>
              <Trash2 size={14} />
              Uninstall
            </button>
          </>
        ) : (
          <button
            style={{ ...s.accentBtn, flex: 1, ...(operating ? s.btnBusy : {}) }}
            onClick={onInstall}
            disabled={!!operating}
          >
            {operating ? <span style={s.spinnerInline} /> : <Download size={14} />}
            {operating ? "Installing…" : "Install Plugin"}
          </button>
        )}
      </div>

      <div style={s.detailDivider} />

      {/* Brochure */}
      {brochureLoading ? (
        <div style={s.brochureLoader}>
          <span style={s.spinner} />
          Loading docs…
        </div>
      ) : (
        <>
          <style>{brochureCSS}</style>
          <div
            className="brochure"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </>
      )}
    </div>
  );
}

/* ── SKELETON ────────────────────────────────────────────────── */
function SkeletonGrid() {
  return (
    <div style={s.grid}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{ ...s.card, pointerEvents: "none" }}>
          <div style={{ width: 44, height: 44, borderRadius: radius.card, background: colors.surface2, animation: "pulse 1.4s ease-in-out infinite" }} />
          <div style={{ height: 18, width: "60%", borderRadius: 6, background: colors.surface2, marginTop: 16, animation: "pulse 1.4s ease-in-out infinite" }} />
          <div style={{ height: 13, width: "90%", borderRadius: 6, background: colors.surface2, marginTop: 8, animation: "pulse 1.4s ease-in-out infinite" }} />
        </div>
      ))}
    </div>
  );
}

/* ── MARKDOWN PARSER ─────────────────────────────────────────── */
function parseMarkdown(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => {
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  };
  const lines = md.split("\n");
  let out = "", inCode = false, codeBuf = [], inList = false;
  const closeList = () => { if (inList) { out += "</ul>"; inList = false; } };
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) { out += `<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`; codeBuf = []; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    if (line.match(/^[-*] /)) { if (!inList) { out += "<ul>"; inList = true; } out += `<li>${inline(line.slice(2))}</li>`; continue; }
    closeList();
    if (line.startsWith("### ")) { out += `<h3>${inline(line.slice(4))}</h3>`; continue; }
    if (line.startsWith("## "))  { out += `<h2>${inline(line.slice(3))}</h2>`; continue; }
    if (line.startsWith("# "))   { out += `<h1>${inline(line.slice(2))}</h1>`; continue; }
    if (line.startsWith("> "))   { out += `<blockquote>${inline(line.slice(2))}</blockquote>`; continue; }
    if (line.trim() === "")      { out += "<br>"; continue; }
    out += `<p>${inline(line)}</p>`;
  }
  closeList();
  return out;
}

const brochureCSS = `
  .brochure { font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.65; color: var(--ink2); }
  .brochure h1 { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-weight: 400; margin: 0 0 8px; color: var(--ink); }
  .brochure h2 { font-family: 'Cormorant Garamond', serif; font-size: 19px; font-weight: 400; margin: 24px 0 8px; color: var(--ink); border-bottom: 1px solid var(--hairline); padding-bottom: 5px; }
  .brochure h3 { font-size: 12px; font-weight: 600; margin: 18px 0 6px; color: var(--ink); text-transform: uppercase; letter-spacing: 0.05em; }
  .brochure p { margin: 0 0 10px; }
  .brochure ul { padding-left: 20px; margin: 0 0 12px; }
  .brochure li { line-height: 1.7; }
  .brochure strong { font-weight: 600; color: var(--ink); }
  .brochure code { font-family: 'Fira Mono', monospace; font-size: 12px; background: var(--surface2); padding: 2px 6px; border-radius: 4px; color: var(--accent); }
  .brochure pre { background: var(--surface2); border-radius: 10px; padding: 14px; overflow-x: auto; margin: 12px 0; }
  .brochure pre code { background: none; padding: 0; color: var(--ink); }
  .brochure blockquote { border-left: 3px solid var(--accent); margin: 10px 0; padding: 8px 14px; background: var(--accentTint); border-radius: 0 8px 8px 0; }
  .brochure a { color: var(--accent); text-decoration: none; }
  .brochure a:hover { text-decoration: underline; }
  .brochure br { display: block; height: 4px; content: ''; }
`;

const animationCSS = `
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

/* ── STYLES ──────────────────────────────────────────────────── */
const s = {
  page: { maxWidth: 1200 },

  pageHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    marginBottom: 28, flexWrap: "wrap", gap: 12,
  },
  pageTitle: {
    fontFamily: fonts.display, fontSize: `${fontSize.display}px`, fontWeight: 600,
    color: colors.ink, margin: 0, lineHeight: 1.1,
  },
  pageSubtitle: {
    fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, margin: "4px 0 0",
  },
  headerActions: { display: "flex", gap: 8, flexShrink: 0 },

  /* tabs */
  tabBar: {
    display: "flex", gap: 0,
    borderBottom: `1.5px solid ${colors.hairline}`,
    marginBottom: 24,
  },
  tab: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "10px 18px",
    border: "none", background: "transparent",
    fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 400,
    color: colors.inkMuted, cursor: "pointer",
    borderBottom: "2px solid transparent", marginBottom: "-1.5px",
    transition: "color .15s, border-color .15s",
  },
  tabActive: {
    color: colors.ink, fontWeight: 600,
    borderBottomColor: colors.accent,
  },
  tabCount: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: colors.surface2, color: colors.inkMuted,
    fontFamily: fonts.body, fontSize: 11, fontWeight: 600,
    borderRadius: 100, padding: "1px 7px",
  },
  tabCountActive: {
    background: colors.accentTint, color: colors.accentOnTint,
  },

  /* filter bar */
  filterBar: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 },
  searchBox: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "10px 14px",
    background: colors.surface1, border: `1.5px solid ${colors.hairline}`,
    borderRadius: radius.control, maxWidth: 440,
  },
  searchInput: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: colors.ink, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
  },
  clearBtn: {
    background: "none", border: "none", cursor: "pointer",
    color: colors.inkMuted, display: "flex", alignItems: "center", padding: 0,
  },
  pills: { display: "flex", gap: 6, flexWrap: "wrap" },
  pill: {
    display: "inline-flex", alignItems: "center", padding: "5px 14px",
    borderRadius: radius.pill, border: `1.5px solid ${colors.hairline}`,
    background: "transparent", color: colors.inkMuted,
    fontFamily: fonts.body, fontSize: 13, fontWeight: 500, cursor: "pointer",
    transition: "background .15s, border-color .15s, color .15s",
  },
  pillActive: {
    background: colors.accent, borderColor: colors.accent, color: colors.creamOnAccent,
  },

  content: {},
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
    gap: 14,
  },

  /* card */
  card: {
    background: colors.surface1, border: `1.5px solid ${colors.hairline}`,
    borderRadius: radius.card, padding: "18px 18px 14px",
    display: "flex", flexDirection: "column", gap: 0,
  },
  cardTop: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12,
  },
  cardIcon: {
    width: 42, height: 42, borderRadius: radius.card,
    background: colors.accentTint, display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  cardBadges: { display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" },
  catPill: {
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
    borderRadius: radius.pill, background: colors.pineTint, color: colors.pineOnTint,
    fontFamily: fonts.body, fontSize: 11, fontWeight: 500,
  },
  cardBody: { flex: 1, marginBottom: 10 },
  cardName: {
    fontFamily: fonts.display, fontSize: `${fontSize.title}px`, fontWeight: 400,
    color: colors.ink, margin: "0 0 5px", lineHeight: 1.2,
  },
  cardDesc: {
    fontFamily: fonts.body, fontSize: 13, color: colors.ink2, lineHeight: 1.5, margin: 0,
    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  cardMeta: {
    display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
  },
  metaText: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  metaDot: { color: colors.inkFaint, fontSize: 12 },
  cardActions: {
    display: "flex", alignItems: "center", gap: 8,
    borderTop: `1px solid ${colors.hairline}`, paddingTop: 12,
  },
  docsBtn: {
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "6px 12px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.hairline}`, background: "transparent",
    color: colors.inkMuted, fontFamily: fonts.body, fontSize: 12, fontWeight: 500,
    cursor: "pointer", flexShrink: 0,
  },
  accentBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
    padding: "7px 16px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.accent}`, background: colors.accent,
    color: colors.creamOnAccent, fontFamily: fonts.body, fontSize: 13, fontWeight: 500,
    cursor: "pointer", marginLeft: "auto", flexShrink: 0,
    transition: "opacity .15s",
  },
  primaryBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "9px 18px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.accent}`, background: colors.accent,
    color: colors.creamOnAccent, fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, fontWeight: 500,
    cursor: "pointer",
  },
  ghostBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "9px 16px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.hairlineStrong}`, background: "transparent",
    color: colors.ink2, fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, fontWeight: 500,
    cursor: "pointer",
  },
  dangerBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
    padding: "7px 14px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.dangerTint}`, background: "transparent",
    color: colors.dangerText, fontFamily: fonts.body, fontSize: 13, fontWeight: 500,
    cursor: "pointer",
  },
  btnBusy: { opacity: 0.6, cursor: "not-allowed" },
  installedCtrl: { display: "flex", gap: 6, marginLeft: "auto" },
  iconCtrlBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 32, height: 32, borderRadius: radius.control,
    border: `1.5px solid ${colors.hairline}`, background: "transparent",
    color: colors.inkMuted, cursor: "pointer",
  },
  dangerCtrlBtn: { borderColor: colors.dangerTint, color: colors.dangerText },

  spinnerInline: {
    display: "inline-block", width: 13, height: 13,
    border: `2px solid rgba(255,255,255,0.3)`, borderTopColor: colors.creamOnAccent,
    borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0,
  },

  /* core tab */
  coreList: { display: "flex", flexDirection: "column", gap: 0 },
  coreNote: {
    fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted,
    marginBottom: 16,
  },
  coreRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 0", borderBottom: `1px solid ${colors.hairline}`, gap: 16,
  },
  coreRowLeft: { display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 },
  coreRowIcon: {
    width: 36, height: 36, borderRadius: radius.control,
    background: colors.accentTint, display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  coreRowName: {
    fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600,
    color: colors.ink, marginBottom: 2,
  },
  coreRowDesc: {
    fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  coreRowRight: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },

  /* detail slide-over content */
  detailMeta: {
    display: "flex", flexDirection: "column", gap: 0,
    background: colors.surface1, borderRadius: radius.control,
    border: `1px solid ${colors.hairline}`,
    marginBottom: 16, overflow: "hidden",
  },
  detailMetaRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 14px", borderBottom: `1px solid ${colors.hairline}`,
  },
  detailMetaKey: {
    fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.inkMuted, fontWeight: 500,
  },
  detailMetaVal: {
    fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.ink, fontWeight: 500,
  },
  errorBox: {
    display: "flex", alignItems: "flex-start", gap: 8,
    padding: "10px 14px",
    color: colors.dangerText, fontFamily: fonts.body, fontSize: 12,
    background: colors.dangerTint,
  },
  detailActions: {
    display: "flex", gap: 8, marginBottom: 16,
  },
  detailDivider: {
    borderTop: `1px solid ${colors.hairline}`, marginBottom: 20,
  },
  brochureLoader: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 40,
    color: colors.inkMuted, fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
  },
  spinner: {
    display: "inline-block", width: 24, height: 24,
    border: `2.5px solid ${colors.hairlineStrong}`, borderTopColor: colors.accent,
    borderRadius: "50%", animation: "spin 1s linear infinite",
  },

  /* install modal */
  overlay: {
    position: "fixed", inset: 0, background: "rgba(30,26,20,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 20, backdropFilter: "blur(2px)",
  },
  modal: {
    background: colors.cream, border: `1.5px solid ${colors.hairline}`,
    borderRadius: radius.card, padding: 24, width: "100%", maxWidth: 440,
  },
  modalHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6,
  },
  modalTitle: {
    fontFamily: fonts.display, fontSize: `${fontSize.heading}px`, fontWeight: 400,
    color: colors.ink, margin: 0,
  },
  modalClose: {
    background: "none", border: "none", cursor: "pointer",
    color: colors.inkMuted, padding: 4, display: "flex", alignItems: "center",
    borderRadius: radius.control,
  },
  modalHint: {
    fontFamily: fonts.body, fontSize: `${fontSize.caption}px`, color: colors.inkMuted, marginBottom: 14,
  },
  inlineCode: {
    fontFamily: "monospace", fontSize: 12, background: colors.surface2,
    padding: "1px 5px", borderRadius: 4, color: colors.accent,
  },
  modalActions: {
    display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18,
  },
};
