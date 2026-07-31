import React from 'react';
import { colors, fonts, radius, fontSize } from '../../theme';

// Renders a rendered member page of view.type === "stat".
// `view.stats` names the fields to surface as cards. A stat page is the
// caller's own aggregate (rank, XP, invite count, …), so we read the first
// row returned for this member; if none, each card shows a zero.
export default function StatCards({ view, rows }) {
	const stats = Array.isArray(view.stats) ? view.stats : [];
	const row = rows[0] || {};
	return (
		<div style={s.grid}>
			{stats.map((st) => (
				<div key={st.field} style={s.card}>
					<div style={s.label}>{st.label}</div>
					<div style={s.value}>{fmt(row[st.field])}</div>
				</div>
			))}
		</div>
	);
}

function fmt(v) {
	if (v == null) return '0';
	if (typeof v === 'boolean') return v ? 'Yes' : 'No';
	return String(v);
}

const s = {
	grid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
		gap: '14px',
	},
	card: {
		padding: '20px', background: colors.surface1,
		border: `1.5px solid ${colors.hairline}`, borderRadius: `${radius.card}px`,
	},
	label: {
		fontFamily: fonts.body, fontSize: `${fontSize.caption}px`,
		fontWeight: 500, color: colors.inkMuted, marginBottom: '8px',
	},
	value: {
		fontFamily: fonts.display, fontSize: `${fontSize.display}px`,
		fontWeight: 400, color: colors.ink, lineHeight: 1,
	},
};
