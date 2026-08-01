import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

import { colors, fonts, radius, fontSize } from '../theme';
import { EmptyState } from '../components/UI';
import DataList from '../components/memberViews/DataList';
import DataTable from '../components/memberViews/DataTable';
import StatCards from '../components/memberViews/StatCards';

// Platform-rendered member page. For plugins that declared a `source` + `view`
// in their manifest memberPages entry, the platform reads the plugin model —
// force-scoped server-side to {guildId, userId} — and renders it here with the
// built-in view library. No plugin web server, no iframe.
//
// The page path arrives as a query param (?path=) so plugin subpaths with
// slashes don't collide with the router.
export default function MemberPluginPage() {
	const { guildId, pluginName } = useParams();
	const navigate = useNavigate();
	const params = new URLSearchParams(window.location.search);
	const path = params.get('path') || '/';
	const pageLabel = params.get('label') || '';

	const [state, setState] = useState({ loading: true, view: null, rows: [], error: null });
	const [busyRow, setBusyRow] = useState(null);

	const load = useCallback(async () => {
		try {
			const url = `/api/me/guild/${guildId}/plugins/${encodeURIComponent(pluginName)}/data?path=${encodeURIComponent(path)}`;
			const res = await fetch(url);
			if (!res.ok) {
				setState({ loading: false, view: null, rows: [], error: res.status });
				return;
			}
			const data = await res.json();
			setState({ loading: false, view: data.view || null, rows: data.rows || [], error: null });
		} catch {
			setState({ loading: false, view: null, rows: [], error: 'network' });
		}
	}, [guildId, pluginName, path]);

	useEffect(() => {
		let alive = true;
		(async () => {
			await load();
			if (!alive) return;
		})();
		return () => {
			alive = false;
		};
	}, [load]);

	// Run a declared action against one of the caller's own rows. The client
	// only ever names an actionId + rowId — the server owns the op/field and the
	// {guildId, userId} scope. On success we reload so the view reflects reality.
	const onAction = useCallback(
		async (actionId, rowId) => {
			setBusyRow(`${rowId}:${actionId}`);
			try {
				const res = await fetch(`/api/me/guild/${guildId}/plugins/${encodeURIComponent(pluginName)}/action`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ path, actionId, rowId }),
				});
				if (res.ok) await load();
			} finally {
				setBusyRow(null);
			}
		},
		[guildId, pluginName, path, load],
	);

	const back = () => navigate(`/guild/${guildId}`);

	return (
		<div style={s.wrap}>
			<button style={s.back} onClick={back}>
				<ChevronLeft size={16} />
				<span>Back to pages</span>
			</button>

			{state.loading ? (
				<div style={s.loading}>Loading…</div>
			) : state.error === 403 ? (
				<EmptyState title="No access" body="You don’t have access to this page." />
			) : state.error ? (
				<EmptyState title="Couldn’t load this page" body="Please try again in a moment." />
			) : (
				<Rendered view={state.view} rows={state.rows} onAction={onAction} busyRow={busyRow} pageLabel={pageLabel} />
			)}
		</div>
	);
}

function Rendered({ view, rows, onAction, busyRow, pageLabel }) {
	if (!view) return <EmptyState title="Nothing here" body="This page has nothing to show." />;

	const isEmpty = !Array.isArray(rows) || rows.length === 0;

	return (
		<div>
			{pageLabel && <h1 style={s.h1}>{pageLabel}</h1>}

			{isEmpty && view.type !== 'stat' ? (
				<EmptyState title="All clear" body={view.empty || 'There’s nothing here yet.'} />
			) : view.type === 'table' ? (
				<DataTable view={view} rows={rows} onAction={onAction} busyRow={busyRow} />
			) : view.type === 'stat' ? (
				<StatCards view={view} rows={rows} />
			) : (
				<DataList view={view} rows={rows} onAction={onAction} busyRow={busyRow} />
			)}
		</div>
	);
}

const s = {
	wrap: { maxWidth: '760px', margin: '0 auto' },
	back: {
		display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '16px',
		padding: '6px 10px', borderRadius: `${radius.control}px`, border: 'none',
		background: 'transparent', color: colors.inkMuted, cursor: 'pointer',
		fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
	},
	h1: {
		fontFamily: fonts.display, fontWeight: 300, color: colors.ink,
		fontSize: `${fontSize.heading}px`, margin: '0 0 4px',
	},
	sub: {
		fontFamily: fonts.body, fontSize: `${fontSize.meta}px`,
		color: colors.inkMuted, margin: '0 0 20px',
	},
	loading: { padding: '48px', textAlign: 'center', color: colors.inkMuted, fontFamily: fonts.body },
};
