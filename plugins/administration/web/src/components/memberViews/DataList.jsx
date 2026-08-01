import React from 'react';
import { colors, fonts, radius, fontSize } from '../../theme';
import { Button } from '../UI';

// Renders a rendered member page of view.type === "list".
// Each row is one of the caller's own documents. `title`/`subtitle`/`badge`
// name the fields to surface; declared actions (set|delete) run against the
// row's own id via onAction(actionId, rowId).
export default function DataList({ view, rows, onAction, busyRow }) {
	const titleField = view.title || 'title';
	return (
		<div style={s.list}>
			{rows.map((row) => (
				<div key={row.id} style={s.row}>
					<div style={s.rowMain}>
						<div style={s.rowTitle}>{fmt(row[titleField])}</div>
						{view.subtitle && row[view.subtitle] != null && (
							<div style={s.rowSub}>{fmt(row[view.subtitle])}</div>
						)}
					</div>
					{view.badge && row[view.badge] != null && (
						<span style={s.badge}>{fmt(row[view.badge])}</span>
					)}
					{Array.isArray(view.actions) && view.actions.length > 0 && (
						<div style={s.actions}>
							{view.actions.map((a) => (
								<Button
									key={a.id}
									variant={a.op === 'delete' ? 'danger' : 'secondary'}
									loading={busyRow === `${row.id}:${a.id}`}
									onClick={() => onAction(a.id, row.id)}
									style={s.actionBtn}
								>
									{a.label}
								</Button>
							))}
						</div>
					)}
				</div>
			))}
		</div>
	);
}

function fmt(v) {
	if (v == null) return '';
	if (typeof v === 'boolean') return v ? 'Yes' : 'No';
	return String(v);
}

const s = {
	list: { display: 'flex', flexDirection: 'column', gap: '10px' },
	row: {
		display: 'flex', alignItems: 'center', gap: '14px',
		padding: '14px 16px', background: colors.surface1,
		border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`,
	},
	rowMain: { flex: 1, minWidth: 0 },
	rowTitle: {
		fontFamily: fonts.body, fontSize: `${fontSize.body}px`,
		fontWeight: 500, color: colors.ink,
	},
	rowSub: {
		fontFamily: fonts.body, fontSize: `${fontSize.caption}px`,
		color: colors.inkMuted, marginTop: '2px',
	},
	badge: {
		fontFamily: fonts.body, fontSize: '11px', fontWeight: 600,
		letterSpacing: '0.04em', textTransform: 'uppercase',
		padding: '2px 8px', borderRadius: `${radius.pill}px`,
		background: colors.surface2, color: colors.inkMuted, whiteSpace: 'nowrap',
	},
	actions: { display: 'flex', gap: '8px', flexShrink: 0 },
	actionBtn: { padding: '8px 14px' },
};
