import React, { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { Card, Button, Toggle, Input, Select } from "../components/UI";
import { useApiFetch } from "../hooks/useApi";
import { colors, fonts, radius, fontSize } from "../theme";
import {
	Package,
	Search,
	Download,
	Trash2,
	ExternalLink,
	Settings,
	Puzzle,
	Shield,
	Info,
	X,
} from "lucide-react";

export function Plugins() {
	const { guildData, refreshGuild } = useOutletContext();
	const { guild } = guildData || {};
	const guildId = guild?.id;

	const [installedPlugins, setInstalledPlugins] = useState([]);
	const [marketplacePlugins, setMarketplacePlugins] = useState([]);
	const [categories, setCategories] = useState([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState("");
	const [loading, setLoading] = useState(true);
	const [installing, setInstalling] = useState(null);
	const [uninstalling, setUninstalling] = useState(null);
	const [installLog, setInstallLog] = useState("");
	const [showInstallModal, setShowInstallModal] = useState(false);
	const [customPackage, setCustomPackage] = useState("");
	const [selectedPlugin, setSelectedPlugin] = useState(null);
	const [pluginSettings, setPluginSettings] = useState({});
	const [brochurePlugin, setBrochurePlugin] = useState(null);
	const [brochureContent, setBrochureContent] = useState("");
	const [brochureLoading, setBrochureLoading] = useState(false);

	const { request } = useApiFetch();

	useEffect(() => {
		loadData();
	}, [guildId]);

	useEffect(() => {
		if (searchQuery || selectedCategory) {
			searchMarketplace();
		} else {
			loadMarketplace();
		}
	}, [searchQuery, selectedCategory]);

	async function loadData() {
		setLoading(true);
		try {
			const [installedRes, categoriesRes] = await Promise.all([
				request(`/api/plugins`),
				request(`/api/plugins/categories`),
			]);
			setInstalledPlugins(installedRes?.plugins || []);
			setCategories(categoriesRes?.categories || []);
			await loadMarketplace();
		} catch (err) {
			console.error("Failed to load plugins:", err);
		} finally {
			setLoading(false);
		}
	}

	async function loadMarketplace() {
		try {
			const res = await request("/api/plugins/marketplace");
			setMarketplacePlugins(res?.plugins || []);
		} catch (err) {
			console.error("Failed to load marketplace:", err);
		}
	}

	async function searchMarketplace() {
		try {
			const params = new URLSearchParams();
			if (searchQuery) params.set("q", searchQuery);
			if (selectedCategory) params.set("category", selectedCategory);
			const res = await request(`/api/plugins/marketplace?${params}`);
			setMarketplacePlugins(res?.plugins || []);
		} catch (err) {
			console.error("Failed to search marketplace:", err);
		}
	}

	async function handleInstall(packageName) {
		setInstalling(packageName);
		setInstallLog("");
		try {
			const res = await request("/api/plugins/install", {
				method: "POST",
				body: JSON.stringify({ packageName }),
			});
			if (res.ok) {
				await loadData();
			}
		} catch (err) {
			console.error("Install failed:", err);
		} finally {
			setInstalling(null);
			setInstallLog("");
		}
	}

	async function handleUninstall(packageName) {
		// eslint-disable-next-line no-restricted-globals
		if (!window.confirm(`Are you sure you want to uninstall ${packageName}? This will also remove all its data.`)) {
			return;
		}

		setUninstalling(packageName);
		try {
			const res = await request("/api/plugins/uninstall", {
				method: "POST",
				body: JSON.stringify({ packageName }),
			});
			if (res.ok) {
				await loadData();
			}
		} catch (err) {
			console.error("Uninstall failed:", err);
		} finally {
			setUninstalling(null);
		}
	}

	async function handleTogglePlugin(pluginName, enabled) {
		try {
			if (enabled) {
				await request(`/api/plugins/reload/${pluginName}`, { method: "POST" });
			} else {
				await request(`/api/plugins/unload/${pluginName}`, { method: "POST" });
			}
			await loadData();
		} catch (err) {
			console.error("Toggle failed:", err);
		}
	}

	async function handleCustomInstall() {
		if (!customPackage) return;
		await handleInstall(customPackage);
		setShowInstallModal(false);
		setCustomPackage("");
	}

	async function openBrochure(plugin) {
		setBrochurePlugin(plugin);
		setBrochureContent("");
		setBrochureLoading(true);
		try {
			const res = await request(`/api/plugins/${plugin.name}/brochure`);
			setBrochureContent(res?.content || "");
		} catch (err) {
			console.error("Failed to load brochure:", err);
		} finally {
			setBrochureLoading(false);
		}
	}

	async function loadPluginSettings(pluginName) {
		try {
			const res = await request(`/api/plugins/config/${pluginName}?guildId=${guildId}`);
			setPluginSettings((prev) => ({
				...prev,
				[pluginName]: res?.config || {},
			}));
		} catch (err) {
			console.error("Failed to load plugin settings:", err);
		}
	}

	async function savePluginSettings(pluginName) {
		try {
			await request(`/api/plugins/config/${pluginName}`, {
				method: "PUT",
				body: JSON.stringify(pluginSettings[pluginName] || {}),
			});
			// eslint-disable-next-line no-alert
			alert("Settings saved!");
		} catch (err) {
			console.error("Failed to save settings:", err);
		}
	}

	function handleSettingChange(pluginName, key, value) {
		setPluginSettings((prev) => ({
			...prev,
			[pluginName]: {
				...prev[pluginName],
				[key]: value,
			},
		}));
	}

	if (!guild) return null;

	return (
		<div style={styles.container}>
			<div style={styles.header}>
				<div>
					<h1 style={styles.pageTitle}>Plugins</h1>
					<p style={styles.pageSubtitle}>
						Manage your server's plugins and browse the marketplace
					</p>
				</div>
				<div style={styles.headerActions}>
					<Button
						variant="secondary"
						onClick={() => window.open('https://github.com/adb-plugin-registry/registry', '_blank')}
					>
						<ExternalLink size={16} style={{ marginRight: 8 }} />
						Submit Plugin
					</Button>
					<Button onClick={() => setShowInstallModal(true)}>
						<Download size={16} style={{ marginRight: 8 }} />
						Install Custom
					</Button>
				</div>
			</div>

			<h2 style={styles.sectionTitle}>Installed Plugins</h2>
			{loading ? (
				<div style={styles.loading}>Loading...</div>
			) : installedPlugins.length === 0 ? (
				<Card>
					<div style={styles.empty}>
						<Puzzle size={48} color={colors.inkMuted} />
						<p>No plugins installed</p>
						<p style={styles.emptyHint}>
							Browse the marketplace below to add plugins
						</p>
					</div>
				</Card>
			) : (
				<div style={styles.pluginGrid}>
					{installedPlugins.map((plugin) => (
						<PluginCard
							key={plugin.name}
							plugin={plugin}
							installed={true}
							onToggle={(enabled) =>
								handleTogglePlugin(plugin.name, enabled)
							}
							onUninstall={() => handleUninstall(plugin.name)}
							onSettings={() => {
								setSelectedPlugin(plugin);
								loadPluginSettings(plugin.name);
							}}
							onAbout={() => openBrochure(plugin)}
							guildId={guildId}
						/>
					))}
				</div>
			)}

			<h2 style={styles.sectionTitle}>Marketplace</h2>
			<div style={styles.searchBar}>
				<div style={styles.searchInput}>
					<Search size={18} color={colors.inkMuted} />
					<input
						type="text"
						placeholder="Search plugins..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						style={styles.searchField}
					/>
				</div>
				<Select
					value={selectedCategory}
					onChange={setSelectedCategory}
					options={[
						{ value: "", label: "All Categories" },
						...categories.map((c) => ({ value: c.id, label: c.name })),
					]}
					style={{ width: 180 }}
				/>
			</div>

			<div style={styles.pluginGrid}>
				{marketplacePlugins
					.filter((p) => !p.installed)
					.map((plugin) => (
						<PluginCard
							key={plugin.name}
							plugin={plugin}
							installed={false}
							onInstall={() =>
								handleInstall(plugin.npmPackage || plugin.name)
							}
							installing={installing === (plugin.npmPackage || plugin.name)}
						/>
					))}
			</div>

			{showInstallModal && (
				<div style={styles.modalOverlay} onClick={() => setShowInstallModal(false)}>
					<div style={styles.modal} onClick={(e) => e.stopPropagation()}>
						<h2 style={styles.modalTitle}>Install Custom Plugin</h2>
						<p style={styles.modalHint}>
							Enter the npm package name (must start with adb-plugin-)
						</p>
						<Input
							value={customPackage}
							onChange={setCustomPackage}
							placeholder="adb-plugin-my-plugin"
						/>
						<div style={styles.modalActions}>
							<Button variant="secondary" onClick={() => setShowInstallModal(false)}>
								Cancel
							</Button>
							<Button onClick={handleCustomInstall} loading={!!installing}>
								Install
							</Button>
						</div>
					</div>
				</div>
			)}

			{selectedPlugin && (
				<PluginSettingsModal
					plugin={selectedPlugin}
					settings={pluginSettings[selectedPlugin.name] || {}}
					onClose={() => setSelectedPlugin(null)}
					onChange={(key, value) =>
						handleSettingChange(selectedPlugin.name, key, value)
					}
					onSave={() => savePluginSettings(selectedPlugin.name)}
				/>
			)}

			{brochurePlugin && (
				<BrochureModal
					plugin={brochurePlugin}
					content={brochureContent}
					loading={brochureLoading}
					onClose={() => setBrochurePlugin(null)}
				/>
			)}
		</div>
	);
}

function PluginCard({
	plugin,
	installed,
	onToggle,
	onUninstall,
	onInstall,
	onSettings,
	onAbout,
	installing,
	guildId,
}) {
	const hasDashboard = plugin.manifest?.port || plugin.port;
	const hasSettings = plugin.manifest?.configSchema || plugin.configSchema;

	const dashboardUrl = hasDashboard
		? `http://localhost:${plugin.manifest?.port || plugin.port}`
		: null;

	return (
		<Card style={styles.pluginCard}>
			<div style={styles.pluginHeader}>
				<div style={styles.pluginIcon}>
					<Package size={24} color={colors.accent} />
				</div>
				<div style={styles.pluginInfo}>
					<h3 style={styles.pluginName}>{plugin.displayName || plugin.name}</h3>
					<p style={styles.pluginVersion}>v{plugin.version}</p>
				</div>
				{plugin.verified && (
					<div style={styles.verifiedBadge}>
						<Shield size={14} color={colors.cream} />
					</div>
				)}
			</div>

			<p style={styles.pluginDesc}>{plugin.description}</p>

			<div style={styles.pluginMeta}>
				<span style={styles.metaItem}>by {plugin.author}</span>
				{plugin.requiresRestart && (
					<span style={styles.restartBadge}>Restart required</span>
				)}
			</div>

			{installed ? (
				<div style={styles.pluginActions}>
					{hasSettings && (
						<Button
							variant="secondary"
							size="small"
							onClick={onSettings}
						>
							<Settings size={14} style={{ marginRight: 4 }} />
							Settings
						</Button>
					)}
					{hasDashboard && dashboardUrl && (
						<Button
							variant="secondary"
							size="small"
							onClick={() => window.open(dashboardUrl, "_blank")}
						>
							<ExternalLink size={14} style={{ marginRight: 4 }} />
							Dashboard
						</Button>
					)}
					{plugin.hasBrochure && (
						<Button
							variant="secondary"
							size="small"
							onClick={onAbout}
						>
							<Info size={14} style={{ marginRight: 4 }} />
							About
						</Button>
					)}
					<div style={{ flex: 1 }} />
					<Button
						variant="danger"
						size="small"
						onClick={onUninstall}
					>
						<Trash2 size={14} />
					</Button>
				</div>
			) : (
				<Button
					onClick={onInstall}
					loading={installing}
					style={{ width: "100%" }}
				>
					<Download size={16} style={{ marginRight: 8 }} />
					Install
				</Button>
			)}
		</Card>
	);
}

function PluginSettingsModal({ plugin, settings, onClose, onChange, onSave }) {
	const schema = plugin.manifest?.configSchema || plugin.configSchema || {};
	const properties = schema.properties || {};

	return (
		<div style={styles.modalOverlay} onClick={onClose}>
			<div style={styles.modal} onClick={(e) => e.stopPropagation()}>
				<h2 style={styles.modalTitle}>{plugin.displayName} Settings</h2>

				{Object.keys(properties).length === 0 ? (
					<div style={styles.noSettings}>
						<Settings size={32} color={colors.inkMuted} />
						<p>This plugin doesn't have configurable settings</p>
					</div>
				) : (
					<div style={styles.settingsForm}>
						{Object.entries(properties).map(([key, prop]) => (
							<div key={key} style={styles.formGroup}>
								<label style={styles.label}>{key}</label>
								{renderSettingInput(key, prop, settings[key], onChange)}
							</div>
						))}
					</div>
				)}

				<div style={styles.modalActions}>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
					{Object.keys(properties).length > 0 && (
						<Button onClick={onSave}>Save Settings</Button>
					)}
				</div>
			</div>
		</div>
	);
}

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
	let out = "";
	let inCode = false;
	let codeBuf = [];
	let inTable = false;
	let tableHead = true;
	let inList = false;

	const closeList = () => { if (inList) { out += "</ul>"; inList = false; } };
	const closeTable = () => { if (inTable) { out += "</tbody></table>"; inTable = false; tableHead = true; } };

	for (const line of lines) {
		if (line.startsWith("```")) {
			if (inCode) {
				out += `<pre><code>${esc(codeBuf.join("\n"))}</code></pre>`;
				codeBuf = [];
				inCode = false;
			} else {
				closeList();
				closeTable();
				inCode = true;
			}
			continue;
		}
		if (inCode) { codeBuf.push(line); continue; }

		if (line.startsWith("|")) {
			if (line.match(/^\|[\s\-|:]+\|$/)) {
				// separator — close thead, open tbody
				if (inTable && tableHead) {
					out += "</tr></thead><tbody>";
					tableHead = false;
				}
				continue;
			}
			const cells = line.split("|").slice(1, -1).map((c) => c.trim());
			if (!inTable) {
				closeList();
				out += "<table><thead><tr>";
				out += cells.map((c) => `<th>${inline(c)}</th>`).join("");
				inTable = true;
				tableHead = true;
			} else if (tableHead) {
				out += cells.map((c) => `<th>${inline(c)}</th>`).join("");
			} else {
				out += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
			}
			continue;
		}
		closeTable();

		if (line.match(/^[-*] /)) {
			if (!inList) { out += "<ul>"; inList = true; }
			out += `<li>${inline(line.slice(2))}</li>`;
			continue;
		}
		closeList();

		if (line.startsWith("### ")) { out += `<h3>${inline(line.slice(4))}</h3>`; continue; }
		if (line.startsWith("## ")) { out += `<h2>${inline(line.slice(3))}</h2>`; continue; }
		if (line.startsWith("# ")) { out += `<h1>${inline(line.slice(2))}</h1>`; continue; }
		if (line.startsWith("> ")) { out += `<blockquote>${inline(line.slice(2))}</blockquote>`; continue; }
		if (line.trim() === "") { out += "<br>"; continue; }
		out += `<p>${inline(line)}</p>`;
	}
	closeList();
	closeTable();
	return out;
}

function BrochureModal({ plugin, content, loading, onClose }) {
	const html = content ? parseMarkdown(content) : "";
	const title = plugin.displayName || plugin.name;

	return (
		<div style={styles.modalOverlay} onClick={onClose}>
			<div style={styles.brochureModal} onClick={(e) => e.stopPropagation()}>
				<style>{`
					.brochure-body h1 { font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 400; margin: 0 0 8px; color: var(--ink); }
					.brochure-body h2 { font-family: 'Cormorant Garamond', serif; font-size: 21px; font-weight: 400; margin: 24px 0 8px; color: var(--ink); border-bottom: 1px solid var(--hairline); padding-bottom: 6px; }
					.brochure-body h3 { font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; margin: 20px 0 6px; color: var(--ink); text-transform: uppercase; letter-spacing: 0.04em; }
					.brochure-body p { font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; color: var(--ink2); margin: 0 0 10px; }
					.brochure-body ul { padding-left: 20px; margin: 0 0 12px; }
					.brochure-body li { font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.7; color: var(--ink2); }
					.brochure-body strong { font-weight: 600; color: var(--ink); }
					.brochure-body em { font-style: italic; }
					.brochure-body code { font-family: 'Fira Code', 'Fira Mono', 'Courier New', monospace; font-size: 13px; background: var(--surface2); padding: 2px 6px; border-radius: 4px; color: var(--accent); }
					.brochure-body pre { background: var(--surface2); border-radius: 8px; padding: 16px; overflow-x: auto; margin: 12px 0; }
					.brochure-body pre code { background: none; padding: 0; color: var(--ink); }
					.brochure-body blockquote { border-left: 3px solid var(--accent); margin: 12px 0; padding: 8px 16px; background: var(--accentTint); border-radius: 0 6px 6px 0; }
					.brochure-body blockquote p { margin: 0; color: var(--ink2); }
					.brochure-body table { width: 100%; border-collapse: collapse; margin: 12px 0; font-family: 'DM Sans', sans-serif; font-size: 13px; }
					.brochure-body th { text-align: left; padding: 8px 12px; background: var(--surface2); color: var(--ink); font-weight: 600; border-bottom: 1px solid var(--hairlineStrong); }
					.brochure-body td { padding: 8px 12px; color: var(--ink2); border-bottom: 1px solid var(--hairline); }
					.brochure-body a { color: var(--accent); text-decoration: none; }
					.brochure-body a:hover { text-decoration: underline; }
					.brochure-body br { display: block; height: 4px; content: ''; }
				`}</style>
				<div style={styles.brochureHeader}>
					<div>
						<h2 style={styles.brochureTitle}>{title}</h2>
						{plugin.version && <span style={styles.brochureVersion}>v{plugin.version}</span>}
					</div>
					<button style={styles.brochureClose} onClick={onClose}>
						<X size={18} />
					</button>
				</div>
				<div style={styles.brochureBody}>
					{loading ? (
						<div style={styles.brochureLoading}>Loading...</div>
					) : (
						<div
							className="brochure-body"
							// eslint-disable-next-line react/no-danger
							dangerouslySetInnerHTML={{ __html: html }}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function renderSettingInput(key, prop, value, onChange) {
	const baseInput = {
		width: "100%",
		padding: "11px 14px",
		background: colors.cream,
		border: `1.5px solid ${colors.hairlineStrong}`,
		borderRadius: `${radius.control}px`,
		color: colors.ink,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
		outline: "none",
	};

	if (prop.type === "boolean") {
		return (
			<Toggle
				checked={value || false}
				onChange={(v) => onChange(key, v)}
			/>
		);
	}

	if (prop.type === "number") {
		return (
			<input
				type="number"
				value={value || prop.default || 0}
				onChange={(e) => onChange(key, Number(e.target.value))}
				min={prop.minimum}
				max={prop.maximum}
				style={baseInput}
			/>
		);
	}

	if (prop.enum) {
		return (
			<Select
				value={value || prop.default || ""}
				onChange={(v) => onChange(key, v)}
				options={prop.enum.map((e) => ({ value: e, label: e }))}
			/>
		);
	}

	return (
		<input
			type="text"
			value={value || prop.default || ""}
			onChange={(e) => onChange(key, e.target.value)}
			placeholder={prop.description}
			style={baseInput}
		/>
	);
}

const styles = {
	container: {
		maxWidth: 1200,
	},
	header: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "flex-start",
		marginBottom: 24,
	},
	headerActions: {
		display: "flex",
		gap: 12,
	},
	pageTitle: {
		color: colors.ink,
		fontFamily: fonts.display,
		fontSize: `${fontSize.heading}px`,
		fontWeight: 400,
		marginBottom: 4,
	},
	pageSubtitle: {
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
	},
	sectionTitle: {
		color: colors.ink,
		fontFamily: fonts.display,
		fontSize: `${fontSize.title}px`,
		fontWeight: 400,
		marginBottom: 16,
		marginTop: 32,
	},
	loading: {
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
		textAlign: "center",
		padding: 40,
	},
	empty: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: 12,
		padding: 40,
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
	},
	emptyHint: {
		fontSize: `${fontSize.caption}px`,
	},
	pluginGrid: {
		display: "grid",
		gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
		gap: 16,
	},
	pluginCard: {
		display: "flex",
		flexDirection: "column",
		gap: 12,
	},
	pluginHeader: {
		display: "flex",
		alignItems: "center",
		gap: 12,
	},
	pluginIcon: {
		width: 48,
		height: 48,
		borderRadius: radius.card,
		background: colors.accentTint,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	},
	pluginInfo: {
		flex: 1,
	},
	pluginName: {
		color: colors.ink,
		fontFamily: fonts.display,
		fontSize: `${fontSize.title}px`,
		fontWeight: 400,
		margin: 0,
	},
	pluginVersion: {
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.caption}px`,
		margin: 0,
	},
	verifiedBadge: {
		width: 24,
		height: 24,
		borderRadius: 6,
		background: colors.pineStrong,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	},
	pluginDesc: {
		color: colors.ink2,
		fontFamily: fonts.body,
		fontSize: `${fontSize.caption}px`,
		lineHeight: 1.5,
		margin: 0,
	},
	pluginMeta: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		fontFamily: fonts.body,
		fontSize: `${fontSize.caption}px`,
		color: colors.inkMuted,
	},
	metaItem: {},
	restartBadge: {
		padding: "2px 8px",
		background: colors.warningTint,
		color: colors.warningText,
		borderRadius: radius.pill,
		fontSize: '11px',
		fontWeight: 500,
	},
	pluginActions: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		marginTop: 8,
	},
	searchBar: {
		display: "flex",
		gap: 12,
		marginBottom: 16,
	},
	searchInput: {
		flex: 1,
		display: "flex",
		alignItems: "center",
		gap: 8,
		padding: "10px 16px",
		background: colors.cream,
		borderRadius: radius.control,
		border: `1.5px solid ${colors.hairlineStrong}`,
	},
	searchField: {
		flex: 1,
		background: "transparent",
		border: "none",
		color: colors.ink,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
		outline: "none",
	},
	modalOverlay: {
		position: "fixed",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		background: "rgba(30, 26, 20, 0.45)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		zIndex: 1000,
	},
	modal: {
		background: colors.surface1,
		border: `1.5px solid ${colors.hairline}`,
		borderRadius: radius.card,
		padding: 24,
		width: "90%",
		maxWidth: 500,
		maxHeight: "90vh",
		overflow: "auto",
	},
	modalTitle: {
		color: colors.ink,
		fontFamily: fonts.display,
		fontSize: `${fontSize.heading}px`,
		fontWeight: 400,
		marginBottom: 8,
	},
	modalHint: {
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
		marginBottom: 20,
	},
	modalActions: {
		display: "flex",
		justifyContent: "flex-end",
		gap: 12,
		marginTop: 24,
	},
	formGroup: {
		marginBottom: 16,
	},
	label: {
		display: "block",
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.caption}px`,
		fontWeight: 500,
		marginBottom: 6,
	},
	settingsForm: {
		display: "flex",
		flexDirection: "column",
		gap: 16,
	},
	noSettings: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: 12,
		padding: 24,
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
	},
	brochureModal: {
		background: colors.surface1,
		border: `1.5px solid ${colors.hairline}`,
		borderRadius: radius.card,
		width: "90%",
		maxWidth: 720,
		maxHeight: "85vh",
		display: "flex",
		flexDirection: "column",
		overflow: "hidden",
	},
	brochureHeader: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "flex-start",
		padding: "20px 24px 16px",
		borderBottom: `1px solid ${colors.hairline}`,
		flexShrink: 0,
	},
	brochureTitle: {
		color: colors.ink,
		fontFamily: fonts.display,
		fontSize: `${fontSize.heading}px`,
		fontWeight: 400,
		margin: 0,
	},
	brochureVersion: {
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.caption}px`,
	},
	brochureClose: {
		background: "none",
		border: "none",
		cursor: "pointer",
		color: colors.inkMuted,
		padding: 4,
		display: "flex",
		alignItems: "center",
		borderRadius: radius.control,
	},
	brochureBody: {
		padding: "20px 24px",
		overflowY: "auto",
		flex: 1,
	},
	brochureLoading: {
		color: colors.inkMuted,
		fontFamily: fonts.body,
		fontSize: `${fontSize.meta}px`,
		textAlign: "center",
		padding: 40,
	},
};
