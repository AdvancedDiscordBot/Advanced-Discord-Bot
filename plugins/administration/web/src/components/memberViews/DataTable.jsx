import React from 'react';
import { colors, fonts, fontSize } from '../../theme';
import { Button } from '../UI';

// Renders a rendered member page of view.type === "table".
// `view.columns` names which fields become columns; declared actions get an
// extra trailing column.
export default function DataTable({ view, rows, onAction, busyRow }) {
	const columns = Array.isArray(view.columns) ? view.columns : [];
	const hasActions = Array.isArray(view.actions) && view.actions.length > 0;
	return (
		<div style={s.scroll}>
			<table style={s.table}>
				<thead>
					<tr>
						{columns.map((c) => (
							<th key={c.field} style={s.th}>{c.label}</th>
						))}
						{hasActions && <th style={s.th} />}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.id} style={s.tr}>
							{columns.map((c) => (
								<td key={c.field} style={s.td}>{fmt(row[c.field])}</td>
							))}
							{hasActions && (
								<td style={{ ...s.td, ...s.actionsTd }}>
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
								</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function fmt(v) {
	if (v == null) return '';
	if (typeof v === 'boolean') return v ? 'Yes' : 'No';
	return String(v);
}

const s = {
	scroll: { overflowX: 'auto' },
	table: { width: '100%', borderCollapse: 'collapse', fontFamily: fonts.body },
	th: {
		textAlign: 'left', padding: '10px 12px',
		fontSize: `${fontSize.caption}px`, fontWeight: 600, color: colors.inkMuted,
		borderBottom: `1.5px solid ${colors.hairlineStrong}`, whiteSpace: 'nowrap',
	},
	tr: { borderBottom: `1px solid ${colors.hairline}` },
	td: {
		padding: '12px', fontSize: `${fontSize.meta}px`, color: colors.ink,
		verticalAlign: 'middle',
	},
	actionsTd: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
	actionBtn: { padding: '6px 12px' },
};
