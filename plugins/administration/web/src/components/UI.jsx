import React from 'react';

export function StatCard({ icon: Icon, label, value, subValue, color = '#6366F1' }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.iconWrap, backgroundColor: `${color}20` }}>
        <Icon size={24} color={color} />
      </div>
      <div style={styles.content}>
        <div style={styles.label}>{label}</div>
        <div style={styles.value}>{value}</div>
        {subValue && <div style={styles.subValue}>{subValue}</div>}
      </div>
    </div>
  );
}

export function Card({ title, children, actions }) {
  return (
    <div style={styles.cardBlock}>
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

export function Select({ value, onChange, options, label, placeholder }) {
  return (
    <div style={styles.selectWrap}>
      {label && <label style={styles.selectLabel}>{label}</label>}
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={styles.select}
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

export function Button({ children, onClick, variant = 'primary', loading, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        ...styles.button,
        ...(variant === 'secondary' ? styles.buttonSecondary : styles.buttonPrimary),
        ...(disabled ? styles.buttonDisabled : {}),
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
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    border: '1px solid #334155',
  },
  iconWrap: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  label: {
    color: '#94a3b8',
    fontSize: '13px',
    marginBottom: '4px',
  },
  value: {
    color: '#f1f5f9',
    fontSize: '24px',
    fontWeight: 700,
  },
  subValue: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '2px',
  },
  cardBlock: {
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    border: '1px solid #334155',
    marginBottom: '16px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: '1px solid #334155',
  },
  cardTitle: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
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
    borderBottom: '1px solid #334155',
  },
  toggleInfo: {
    flex: 1,
  },
  toggleLabel: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontWeight: 500,
  },
  toggleDesc: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '2px',
  },
  toggle: {
    width: '44px',
    height: '24px',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.2s',
  },
  toggleOff: {
    background: '#475569',
  },
  toggleOn: {
    background: '#10B981',
  },
  toggleKnob: {
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#ffffff',
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
    color: '#94a3b8',
    fontSize: '13px',
    marginBottom: '6px',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '14px',
    outline: 'none',
  },
  inputWrap: {
    marginBottom: '12px',
  },
  inputLabel: {
    display: 'block',
    color: '#94a3b8',
    fontSize: '13px',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '14px',
    outline: 'none',
  },
  button: {
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '14px',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  buttonPrimary: {
    background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
    color: '#ffffff',
  },
  buttonSecondary: {
    background: '#334155',
    color: '#e2e8f0',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};
