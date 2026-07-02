import React, { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { Card, Button, Toggle, Input, Select } from "../components/UI";
import { useApiFetch } from "../hooks/useApi";
import {
	Package,
	Search,
	Download,
	Trash2,
	ExternalLink,
	Settings,
	Check,
	X,
	AlertCircle,
	Puzzle,
	Shield,
	Github,
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
						<Puzzle size={48} color="#64748b" />
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
							guildId={guildId}
						/>
					))}
				</div>
			)}

			<h2 style={styles.sectionTitle}>Marketplace</h2>
			<div style={styles.searchBar}>
				<div style={styles.searchInput}>
					<Search size={18} color="#64748b" />
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
	installing,
	guildId,
}) {
	const [showDashboard, setShowDashboard] = useState(false);
	const hasDashboard = plugin.manifest?.port || plugin.port;
	const hasSettings = plugin.manifest?.configSchema || plugin.configSchema;

	const dashboardUrl = hasDashboard
		? `http://localhost:${plugin.manifest?.port || plugin.port}`
		: null;

	return (
		<Card style={styles.pluginCard}>
			<div style={styles.pluginHeader}>
				<div style={styles.pluginIcon}>
					<Package size={24} />
				</div>
				<div style={styles.pluginInfo}>
					<h3 style={styles.pluginName}>{plugin.displayName || plugin.name}</h3>
					<p style={styles.pluginVersion}>v{plugin.version}</p>
				</div>
				{plugin.verified && (
					<div style={styles.verifiedBadge}>
						<Shield size={14} />
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
						<Settings size={32} color="#64748b" />
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

function renderSettingInput(key, prop, value, onChange) {
	const baseInput = {
		width: "100%",
		padding: "10px 12px",
		background: "#0f172a",
		border: "1px solid #334155",
		borderRadius: "8px",
		color: "#e2e8f0",
		fontSize: "14px",
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
		color: "#f1f5f9",
		fontSize: "24px",
		fontWeight: 700,
		marginBottom: 4,
	},
	pageSubtitle: {
		color: "#64748b",
		fontSize: "14px",
	},
	sectionTitle: {
		color: "#f1f5f9",
		fontSize: "18px",
		fontWeight: 600,
		marginBottom: 16,
		marginTop: 32,
	},
	loading: {
		color: "#64748b",
		textAlign: "center",
		padding: 40,
	},
	empty: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		gap: 12,
		padding: 40,
		color: "#64748b",
	},
	emptyHint: {
		fontSize: "13px",
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
		borderRadius: 12,
		background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		color: "#fff",
	},
	pluginInfo: {
		flex: 1,
	},
	pluginName: {
		color: "#f1f5f9",
		fontSize: "16px",
		fontWeight: 600,
		margin: 0,
	},
	pluginVersion: {
		color: "#64748b",
		fontSize: "12px",
		margin: 0,
	},
	verifiedBadge: {
		width: 24,
		height: 24,
		borderRadius: 6,
		background: "#10B981",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		color: "#fff",
	},
	pluginDesc: {
		color: "#94a3b8",
		fontSize: "13px",
		lineHeight: 1.5,
		margin: 0,
	},
	pluginMeta: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		fontSize: "12px",
		color: "#64748b",
	},
	metaItem: {},
	restartBadge: {
		padding: "2px 8px",
		background: "#F59E0B",
		color: "#fff",
		borderRadius: 4,
		fontSize: "11px",
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
		background: "#1e293b",
		borderRadius: 8,
		border: "1px solid #334155",
	},
	searchField: {
		flex: 1,
		background: "transparent",
		border: "none",
		color: "#e2e8f0",
		fontSize: "14px",
		outline: "none",
	},
	modalOverlay: {
		position: "fixed",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		background: "rgba(0, 0, 0, 0.7)",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		zIndex: 1000,
	},
	modal: {
		background: "#1e293b",
		borderRadius: 16,
		padding: 24,
		width: "90%",
		maxWidth: 500,
		maxHeight: "90vh",
		overflow: "auto",
	},
	modalTitle: {
		color: "#f1f5f9",
		fontSize: "20px",
		fontWeight: 700,
		marginBottom: 8,
	},
	modalHint: {
		color: "#64748b",
		fontSize: "14px",
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
		color: "#94a3b8",
		fontSize: "13px",
		marginBottom: 6,
	},
	textarea: {
		width: "100%",
		minHeight: 100,
		padding: "12px",
		background: "#0f172a",
		border: "1px solid #334155",
		borderRadius: "8px",
		color: "#e2e8f0",
		fontSize: "14px",
		resize: "vertical",
		outline: "none",
		fontFamily: "inherit",
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
		color: "#64748b",
	},
};