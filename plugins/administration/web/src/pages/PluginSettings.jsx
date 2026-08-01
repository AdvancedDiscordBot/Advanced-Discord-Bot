import React, { useState, useEffect } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { ExternalLink, Save } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

export function PluginSettings() {
  const { guildId, pluginName } = useParams();
  const { guildData } = useOutletContext();
  const { guild } = guildData || {};

  const [schema, setSchema] = useState([]);
  const [commandPermissions, setCommandPermissions] = useState(false);
  const [webUi, setWebUi] = useState(null);
  const [config, setConfig] = useState({});
  const [commands, setCommands] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [settRes, cmdRes] = await Promise.all([
          fetch(`/api/guild/${guildId}/plugins/${pluginName}/settings`),
          fetch(`/api/guild/${guildId}/plugins/${pluginName}/commands`),
        ]);
        if (settRes.ok) {
          const d = await settRes.json();
          setSchema(d.settingsSchema || []);
          setCommandPermissions(d.commandPermissions || false);
          setWebUi(d.webUi || null);
          setConfig(d.config || {});
        }
        if (cmdRes.ok) {
          const d = await cmdRes.json();
          setCommands(d.commands || []);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [guildId, pluginName]);

  async function saveSettings() {
    setSaving(true);
    try {
      // Strip _commands from settings payload — managed separately
      const { _commands, ...settingsOnly } = config;
      await fetch(`/api/guild/${guildId}/plugins/${pluginName}/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settingsOnly),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function saveCommand(cmdName, enabled, allowedRoles) {
    await fetch(`/api/guild/${guildId}/plugins/${pluginName}/commands/${cmdName}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, allowedRoles }),
    });
    setCommands((prev) =>
      prev.map((c) => c.name === cmdName ? { ...c, enabled, allowedRoles } : c)
    );
  }

  if (loading) return <div style={s.loading}>Loading…</div>;

  const roles = guild?.roles || [];

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>{pluginName}</h1>
        {webUi && (
          <a href={`/plugin-ui/${pluginName}/`} target="_blank" rel="noreferrer" style={s.openUiBtn}>
            <ExternalLink size={14} />
            {webUi.label || 'Open Plugin UI'}
          </a>
        )}
      </div>

      {schema.length > 0 && (
        <section style={s.card}>
          <h3 style={s.cardTitle}>Settings</h3>
          <div style={s.fieldList}>
            {schema.map((field) => (
              <SettingsField
                key={field.key}
                field={field}
                value={config[field.key] ?? field.default ?? ''}
                roles={roles}
                channels={guild?.channels || []}
                onChange={(val) => setConfig((c) => ({ ...c, [field.key]: val }))}
              />
            ))}
          </div>
          <button style={s.saveBtn} onClick={saveSettings} disabled={saving}>
            <Save size={14} />
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Settings'}
          </button>
        </section>
      )}

      {commandPermissions && commands.length > 0 && (
        <section style={s.card}>
          <h3 style={s.cardTitle}>Command Permissions</h3>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Command</th>
                <th style={s.th}>Enabled</th>
                <th style={s.th}>Allowed Roles (empty = everyone)</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((cmd) => (
                <CommandRow
                  key={cmd.name}
                  cmd={cmd}
                  roles={roles}
                  onSave={saveCommand}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {schema.length === 0 && !commandPermissions && !webUi && (
        <div style={s.empty}>This plugin has no configurable settings.</div>
      )}
    </div>
  );
}

function SettingsField({ field, value, roles, channels, onChange }) {
  const id = `field-${field.key}`;
  const label = <label htmlFor={id} style={s.label}>{field.label || field.key}</label>;

  if (field.type === 'boolean') {
    return (
      <div style={s.fieldRow}>
        {label}
        <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }
  if (field.type === 'number') {
    return (
      <div style={s.fieldRow}>
        {label}
        <input id={id} type="number" style={s.input} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    );
  }
  if (field.type === 'channel') {
    return (
      <div style={s.fieldRow}>
        {label}
        <select id={id} style={s.input} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— none —</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === 'role') {
    return (
      <div style={s.fieldRow}>
        {label}
        <select id={id} style={s.input} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— none —</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <div style={s.fieldRow}>
        {label}
        <select id={id} style={s.input} value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options || []).map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div style={s.fieldRow}>
      {label}
      <input id={id} type="text" style={s.input} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CommandRow({ cmd, roles, onSave }) {
  const [enabled, setEnabled] = useState(cmd.enabled);
  const [allowedRoles, setAllowedRoles] = useState(cmd.allowedRoles || []);
  const [dirty, setDirty] = useState(false);

  function toggleRole(id) {
    setAllowedRoles((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
    setDirty(true);
  }

  return (
    <tr>
      <td style={s.td}><code>/{cmd.name}</code></td>
      <td style={s.td}>
        <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }} />
      </td>
      <td style={s.td}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          {roles.map((r) => (
            <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' }}>
              <input type="checkbox" checked={allowedRoles.includes(r.id)} onChange={() => toggleRole(r.id)} />
              {r.name}
            </label>
          ))}
          {dirty && (
            <button style={s.smallBtn} onClick={() => { onSave(cmd.name, enabled, allowedRoles); setDirty(false); }}>
              Save
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

const s = {
  page: { maxWidth: '720px' },
  pageHeader: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' },
  pageTitle: { fontFamily: fonts.body, fontSize: `${fontSize.heading}px`, fontWeight: 700, color: colors.ink, margin: 0 },
  openUiBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: `${radius.control}px`, background: colors.accentTint, color: colors.accentOnTint, textDecoration: 'none', fontSize: `${fontSize.meta}px`, fontWeight: 500 },
  card: { background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`, padding: '20px', marginBottom: '16px' },
  cardTitle: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600, color: colors.ink, marginTop: 0, marginBottom: '16px' },
  fieldList: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' },
  fieldRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  label: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink2, minWidth: '160px' },
  input: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, padding: '6px 10px', borderRadius: `${radius.control}px`, border: `1.5px solid ${colors.hairlineStrong}`, background: colors.surface2, color: colors.ink, flex: 1 },
  saveBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: `${radius.control}px`, background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 500 },
  smallBtn: { padding: '3px 10px', borderRadius: `${radius.control}px`, background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontFamily: fonts.body, fontSize: '11px', fontWeight: 600, color: colors.inkFaint, textAlign: 'left', padding: '6px 8px', borderBottom: `1.5px solid ${colors.hairline}` },
  td: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink, padding: '8px', borderBottom: `1px solid ${colors.hairline}`, verticalAlign: 'middle' },
  loading: { padding: '40px', color: colors.inkMuted, fontFamily: fonts.body },
  empty: { padding: '40px', color: colors.inkMuted, fontFamily: fonts.body, textAlign: 'center' },
};
