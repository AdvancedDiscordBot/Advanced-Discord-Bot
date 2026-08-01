import React, { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { useApiFetch } from "../hooks/useApi";
import { EmptyState } from "../components/UI";
import { colors, fonts, fontSize, radius } from "../theme";
import { ShieldCheck, Save, Trash2, ChevronRight } from "lucide-react";

// Access page: map Discord roles to dashboard permissions (GuildRoleGrant).
export function Roles() {
  const { guildData } = useOutletContext();
  const guild = guildData?.guild;
  const { request } = useApiFetch();

  const [catalog, setCatalog] = useState([]);
  const [roles, setRoles] = useState([]);
  const [grants, setGrants] = useState({}); // roleId -> Set(keys)
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState(null);
  const [draft, setDraft] = useState(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!guild?.id) return;
    setLoading(true);
    try {
      const [catRes, grantRes] = await Promise.all([
        request(`/api/guild/${guild.id}/permissions/catalog`).catch(() => ({ catalog: [] })),
        request(`/api/guild/${guild.id}/roles/grants`).catch(() => ({ roles: [], grants: [] })),
      ]);
      setCatalog(catRes?.catalog || []);
      setRoles(grantRes?.roles || []);
      const map = {};
      for (const g of grantRes?.grants || []) map[g.roleId] = new Set(g.permissions);
      setGrants(map);
    } finally {
      setLoading(false);
    }
  }, [request, guild?.id]);

  useEffect(() => { load(); }, [load]);

  function selectRole(role) {
    setSelectedRole(role);
    setDraft(new Set(grants[role.id] || []));
  }

  function toggleKey(key) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!selectedRole) return;
    setSaving(true);
    const perms = Array.from(draft);
    try {
      if (perms.length === 0) {
        await request(`/api/guild/${guild.id}/roles/grants/${selectedRole.id}`, { method: "DELETE" });
        setGrants((prev) => { const n = { ...prev }; delete n[selectedRole.id]; return n; });
      } else {
        const res = await request(`/api/guild/${guild.id}/roles/grants/${selectedRole.id}`, {
          method: "PUT",
          body: JSON.stringify({ permissions: perms }),
        });
        setGrants((prev) => ({ ...prev, [selectedRole.id]: new Set(res.permissions || perms) }));
      }
      setSelectedRole(null);
    } catch (err) {
      console.error("Save grant failed:", err);
    } finally {
      setSaving(false);
    }
  }

  if (!guild) return null;

  // Group catalog: core (plugin null) first, then one group per plugin.
  const groups = [];
  const byPlugin = new Map();
  for (const perm of catalog) {
    const k = perm.plugin || "__core__";
    if (!byPlugin.has(k)) { byPlugin.set(k, []); groups.push(k); }
    byPlugin.get(k).push(perm);
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Access</h1>
        <p style={s.subtitle}>Map Discord roles to dashboard permissions for {guild.name}.</p>
      </div>

      {loading ? (
        <p style={s.muted}>Loading…</p>
      ) : roles.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={40} />} title="No roles" body="This server has no assignable roles." />
      ) : (
        <div style={s.roleList}>
          {roles.map((role) => {
            const count = grants[role.id]?.size || 0;
            return (
              <button key={role.id} style={s.roleRow} onClick={() => selectRole(role)}>
                <span style={{ ...s.roleDot, background: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : colors.inkFaint }} />
                <span style={s.roleName}>{role.name}</span>
                <span style={s.roleMeta}>{count > 0 ? `${count} permission${count === 1 ? "" : "s"}` : "No access"}</span>
                <ChevronRight size={16} color={colors.inkMuted} />
              </button>
            );
          })}
        </div>
      )}

      {/* Editor drawer */}
      {selectedRole && (
        <div style={s.overlay} onClick={() => setSelectedRole(null)}>
          <div style={s.drawer} onClick={(e) => e.stopPropagation()}>
            <div style={s.drawerHead}>
              <div>
                <div style={s.drawerTitle}>{selectedRole.name}</div>
                <div style={s.drawerSub}>{draft.size} selected</div>
              </div>
            </div>
            <div style={s.drawerBody}>
              {groups.map((k) => (
                <div key={k} style={s.group}>
                  <div style={s.groupTitle}>
                    {k === "__core__" ? "Core" : (byPlugin.get(k)[0]?.label?.split(":")[0] || k)}
                  </div>
                  {byPlugin.get(k).map((perm) => (
                    <label key={perm.key} style={s.permRow}>
                      <input
                        type="checkbox"
                        checked={draft.has(perm.key)}
                        onChange={() => toggleKey(perm.key)}
                        style={s.checkbox}
                      />
                      <span style={s.permText}>
                        <span style={s.permLabel}>{perm.label}</span>
                        {perm.description && <span style={s.permDesc}>{perm.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div style={s.drawerFoot}>
              <button style={s.ghostBtn} onClick={() => setSelectedRole(null)} disabled={saving}>Cancel</button>
              <button style={s.saveBtn} onClick={save} disabled={saving}>
                {draft.size === 0 ? <Trash2 size={14} /> : <Save size={14} />}
                {saving ? "Saving…" : draft.size === 0 ? "Clear access" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  page: { maxWidth: 900 },
  header: { marginBottom: 24 },
  title: { fontFamily: fonts.display, fontSize: `${fontSize.display}px`, fontWeight: 600, color: colors.ink, margin: 0, lineHeight: 1.1 },
  subtitle: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted, margin: "4px 0 0" },
  muted: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.inkMuted },

  roleList: { display: "flex", flexDirection: "column", gap: 8 },
  roleRow: {
    display: "flex", alignItems: "center", gap: 12, width: "100%",
    padding: "12px 16px", background: colors.surface1,
    border: `1.5px solid ${colors.hairline}`, borderRadius: radius.control,
    cursor: "pointer", textAlign: "left",
  },
  roleDot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
  roleName: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600, color: colors.ink, flex: 1 },
  roleMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },

  overlay: {
    position: "fixed", inset: 0, background: "rgba(30,26,20,0.5)",
    display: "flex", justifyContent: "flex-end", zIndex: 1000, backdropFilter: "blur(2px)",
  },
  drawer: {
    width: 460, maxWidth: "100vw", background: colors.cream,
    borderLeft: `1.5px solid ${colors.hairline}`, display: "flex", flexDirection: "column", height: "100%",
  },
  drawerHead: { padding: "18px 20px", borderBottom: `1.5px solid ${colors.hairline}` },
  drawerTitle: { fontFamily: fonts.display, fontSize: `${fontSize.heading}px`, fontWeight: 400, color: colors.ink },
  drawerSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginTop: 2 },
  drawerBody: { flex: 1, overflowY: "auto", padding: "8px 20px" },
  group: { marginBottom: 16 },
  groupTitle: {
    fontFamily: fonts.body, fontSize: 10, fontWeight: 600, letterSpacing: "0.12em",
    color: colors.inkFaint, textTransform: "uppercase", margin: "12px 0 6px",
  },
  permRow: { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" },
  checkbox: { marginTop: 2, width: 16, height: 16, accentColor: colors.accent, cursor: "pointer" },
  permText: { display: "flex", flexDirection: "column", gap: 2 },
  permLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: 500, color: colors.ink },
  permDesc: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, lineHeight: 1.4 },

  drawerFoot: {
    display: "flex", justifyContent: "flex-end", gap: 8,
    padding: "14px 20px", borderTop: `1.5px solid ${colors.hairline}`,
  },
  ghostBtn: {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.hairlineStrong}`, background: "transparent", color: colors.ink2,
    fontFamily: fonts.body, fontSize: 13, fontWeight: 500, cursor: "pointer",
  },
  saveBtn: {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: radius.pill,
    border: `1.5px solid ${colors.accent}`, background: colors.accent, color: colors.creamOnAccent,
    fontFamily: fonts.body, fontSize: 13, fontWeight: 500, cursor: "pointer",
  },
};
