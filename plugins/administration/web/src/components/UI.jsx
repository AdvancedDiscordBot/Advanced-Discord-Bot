import React from 'react';
import { colors, fonts, radius, fontSize } from '../theme';

export function StatCard({ icon: Icon, label, value, subValue }) {
  return (
    <div style={styles.card}>
      <div style={styles.iconWrap}>
        <Icon size={22} color={colors.accent} />
      </div>
      <div style={styles.content}>
        <div style={styles.label}>{label}</div>
        <div style={styles.value}>{value}</div>
        {subValue && <div style={styles.subValue}>{subValue}</div>}
      </div>
    </div>
  );
}

export function Card({ title, children, actions, style }) {
  return (
    <div style={{ ...styles.cardBlock, ...style }}>
      {(title || actions) && (
        <div style={styles.cardHeader}>
          {title && <h3 style={styles.cardTitle}>{title}</h3>}
          {actions && <div style={styles.cardActions}>{actions}</div>}
        </div>
      )}
      <div style={styles.cardContent}>{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <div style={styles.toggleRow}>
      <div style={styles.toggleInfo}>
        <div style={styles.toggleLabel}>{label}</div>
        {description && <div style={styles.toggleDesc}>{description}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          ...styles.toggle,
          ...(checked ? styles.toggleOn : styles.toggleOff),
        }}
      >
        <span
          style={{
            ...styles.toggleKnob,
            ...(checked ? styles.toggleKnobOn : {}),
          }}
        />
      </button>
    </div>
  );
}

export function Select({ value, onChange, options, label, placeholder, style }) {
  return (
    <div style={styles.selectWrap}>
      {label && <label style={styles.selectLabel}>{label}</label>}
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...styles.select, ...style }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Input({ value, onChange, label, type = 'text', placeholder, ...props }) {
  return (
    <div style={styles.inputWrap}>
      {label && <label style={styles.inputLabel}>{label}</label>}
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        placeholder={placeholder}
        style={styles.input}
        {...props}
      />
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', loading, disabled, style }) {
  const variantStyle =
    variant === 'secondary'
      ? styles.buttonSecondary
      : variant === 'danger'
      ? styles.buttonDanger
      : styles.buttonPrimary;
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...styles.button,
        ...variantStyle,
        ...(disabled ? styles.buttonDisabled : {}),
        ...style,
      }}
    >
      {loading ? 'Saving...' : children}
    </button>
  );
}

const styles = {
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    background: colors.surface1,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`,
  },
  iconWrap: {
    width: '48px',
    height: '48px',
    borderRadius: `${radius.card}px`,
    background: colors.accentTint,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 500,
    marginBottom: '4px',
  },
  value: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.heading}px`,
    fontWeight: 700,
  },
  subValue: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    marginTop: '2px',
  },
  cardBlock: {
    background: colors.surface1,
    borderRadius: `${radius.card}px`,
    border: `1.5px solid ${colors.hairline}`,
    marginBottom: '16px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: `1.5px solid ${colors.hairline}`,
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 400,
    margin: 0,
  },
  cardActions: {
    display: 'flex',
    gap: '8px',
  },
  cardContent: {
    padding: '16px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: `1.5px solid ${colors.hairline}`,
  },
  toggleInfo: {
    flex: 1,
  },
  toggleLabel: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 500,
  },
  toggleDesc: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    marginTop: '2px',
  },
  toggle: {
    width: '44px',
    height: '24px',
    borderRadius: `${radius.pill}px`,
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.2s',
  },
  toggleOff: {
    background: colors.hairlineStrong,
  },
  toggleOn: {
    background: colors.accent,
  },
  toggleKnob: {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: colors.cream,
    transition: 'transform 0.2s',
  },
  toggleKnobOn: {
    transform: 'translateX(20px)',
  },
  selectWrap: {
    marginBottom: '12px',
  },
  selectLabel: {
    display: 'block',
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 500,
    marginBottom: '6px',
  },
  select: {
    width: '100%',
    padding: '11px 14px',
    background: colors.cream,
    border: `1.5px solid ${colors.hairlineStrong}`,
    borderRadius: `${radius.control}px`,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 400,
    outline: 'none',
  },
  inputWrap: {
    marginBottom: '12px',
  },
  inputLabel: {
    display: 'block',
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    fontWeight: 500,
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '11px 14px',
    background: colors.cream,
    border: `1.5px solid ${colors.hairlineStrong}`,
    borderRadius: `${radius.control}px`,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 400,
    outline: 'none',
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    borderRadius: `${radius.pill}px`,
    fontFamily: fonts.body,
    fontWeight: 500,
    fontSize: `${fontSize.caption}px`,
    cursor: 'pointer',
    transition: 'opacity .18s, background .18s, color .18s',
  },
  buttonPrimary: {
    background: colors.accent,
    color: colors.creamOnAccent,
    border: `1.5px solid ${colors.accent}`,
  },
  buttonSecondary: {
    background: 'transparent',
    color: colors.ink,
    border: `1.5px solid ${colors.ink}`,
  },
  buttonDanger: {
    background: colors.danger,
    color: colors.creamOnAccent,
    border: `1.5px solid ${colors.danger}`,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};

export function Badge({ label, variant = 'default' }) {
  const variantMap = {
    default: { bg: colors.surface2,    text: colors.inkMuted   },
    success: { bg: colors.successTint, text: colors.successText },
    warning: { bg: colors.warningTint, text: colors.warningText },
    danger:  { bg: colors.dangerTint,  text: colors.dangerText  },
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
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(30,26,20,0.45)',
          zIndex: 200, backdropFilter: 'blur(2px)',
        }}
      />
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
