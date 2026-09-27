import React, { useState, useEffect } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { ExternalLink, Save } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';
import { useApiFetch } from '../hooks/useApi';

function withoutSecrets(schema, config = {}) {
  const keys = new Set(schema.filter((field) => field.secret).map((field) => field.key));
  return Object.fromEntries(Object.entries(config).filter(([key]) => !keys.has(key)));
}

export function PluginSettings() {
  const { guildId, pluginName } = useParams();
  const { guildData } = useOutletContext();
  const { request } = useApiFetch();
  const apiPath = `/api/guild/${guildId}/plugins/${encodeURIComponent(pluginName)}`;
  const canConfigure = (guildData?.access?.permissions || []).includes(`plugin.${pluginName}.configure`);

  const [schema, setSchema] = useState([]);
  const [commandPermissions, setCommandPermissions] = useState(false);
  const [webUi, setWebUi] = useState(null);
  const [config, setConfig] = useState({});
  const [configuredSecrets, setConfiguredSecrets] = useState({});
  const [commands, setCommands] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      setSaved(false);
      setSchema([]);
      setCommands([]);
      setCommandPermissions(false);
      setWebUi(null);
      setConfiguredSecrets({});
      try {
        const [settings, commandData] = await Promise.all([
          request(`${apiPath}/settings`),
          request(`${apiPath}/commands`),
        ]);
        if (!active) return;
        const fields = settings.settingsSchema || [];
        setSchema(fields);
        setCommandPermissions(settings.commandPermissions || false);
        setWebUi(settings.webUi || null);
        setConfig(withoutSecrets(fields, settings.config || {}));
        setConfiguredSecrets(settings.configuredSecrets || {});
        setCommands(commandData.commands || []);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [apiPath, request]);

  async function saveSettings() {
    if (!canConfigure || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Saved data also contains private plugin state and command restrictions.
      // Only fields exposed by the dashboard schema belong in this patch.
      const settingsOnly = Object.fromEntries(schema
        .filter((field) => Object.prototype.hasOwnProperty.call(config, field.key))
        .map((field) => [field.key, config[field.key]]));
      const result = await request(`${apiPath}/settings`, {
        method: 'PUT',
        body: JSON.stringify(settingsOnly),
      });
      setConfig(withoutSecrets(schema, result.config));
      setConfiguredSecrets(result.configuredSecrets || {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveCommand(cmdName, enabled, allowedRoles) {
    if (!canConfigure) return false;
    setError(null);
    try {
      const result = await request(`${apiPath}/commands/${encodeURIComponent(cmdName)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled, allowedRoles }),
      });
      setCommands((prev) => prev.map((c) => c.name === cmdName ? { ...c, ...result.command } : c));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  if (loading) return <div style={s.loading}>Loading…</div>;

  const roles = guildData?.roles || [];

  return (
    <div className="adb-plugin-settings" style={s.page}>
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>{pluginName}</h1>
        {webUi?.port && (
          <a href={`/plugin-ui/${encodeURIComponent(pluginName)}/?guildId=${encodeURIComponent(guildId)}`} target="_blank" rel="noreferrer" style={s.openUiBtn}>
            <ExternalLink size={14} />
            {webUi.label || 'Open Plugin UI'}
          </a>
        )}
      </div>
      {error && <p role="alert" style={{ color: colors.dangerText }}>{error}</p>}

      {schema.length > 0 && (
        <section style={s.card}>
          <h3 style={s.cardTitle}>Settings</h3>
          <div className="adb-settings-fields" style={s.fieldList}>
            {schema.map((field) => (
              <SettingsField
                key={field.key}
                field={field}
                value={field.secret ? config[field.key] ?? '' : config[field.key] ?? field.default ?? ''}
                configured={configuredSecrets[field.key] === true}
                clearing={field.secret && config[field.key] === ''}
                roles={roles}
                channels={guildData?.channels || []}
                disabled={!canConfigure || saving}
                onChange={(val) => setConfig((c) => {
                  const next = { ...c, [field.key]: val };
                  if (field.secret && val === '') delete next[field.key];
                  return next;
                })}
                onClear={() => setConfig((c) => {
                  const next = { ...c, [field.key]: '' };
                  if (c[field.key] === '') delete next[field.key];
                  return next;
                })}
              />
            ))}
          </div>
          <button style={s.saveBtn} onClick={saveSettings} disabled={saving || !canConfigure}>
            <Save size={14} />
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Settings'}
          </button>
        </section>
      )}

      {commandPermissions && commands.length > 0 && (
        <section style={{ ...s.card, overflowX: 'auto' }}>
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
                  key={`${apiPath}:${cmd.name}`}
                  cmd={cmd}
                  roles={roles}
                  onSave={saveCommand}
                  disabled={!canConfigure}
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

function SettingsField({ field, value, roles, channels, onChange, onClear, disabled, configured, clearing }) {
  const id = `field-${field.key}`;
  const label = <label htmlFor={id} style={s.label}>{field.label || field.key}</label>;

  if (field.secret) {
    return (
      <div style={s.fieldRow}>
        {label}
        <input id={id} type="password" autoComplete="new-password" disabled={disabled} style={s.input} value={value}
          placeholder={clearing ? 'Will be cleared on save' : configured ? 'Configured; leave blank to keep' : 'Not configured'}
          onChange={(e) => onChange(e.target.value)} />
        {configured && <button type="button" style={s.smallBtn} disabled={disabled} onClick={onClear}>{clearing ? 'Keep saved' : 'Clear'}</button>}
      </div>
    );
  }

  if (field.type === 'boolean') {
    return (
      <div style={s.fieldRow}>
        {label}
        <input id={id} type="checkbox" disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }
  if (field.type === 'number') {
    return (
      <div style={s.fieldRow}>
        {label}
        <input id={id} type="number" disabled={disabled} min={field.min} max={field.max} style={s.input} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    );
  }
  if (field.type === 'channel') {
    return (
      <div style={s.fieldRow}>
        {label}
        <select id={id} disabled={disabled} style={s.input} value={value} onChange={(e) => onChange(e.target.value)}>
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
        <select id={id} disabled={disabled} style={s.input} value={value} onChange={(e) => onChange(e.target.value)}>
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
        <select id={id} disabled={disabled} style={s.input} value={value} onChange={(e) => onChange(e.target.value)}>
          {(field.options || []).map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div style={s.fieldRow}>
      {label}
      <input id={id} type="text" disabled={disabled} style={s.input} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CommandRow({ cmd, roles, onSave, disabled }) {
  const [enabled, setEnabled] = useState(cmd.enabled);
  const [allowedRoles, setAllowedRoles] = useState(cmd.allowedRoles || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  function toggleRole(id) {
    setAllowedRoles((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]);
    setDirty(true);
  }

  return (
    <tr>
      <td style={s.td}><code>/{cmd.name}</code></td>
      <td style={s.td}>
        <input type="checkbox" disabled={disabled || saving} checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }} />
      </td>
      <td style={s.td}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          {roles.map((r) => (
            <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' }}>
              <input type="checkbox" disabled={disabled || saving} checked={allowedRoles.includes(r.id)} onChange={() => toggleRole(r.id)} />
              {r.name}
            </label>
          ))}
          {dirty && (
            <button style={s.smallBtn} disabled={disabled || saving} onClick={async () => {
              setSaving(true);
              try {
                if (await onSave(cmd.name, enabled, allowedRoles)) setDirty(false);
              } finally {
                setSaving(false);
              }
            }}>
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
  pageTitle: { fontFamily: fonts.body, fontSize: `${fontSize.heading}px`, fontWeight: 700, color: colors.ink, margin: 0, overflowWrap: 'anywhere' },
  openUiBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: `${radius.control}px`, background: colors.accentTint, color: colors.accentOnTint, textDecoration: 'none', fontSize: `${fontSize.meta}px`, fontWeight: 500 },
  card: { background: colors.surface1, border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`, padding: '20px', marginBottom: '16px' },
  cardTitle: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 600, color: colors.ink, marginTop: 0, marginBottom: '16px' },
  fieldList: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' },
  fieldRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  label: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink2, width: '160px', flexShrink: 0 },
  input: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, padding: '6px 10px', borderRadius: `${radius.control}px`, border: `1.5px solid ${colors.hairlineStrong}`, background: colors.surface2, color: colors.ink, flex: 1, minWidth: 0 },
  saveBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: `${radius.control}px`, background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, fontWeight: 500 },
  smallBtn: { padding: '3px 10px', borderRadius: `${radius.control}px`, background: colors.accent, color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontFamily: fonts.body, fontSize: '11px', fontWeight: 600, color: colors.inkFaint, textAlign: 'left', padding: '6px 8px', borderBottom: `1.5px solid ${colors.hairline}` },
  td: { fontFamily: fonts.body, fontSize: `${fontSize.meta}px`, color: colors.ink, padding: '8px', borderBottom: `1px solid ${colors.hairline}`, verticalAlign: 'middle' },
  loading: { padding: '40px', color: colors.inkMuted, fontFamily: fonts.body },
  empty: { padding: '40px', color: colors.inkMuted, fontFamily: fonts.body, textAlign: 'center' },
};
