/**
 * broker.js — CapabilityBroker.
 *
 * Runs in the Core process. Receives RPC requests from plugin workers,
 * validates that the plugin has declared the required capability,
 * then executes the actual operation (DB query, Discord API call, etc.)
 * and returns the result.
 *
 * The broker is the ONLY path through which plugin code can touch
 * real resources. Every call is capability-gated.
 */

const { EventEmitter } = require("events");
const { randomUUID } = require("crypto");
const { getMethodDef, isValidMethod, INTERACTION_METHODS } = require("./methods");
const { serializeValue } = require("./schema-serialize");
const { createLogger } = require("../logger");
const { ResourceTracker, withResourceLimits, createLimitsFromCapabilities } = require("./resource-limits");
const { metricsCollector } = require("./metrics");
const { ViolationTracker, KIND } = require("./violations");

// Cap on the response body (bytes) returned to a plugin from network.fetch, so a
// plugin can't stream an unbounded body back across the RPC boundary.
const NETWORK_MAX_BODY_BYTES = 5 * 1024 * 1024;
// Wall-clock ceiling for a single network.fetch, independent of the plugin's
// per-call execution budget.
const NETWORK_TIMEOUT_MS = 15_000;
const INTERACTION_TTL_MS = 15 * 60 * 1000;
const DISCORD_PRIVATE_KEYS = new Set(["client", "token", "webhook", "authorization"]);
// ai.generate limits. The per-user cooldown default applies until a guild admin
// sets the calling plugin's `ai_user_cooldown_seconds` setting.
const AI_DEFAULT_USER_COOLDOWN_S = 10;
const AI_GUILD_MAX_PER_MINUTE = 20;
const AI_MAX_PROMPT_CHARS = 8000;
const AI_TIMEOUT_MS = 25_000;
const AI_DEFAULT_MODEL = "gemini-2.5-flash";

class CapabilityBroker extends EventEmitter {
	/**
	 * @param {object} opts
	 * @param {object} opts.db       - Database singleton (utils/database.js)
	 * @param {object} opts.client   - Discord.js Client (for future discord RPC)
	 * @param {object} opts.hooks    - HookBus instance
	 * @param {string} [opts.logNamespace] - Logger namespace
	 */
	constructor(opts) {
		super();
		const { db, client, hooks, logNamespace = "CapabilityBroker" } = opts;
		this.db = db;
		this.client = client;
		this.hooks = hooks;
		this.logger = createLogger(logNamespace);

		/** @type {Map<string, object>} pluginId → capabilities object */
		this.pluginCapabilities = new Map();

		/** @type {Map<string, string>} pluginId → pluginName (for logging) */
		this.pluginNames = new Map();

		/** @type {Map<string, string[]>} pluginId → allowed outbound hosts (network.outbound) */
		this.networkAllowlists = new Map();

		/** @type {Map<string, ResourceTracker>} pluginId → resource tracker */
		this.resourceTrackers = new Map();

		/**
		 * Violation ledger + auto-suspension. Injectable so tests can drive the
		 * clock and threshold; defaults to the standard policy.
		 * @type {ViolationTracker}
		 */
		this.violations = opts.violations || new ViolationTracker();

		/** Stats for observability */
		this.stats = { requests: 0, denied: 0, errors: 0, suspended: 0 };
		this.interactions = new Map();
		this.interactionOwners = new Map();
		this.modalOwners = new Map();
		this.messageOwners = new Map();
		/** @type {Map<string, number>} "guildId:userId" → last ai.generate timestamp */
		this.aiUserLastCall = new Map();
		/** @type {Map<string, number[]>} guildId → ai.generate timestamps in the last minute */
		this.aiGuildCalls = new Map();

		// Start metrics collection
		metricsCollector.start(60000);
	}

	// ── Capability Registration ──────────────────────────────────────────

	/**
	 * Register a plugin's declared capabilities.
	 * Called once when the plugin is loaded.
	 */
	registerCapabilities(pluginId, capabilities, pluginName, options = {}) {
		this.pluginCapabilities.set(pluginId, capabilities || {});
		this.pluginNames.set(pluginId, pluginName || pluginId);

		// network.outbound host allowlist (v2 manifest). --allow-net at the process
		// level is all-or-nothing; the specific "this plugin may reach api.x.com and
		// nowhere else" guarantee is enforced here, per-call, against this list.
		this.networkAllowlists.set(pluginId, Array.isArray(options.networkAllowlist) ? options.networkAllowlist : []);

		const limits = createLimitsFromCapabilities(capabilities);
		const tracker = new ResourceTracker(pluginId, limits);
		tracker.start();
		this.resourceTrackers.set(pluginId, tracker);

		metricsCollector.registerPlugin(pluginId, limits);
		this.logger.debug(`Registered capabilities for ${pluginName || pluginId}: ${JSON.stringify(capabilities)}`);
	}

	/**
	 * Remove a plugin's capabilities (on unload).
	 */
	unregisterCapabilities(pluginId) {
		const wasRegistered = this.pluginCapabilities.has(pluginId);
		this.pluginCapabilities.delete(pluginId);
		this.pluginNames.delete(pluginId);
		this.networkAllowlists.delete(pluginId);

		const tracker = this.resourceTrackers.get(pluginId);
		if (tracker) {
			tracker.stop();
			this.resourceTrackers.delete(pluginId);
		}
		if (wasRegistered) metricsCollector.unregisterPlugin(pluginId);
		this.releasePluginInteractions(pluginId);
		for (const [key, unsubscribe] of this._hookSubscriptions || []) {
			if (!key.startsWith(`${pluginId}:`)) continue;
			unsubscribe();
			this._hookSubscriptions.delete(key);
		}
		for (const [key, entry] of this._scheduledTasks || []) {
			if (entry.pluginId !== pluginId) continue;
			entry.task.stop();
			this._scheduledTasks.delete(key);
		}
		for (const key of this._modelRegistry?.keys() || []) {
			if (key.startsWith(`${pluginId}:`)) this._modelRegistry.delete(key);
		}
		this.emit("plugin:unregistered", pluginId);
	}

	// Interaction tokens never leave this registry in the Core process.
	bindInteraction(pluginId, interaction) {
		if (!this.pluginCapabilities.has(pluginId) || this.isSuspended(pluginId)) {
			throw new Error("Plugin is not available for interaction handling");
		}
		const existing = this.interactions.get(this.interactionOwners.get(interaction.id));
		if (existing) {
			if (existing.pluginId !== pluginId) throw new Error("Interaction is owned by another plugin");
			return existing.handle;
		}
		const handle = randomUUID();
		const expiresAt = Math.min(interaction.createdTimestamp || Date.now(), Date.now()) + INTERACTION_TTL_MS;
		const timer = setTimeout(() => this.releaseInteraction(handle), Math.max(0, expiresAt - Date.now()));
		timer.unref();
		this.interactions.set(handle, { pluginId, interaction, handle, expiresAt, timer, queue: Promise.resolve(), messageIds: new Set(), modalKeys: new Set() });
		this.interactionOwners.set(interaction.id, handle);
		return handle;
	}

	releaseInteraction(handle) {
		const entry = this.interactions.get(handle);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.interactions.delete(handle);
		this.interactionOwners.delete(entry.interaction.id);
		for (const key of entry.modalKeys) {
			if (this.modalOwners.get(key) === handle) this.modalOwners.delete(key);
		}
		for (const key of entry.messageIds) {
			if (this.messageOwners.get(key) === handle) this.messageOwners.delete(key);
		}
	}

	releasePluginInteractions(pluginId) {
		for (const [handle, entry] of this.interactions) {
			if (entry.pluginId === pluginId) this.releaseInteraction(handle);
		}
	}

	/** Only continuations of this plugin's own messages/modals may gain reply authority. */
	interactionOwner(interaction) {
		let handle;
		if (interaction.type === 5) {
			handle = this.modalOwners.get(`${interaction.guildId || ""}:${interaction.user?.id}:${interaction.customId}`);
		} else if (interaction.type === 3) {
			handle = this.messageOwners.get(interaction.message?.id)
				|| this.interactionOwners.get(interaction.message?.interactionMetadata?.id || interaction.message?.interaction?.id);
		}
		const entry = this.interactions.get(handle);
		if (entry && entry.expiresAt > Date.now()) return entry.pluginId;
		// Components/modals on messages a plugin posted outside an interaction
		// (ctx.discord.sendToChannel — e.g. a giveaway "Enter" button) have no
		// owning reply. They route by a "<pluginId>:" customId prefix, which also
		// survives restarts. Interaction-owned messages above take precedence.
		if ((interaction.type === 3 || interaction.type === 5) && typeof interaction.customId === "string") {
			const sep = interaction.customId.indexOf(":");
			const prefix = sep > 0 ? interaction.customId.slice(0, sep) : null;
			if (prefix && this.pluginCapabilities.has(prefix) && !this.isSuspended(prefix)) return prefix;
		}
		return null;
	}

	async _interactionAction(pluginId, action, params) {
		const entry = this.interactions.get(params.handle);
		if (!entry || entry.pluginId !== pluginId || entry.expiresAt <= Date.now()) {
			throw new Error("Interaction is not authorized or has expired");
		}
		const run = entry.queue.then(async () => {
			if (this.interactions.get(params.handle) !== entry || entry.expiresAt <= Date.now()
				|| !this.pluginCapabilities.has(pluginId) || this.isSuspended(pluginId)) {
				throw new Error("Interaction is not authorized or has expired");
			}
			const interaction = entry.interaction;
			if (typeof interaction[action] !== "function") throw new Error(`Interaction does not support ${action}`);
			let payload = params.payload;
			if (!["showModal", "respond", "fetchReply", "deleteReply"].includes(action)) {
				payload = this._messagePayload(payload ?? {});
			}
			const messageId = ["fetchReply", "deleteReply"].includes(action) ? payload : payload?.message;
			if (messageId != null && messageId !== "@original" && !entry.messageIds.has(messageId)) {
				throw new Error("Reply message is not owned by this interaction");
			}
			const modalKey = action === "showModal" && payload?.custom_id
				? `${interaction.guildId || ""}:${interaction.user?.id}:${payload.custom_id}` : null;
			const previousModal = this.modalOwners.get(modalKey);
			if (modalKey) {
				const owner = this.interactions.get(previousModal);
				if (owner && owner.expiresAt > Date.now() && owner.pluginId !== pluginId) {
					throw new Error("Modal custom ID is already owned by another plugin; use a unique ID");
				}
				// Reserve before awaiting Discord so concurrent plugins cannot race
				// to claim the same user's pending modal.
				this.modalOwners.set(modalKey, entry.handle);
				entry.modalKeys.add(modalKey);
			}
			let result;
			try {
				result = await interaction[action](payload);
			} catch (error) {
				if (modalKey && this.modalOwners.get(modalKey) === entry.handle) {
					if (this.interactions.has(previousModal)) this.modalOwners.set(modalKey, previousModal);
					else this.modalOwners.delete(modalKey);
				}
				throw error;
			}
			if (this.interactions.get(entry.handle) !== entry) throw new Error("Interaction expired during execution");
			const message = result?.resource?.message || result;
			if (message?.id) {
				entry.messageIds.add(message.id);
				this.messageOwners.set(message.id, entry.handle);
			}
			return {
				result: serializeValue(result, DISCORD_PRIVATE_KEYS),
				state: {
					deferred: !!interaction.deferred,
					replied: !!interaction.replied,
					ephemeral: interaction.ephemeral ?? null,
					responded: !!interaction.responded,
				},
			};
		});
		entry.queue = run.catch(() => {});
		return run;
	}

	_messagePayload(payload) {
		if (typeof payload === "string") return { content: payload };
		const result = { ...payload };
		if (result.files) {
			result.files = result.files.map((file) => {
				let bytes = file?.attachment ?? file?.data ?? file;
				if (bytes?.type === "Buffer") bytes = bytes.data;
				if (Array.isArray(bytes) && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) bytes = Buffer.from(bytes);
				if (ArrayBuffer.isView(bytes)) bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
				if (bytes instanceof ArrayBuffer) bytes = Buffer.from(bytes);
				// Passing a path or URL here would let discord.js read/fetch on the
				// host with the Core's authority. Workers must supply upload bytes.
				if (!Buffer.isBuffer(bytes)) throw new Error("File attachments must contain bytes, not host paths or URLs");
				return { attachment: bytes, name: file.name || "attachment.bin", ...(file.description ? { description: file.description } : {}) };
			});
		}
		return result;
	}

	// ── Capability Checking ──────────────────────────────────────────────

	/**
	 * Check if a plugin has a specific capability.
	 */
	hasCapability(pluginId, requiredCap) {
		const caps = this.pluginCapabilities.get(pluginId);
		if (!caps || typeof caps !== "object") return false;

		const colonIdx = requiredCap.indexOf(":");
		if (colonIdx === -1) return false;

		const category = requiredCap.slice(0, colonIdx);
		const value = requiredCap.slice(colonIdx + 1);

		const pluginCategoryCaps = caps[category];
		if (!Array.isArray(pluginCategoryCaps)) return false;

		if (pluginCategoryCaps.includes("*")) return true;
		return pluginCategoryCaps.includes(value);
	}

	// ── Violation Recording ──────────────────────────────────────────────

	/**
	 * Record a violation attempt against a plugin and re-emit an event the
	 * WorkerManager / admin layer can act on. If this crosses the suspension
	 * threshold, a "plugin:suspended" event fires so callers can notify server
	 * owners and stop dispatching events to it.
	 * @private
	 */
	_recordViolation(pluginId, detail) {
		const pluginName = this.pluginNames.get(pluginId) || pluginId;
		const { record, suspended } = this.violations.record(pluginId, detail);
		this.emit("plugin:violation", { ...record, pluginName });
		if (suspended) {
			this.stats.suspended++;
			this.logger.error(
				`SUSPENDED: ${pluginName} — ${this.violations.getSuspension(pluginId).reason}`,
			);
			this.emit("plugin:suspended", { pluginId, pluginName, ...this.violations.getSuspension(pluginId) });
		}
		return suspended;
	}

	/**
	 * Check whether a URL's host is in the plugin's network.outbound allowlist.
	 * Matches exact host or a subdomain of an allowlisted host (api.x.com allows
	 * v2.api.x.com). Returns { ok, host, reason }.
	 * @private
	 */
	_checkNetworkAllowed(pluginId, rawUrl) {
		let url;
		try {
			url = new URL(rawUrl);
		} catch {
			return { ok: false, host: null, reason: `Invalid URL: ${String(rawUrl).slice(0, 120)}` };
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return { ok: false, host: url.host, reason: `Unsupported protocol: ${url.protocol}` };
		}
		const host = url.hostname.toLowerCase();
		const allow = this.networkAllowlists.get(pluginId) || [];
		const allowed = allow.some((entry) => {
			const e = String(entry).toLowerCase();
			return host === e || host.endsWith(`.${e}`);
		});
		if (!allowed) {
			return { ok: false, host, reason: `Host "${host}" is not in the plugin's network allowlist` };
		}
		return { ok: true, host, reason: null };
	}

	// ── Request Handling ─────────────────────────────────────────────────

	/**
	 * Handle an RPC request from a plugin worker.
	 */
	async handleRequest(pluginId, request) {
		const { id, method, params } = request;
		const guildId = params && (params.guildId || (params.args && params.args[0])) || null;
		this.stats.requests++;

		// A suspended plugin's calls are refused before anything executes — the
		// blast radius stays closed until an admin reviews and reinstates it.
		if (this.violations.isSuspended(pluginId)) {
			this.stats.denied++;
			return {
				id,
				ok: false,
				error: "Plugin is suspended pending review after repeated capability violations.",
			};
		}

		if (!isValidMethod(method)) {
			this.stats.denied++;
			this._recordViolation(pluginId, {
				kind: KIND.UNKNOWN_METHOD,
				method,
				message: `Called unknown RPC method "${method}"`,
				guildId,
			});
			return { id, ok: false, error: `Unknown RPC method: "${method}"` };
		}

		const methodDef = getMethodDef(method);

		if (!this.hasCapability(pluginId, methodDef.capability)) {
			this.stats.denied++;
			const pluginName = this.pluginNames.get(pluginId) || pluginId;
			this.logger.warn(
				`DENIED: ${pluginName} called ${method} — missing capability ${methodDef.capability}`,
			);
			this._recordViolation(pluginId, {
				kind: KIND.CAPABILITY,
				method,
				message: `Called ${method} without capability ${methodDef.capability}`,
				guildId,
			});
			return {
				id,
				ok: false,
				error: `Missing capability: ${methodDef.capability}. Add "${methodDef.capability.split(":")[0]}": ["${methodDef.capability.split(":")[1]}"] to your plugin.json capabilities.`,
			};
		}

		const startTime = Date.now();
		try {
			const result = await this.execute(methodDef.handler, params, pluginId);
			const duration = Date.now() - startTime;
			metricsCollector.recordCall(pluginId, method, duration, true);
			return { id, ok: true, result };
		} catch (error) {
			const duration = Date.now() - startTime;
			this.stats.errors++;
			metricsCollector.recordCall(pluginId, method, duration, false, error.message);
			const pluginName = this.pluginNames.get(pluginId) || pluginId;
			this.logger.error(`RPC error in ${pluginName}.${method}:`, error.message);
			return { id, ok: false, error: error.message };
		}
	}

	// ── Handler Execution ────────────────────────────────────────────────

	/**
	 * Execute the actual handler. This runs in the Core process
	 * with full access to the database and Discord client.
	 *
	 * All handlers receive `p` — resolved named params. When workers
	 * send { args: [...] }, _resolveArgs maps them to named params.
	 * When callers send named params directly, `p === params`.
	 */
	async execute(handler, params = {}, pluginId) {
		if (handler.startsWith("interaction.") && Object.hasOwn(INTERACTION_METHODS, handler.slice(12))) {
			return this._interactionAction(pluginId, handler.slice(12), params);
		}
		const p = serializeValue(params.args ? this._resolveArgs(handler, params.args) : params);

		switch (handler) {
			// ── Plugin Config ──────────────────────────────────────────
			case "getPluginConfig":
				return this._serialize(
					await this.db.getPluginConfig(p.guildId, pluginId),
				);

			case "updatePluginConfig":
				return this._serialize(
					await this.db.updatePluginConfig(p.guildId, pluginId, p.data),
				);

			case "getAllPluginConfigs":
				return this._serialize(
					await this.db.getAllPluginConfigs(p.guildId),
				);

			// ── User Profiles (read) ──────────────────────────────────
			case "getUserProfile":
				return this._serialize(
					await this.db.getUserProfile(p.userId, p.guildId),
				);

			case "getTopUsers":
				return this._serialize(
					await this.db.getTopUsers(p.guildId, p.limit || 10, p.type || "totalXp"),
				);

			case "getUserRank":
				return this._serialize(
					await this.db.getUserRank(p.userId, p.guildId, p.type || "totalXp"),
				);

			case "checkRoleRewards":
				return this._serialize(
					await this.db.checkRoleRewards(p.userId, p.guildId),
				);

			case "getServerConfig":
				return this._serialize(
					await this.db.getServerConfig(p.guildId),
				);

			case "getServerStats":
				return this._serialize(
					await this.db.getServerStats(p.guildId),
				);

			case "getUserPoints":
				return this._serialize(
					await this.db.getUserPoints(p.userId, p.guildId),
				);

			case "getPointsLeaderboard":
				return this._serialize(
					await this.db.getPointsLeaderboard(p.guildId, p.limit || 10, p.skip || 0),
				);

			// ── User Profiles (write) ─────────────────────────────────
			case "updateUserProfile":
				return this._serialize(
					await this.db.updateUserProfile(p.userId, p.guildId, p.data),
				);

			case "addXP":
				return this._serialize(
					await this.db.addXP(p.userId, p.guildId, p.amount, p.type || "bonus", p.reason || null),
				);

			case "updateUserRoles":
				return this._serialize(
					await this.db.updateUserRoles(p.userId, p.guildId, p.newRoles),
				);

			case "givePoints":
				return this._serialize(
					await this.db.givePoints(p.fromUserId, p.toUserId, p.guildId, p.amount, p.reason),
				);

			case "updateServerConfig":
				return this._serialize(
					await this.db.updateServerConfig(p.guildId, p.data),
				);

			// ── Tickets ───────────────────────────────────────────────
			case "createTicket":
				return this._serialize(
					await this.db.createTicket(p.ticketData),
				);

			case "getTickets":
				return this._serialize(
					await this.db.getTickets(p.guildId, p.status || null),
				);

			case "getTicketById":
				return this._serialize(
					await this.db.getTicketById(p.ticketId),
				);

			case "updateTicket":
				return this._serialize(
					await this.db.updateTicket(p.ticketId, p.data),
				);

			case "updateTicketStatus":
				return this._serialize(
					await this.db.updateTicketStatus(p.ticketId, p.status, p.moderatorId || null),
				);

			// ── Discord Actions ───────────────────────────────────────
			case "discordSendMessage": {
				const channel = await this.client.channels.fetch(p.channelId);
				if (!channel) throw new Error(`Channel not found: ${p.channelId}`);
				const msg = await channel.send(p.content);
				return { messageId: msg.id };
			}

			case "discordSendRichMessage": {
				const richChannel = await this.client.channels.fetch(p.channelId);
				if (!richChannel) throw new Error(`Channel not found: ${p.channelId}`);
				const { channelId, ...payload } = p;
				const sendPayload = this._messagePayload(payload);
				const richMsg = await richChannel.send(sendPayload);
				return { messageId: richMsg.id };
			}

			case "discordSendDM": {
				const dmUser = await this.client.users.fetch(p.userId);
				if (!dmUser) throw new Error(`User not found: ${p.userId}`);
				const { userId, ...payload } = p;
				const dmPayload = this._messagePayload(payload);
				const dmMsg = await dmUser.send(dmPayload);
				return { messageId: dmMsg.id };
			}

			case "discordSendEmbed": {
				const channel = await this.client.channels.fetch(p.channelId);
				if (!channel) throw new Error(`Channel not found: ${p.channelId}`);
				const { EmbedBuilder } = require("discord.js");
				const embed = new EmbedBuilder(p.embed);
				const msg = await channel.send({ embeds: [embed] });
				return { messageId: msg.id };
			}

			case "discordAddReaction": {
				const channel = await this.client.channels.fetch(p.channelId);
				if (!channel) throw new Error(`Channel not found: ${p.channelId}`);
				const message = await channel.messages.fetch(p.messageId);
				await message.react(p.emoji);
				return { ok: true };
			}

			case "discordDeleteMessage": {
				const channel = await this.client.channels.fetch(p.channelId);
				if (!channel) throw new Error(`Channel not found: ${p.channelId}`);
				const message = await channel.messages.fetch(p.messageId);
				await message.delete();
				return { ok: true };
			}

			case "discordTimeout": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				const member = await guild.members.fetch(p.userId);
				await member.timeout(p.durationMs, p.reason || "Plugin action");
				return { ok: true };
			}

			case "discordKick": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				const member = await guild.members.fetch(p.userId);
				await member.kick(p.reason || "Plugin action");
				return { ok: true };
			}

			case "discordBan": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				// Ban by user ID so users who already left can still be banned.
				const days = Math.min(Math.max(Number(p.deleteMessageDays) || 0, 0), 7);
				await guild.members.ban(p.userId, {
					reason: p.reason || "Plugin action",
					deleteMessageSeconds: days * 86400,
				});
				return { ok: true };
			}

			case "discordUnban": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				await guild.members.unban(p.userId, p.reason || "Plugin action");
				return { ok: true };
			}

			case "discordEditMessage": {
				const channel = await this.client.channels.fetch(p.channelId);
				if (!channel) throw new Error(`Channel not found: ${p.channelId}`);
				const message = await channel.messages.fetch(p.messageId);
				if (message.author?.id !== this.client.user?.id) {
					throw new Error("Only messages sent by the bot can be edited");
				}
				const { channelId, messageId, ...payload } = p;
				await message.edit(this._messagePayload(payload));
				return { ok: true, messageId: message.id };
			}

			case "discordGetMessage": {
				const channel = await this.client.channels.fetch(p.channelId);
				if (!channel) throw new Error(`Channel not found: ${p.channelId}`);
				const message = await channel.messages.fetch(p.messageId);
				return serializeValue({
					id: message.id,
					channelId: message.channelId,
					guildId: message.guildId,
					content: message.content,
					author: message.author && { id: message.author.id, username: message.author.username, bot: message.author.bot },
					createdTimestamp: message.createdTimestamp,
					editedTimestamp: message.editedTimestamp,
					attachments: [...message.attachments.values()].map((a) => ({
						id: a.id, name: a.name, url: a.url, contentType: a.contentType, size: a.size,
					})),
					embeds: message.embeds.map((embed) => embed.toJSON()),
					components: message.components.map((row) => row.toJSON()),
					reactions: [...message.reactions.cache.values()].map((r) => ({
						emoji: r.emoji.id || r.emoji.name, name: r.emoji.name, count: r.count, me: r.me,
					})),
				});
			}

			case "discordCreateChannel": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				const channel = await guild.channels.create({
					...this._channelFields(p),
					name: p.name,
					reason: p.reason || "Plugin action",
				});
				return { id: channel.id, name: channel.name, type: channel.type, guildId: channel.guildId, parentId: channel.parentId };
			}

			case "discordEditChannel": {
				const channel = await this._guildChannel(p.channelId);
				await channel.edit({ ...this._channelFields(p), reason: p.reason || "Plugin action" });
				return { ok: true };
			}

			case "discordDeleteChannel": {
				const channel = await this._guildChannel(p.channelId);
				await channel.delete(p.reason || "Plugin action");
				return { ok: true };
			}

			case "discordSetPermissionOverwrite": {
				const channel = await this._guildChannel(p.channelId);
				// null overwrites removes the overwrite entirely (e.g. unlock).
				if (p.overwrites === null) await channel.permissionOverwrites.delete(p.targetId, p.reason || "Plugin action");
				else await channel.permissionOverwrites.edit(p.targetId, p.overwrites || {}, { reason: p.reason || "Plugin action" });
				return { ok: true };
			}

			case "discordSendViaWebhook": {
				const channel = await this._guildChannel(p.channelId);
				// The webhook token never crosses the RPC boundary: Core reuses or
				// creates a bot-owned webhook and sends on the plugin's behalf.
				const hooks = await channel.fetchWebhooks();
				const webhook = hooks.find((hook) => hook.owner?.id === this.client.user?.id && hook.token)
					|| await channel.createWebhook({ name: "ADB", reason: "Plugin webhook delivery" });
				const { channelId, ...payload } = p;
				const sent = await webhook.send(this._messagePayload(payload));
				return { messageId: sent.id };
			}

			case "discordFetchInvites": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				const invites = await guild.invites.fetch();
				return [...invites.values()].map((invite) => ({
					code: invite.code,
					uses: invite.uses,
					maxUses: invite.maxUses,
					inviterId: invite.inviterId || invite.inviter?.id || null,
					channelId: invite.channelId || invite.channel?.id || null,
					temporary: invite.temporary,
					createdTimestamp: invite.createdTimestamp,
					expiresTimestamp: invite.expiresTimestamp,
				}));
			}

			case "discordGetRoles": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				const roles = await guild.roles.fetch();
				return [...roles.values()].map((role) => ({
					id: role.id,
					name: role.name,
					color: role.color,
					position: role.position,
					managed: role.managed,
					hoist: role.hoist,
					mentionable: role.mentionable,
					permissions: role.permissions.bitfield.toString(),
				}));
			}

			// ── Hook Actions ──────────────────────────────────────────
			case "hooksEmit":
				await this.hooks.emitHook(p.hookName, p.payload || {});
				return { ok: true };

			case "hooksOn": {
				if (!this._hookSubscriptions) this._hookSubscriptions = new Map();
				const key = `${pluginId}:${p.eventName}`;
				if (!this._hookSubscriptions.has(key)) {
					const unsub = this.hooks.on(p.eventName, async (payload) => {
						this.emit("hook:forward", { pluginId, eventName: p.eventName, payload: serializeValue(payload, DISCORD_PRIVATE_KEYS) });
					});
					this._hookSubscriptions.set(key, unsub);
				}
				return { ok: true, subscribed: true };
			}

			// ── Plugin-Scoped Model CRUD ───────────────────────────────
			case "modelFind":
				return this._serialize(
					await this._applyQueryOptions(
						this._getModel(pluginId, p.modelName).find(p.query || {}),
						p.options,
					),
				);

			case "modelFindOne":
				return this._serialize(
					await this._applyQueryOptions(
						this._getModel(pluginId, p.modelName).findOne(p.query || {}),
						p.options,
					),
				);

			case "modelCreate":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).create(p.data),
				);

			case "modelUpdateOne":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).updateOne(p.query || {}, p.update || {}),
				);

			case "modelUpdateMany": {
				const res = await this._getModel(pluginId, p.modelName).updateMany(p.query || {}, p.update || {});
				return this._serialize({ acknowledged: res.acknowledged, modifiedCount: res.modifiedCount, matchedCount: res.matchedCount });
			}

			case "modelFindOneAndUpdate":
				return this._serialize(
					await this._applyQueryOptions(
						this._getModel(pluginId, p.modelName).findOneAndUpdate(p.query || {}, p.update || {}, p.options || {}),
						p.options,
					),
				);

			case "modelDeleteOne":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).deleteOne(p.query || {}),
				);

			case "modelDeleteMany": {
				const res = await this._getModel(pluginId, p.modelName).deleteMany(p.query || {});
				return this._serialize({ acknowledged: res.acknowledged, deletedCount: res.deletedCount });
			}

			case "modelCountDocuments":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).countDocuments(p.query || {}),
				);

			case "modelSave": {
				const Model = this._getModel(pluginId, p.modelName);
				const doc = await Model.findOne({ _id: p.docId });
				if (!doc) throw new Error(`Document not found: ${p.docId}`);
				if (p.changes) doc.set(p.changes);
				if (p.markModifiedField) doc.markModified(p.markModifiedField);
				for (const field of p.markModifiedFields || []) doc.markModified(field);
				await doc.save();
				return this._serialize(doc);
			}

			case "modelMarkModified": {
				const Model2 = this._getModel(pluginId, p.modelName);
				const doc2 = await Model2.findOne({ _id: p.docId });
				if (!doc2) throw new Error(`Document not found: ${p.docId}`);
				doc2.markModified(p.field);
				await doc2.save();
				return { ok: true };
			}

			// ── Discord Lookups ─────────────────────────────────────────
			case "discordGetGuild": {
				const guild = await this.client.guilds.fetch(p.guildId);
				if (!guild) throw new Error(`Guild not found: ${p.guildId}`);
				const iconFormat = p.iconFormat || "png";
				const iconSize = p.iconSize || 128;
				return {
					id: guild.id,
					name: guild.name,
					memberCount: guild.memberCount,
					icon: guild.icon,
					iconURL: guild.iconURL({ extension: iconFormat, size: iconSize }) || null,
				};
			}

			case "discordGetMember": {
				const g = await this.client.guilds.fetch(p.guildId);
				if (!g) throw new Error(`Guild not found: ${p.guildId}`);
				const member = await g.members.fetch(p.userId);
				if (!member) throw new Error(`Member not found: ${p.userId}`);
				const avFormat = p.avatarFormat || "png";
				const avSize = p.avatarSize || 256;
				return {
					id: member.id,
					guildId: g.id,
					user: {
						id: member.user.id,
						tag: member.user.tag,
						username: member.user.username,
						bot: member.user.bot,
						avatarURL: member.user.displayAvatarURL({ extension: avFormat, size: avSize }) || null,
					},
					nickname: member.nickname,
					roles: Array.from(member.roles.cache.keys()),
					joinedAt: member.joinedAt,
				};
			}

			case "discordFetchChannel": {
				const channel = await this.client.channels.fetch(p.channelId);
				if (!channel) throw new Error(`Channel not found: ${p.channelId}`);
				return {
					id: channel.id,
					name: channel.name,
					type: channel.type,
					guildId: channel.guildId,
				};
			}

			case "discordAddRole": {
				const g2 = await this.client.guilds.fetch(p.guildId);
				if (!g2) throw new Error(`Guild not found: ${p.guildId}`);
				const m = await g2.members.fetch(p.userId);
				if (!m) throw new Error(`Member not found: ${p.userId}`);
				await m.roles.add(p.roleId, p.reason || "Plugin action");
				return { ok: true };
			}

			case "discordRemoveRole": {
				const g3 = await this.client.guilds.fetch(p.guildId);
				if (!g3) throw new Error(`Guild not found: ${p.guildId}`);
				const m2 = await g3.members.fetch(p.userId);
				if (!m2) throw new Error(`Member not found: ${p.userId}`);
				await m2.roles.remove(p.roleId, p.reason || "Plugin action");
				return { ok: true };
			}

			// ── Scheduler ───────────────────────────────────────────────
			case "schedulerSchedule": {
				if (!this._scheduledTasks) this._scheduledTasks = new Map();
				const cron = require("node-cron");
				const taskId = `${pluginId}_${randomUUID()}`;
				const task = cron.schedule(p.expression, async () => {
					this.emit("cron:tick", { pluginId, taskId, name: p.name || taskId });
				});
				this._scheduledTasks.set(taskId, { pluginId, task });
				return { ok: true, taskId };
			}

			case "schedulerCancel": {
				if (this._scheduledTasks) {
					const entry = this._scheduledTasks.get(p.taskId);
					if (entry && entry.pluginId === pluginId) {
						entry.task.stop();
						this._scheduledTasks.delete(p.taskId);
					}
				}
				return { ok: true };
			}

			// ── Network ─────────────────────────────────────────────────
			case "networkFetch":
				return await this._networkFetch(pluginId, p);

			// ── AI ──────────────────────────────────────────────────────
			case "aiGenerate":
				return await this._aiGenerate(pluginId, p);

			default:
				throw new Error(`Handler not implemented: ${handler}`);
		}
	}

	// ── Network ────────────────────────────────────────────────────────────

	/**
	 * Perform an outbound HTTP(S) request on behalf of a plugin, but only to a
	 * host in its network.outbound allowlist. A request to any other host is
	 * refused and recorded as a violation — this is the per-host enforcement the
	 * coarse process-level --allow-net flag cannot provide.
	 *
	 * @param {string} pluginId
	 * @param {object} p - { url, method?, headers?, body? }
	 * @private
	 */
	async _networkFetch(pluginId, p) {
		const check = this._checkNetworkAllowed(pluginId, p.url);
		if (!check.ok) {
			this._recordViolation(pluginId, {
				kind: KIND.NETWORK,
				method: "network.fetch",
				message: check.reason,
			});
			throw new Error(`Network request denied: ${check.reason}`);
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
		try {
			const res = await fetch(p.url, {
				method: p.method || "GET",
				headers: p.headers || {},
				body: p.body,
				redirect: "manual", // a 3xx to a non-allowlisted host must not silently follow
				signal: controller.signal,
			});

			// Read the body with a hard byte ceiling so a plugin can't pull an
			// unbounded response back across the RPC boundary.
			const buf = Buffer.from(await res.arrayBuffer());
			if (buf.length > NETWORK_MAX_BODY_BYTES) {
				throw new Error(`Response body exceeds ${NETWORK_MAX_BODY_BYTES} bytes`);
			}
			const headers = {};
			for (const [k, v] of res.headers) headers[k] = v;
			return {
				status: res.status,
				ok: res.ok,
				headers,
				body: buf.toString("utf8"),
			};
		} catch (err) {
			if (err.name === "AbortError") {
				throw new Error(`Network request timed out after ${NETWORK_TIMEOUT_MS}ms`);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}

	// ── AI ────────────────────────────────────────────────────────────────

	/**
	 * Generate a Gemini response for a guild member. Two limits protect the one
	 * shared GEMINI_API_KEY:
	 *   - per-user cooldown: `ai_user_cooldown_seconds` from the calling plugin's
	 *     guild settings (dashboard-editable; default 10s, 0 disables), so one
	 *     member can't drain the quota for everyone else;
	 *   - per-guild window: AI_GUILD_MAX_PER_MINUTE across all plugins, the outer
	 *     safety net.
	 * A limited call resolves `{ text: null, limited, retryAfterMs }` instead of
	 * throwing, so the plugin can tell the user how long to wait.
	 *
	 * @param {string} pluginId
	 * @param {object} p - { guildId, userId, prompt, systemInstruction? }
	 * @private
	 */
	async _aiGenerate(pluginId, p) {
		for (const key of ["guildId", "userId", "prompt"]) {
			if (typeof p[key] !== "string" || !p[key]) throw new Error(`ai.generate requires a non-empty string "${key}"`);
		}
		if (p.prompt.length > AI_MAX_PROMPT_CHARS || (p.systemInstruction && String(p.systemInstruction).length > AI_MAX_PROMPT_CHARS)) {
			throw new Error(`ai.generate prompt exceeds ${AI_MAX_PROMPT_CHARS} characters`);
		}
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) throw new Error("AI is not configured on this bot (GEMINI_API_KEY is not set)");

		const config = await this.db.getPluginConfig(p.guildId, pluginId);
		const configured = config?.data?.ai_user_cooldown_seconds;
		const cooldownMs = (Number.isFinite(configured) && configured >= 0 ? configured : AI_DEFAULT_USER_COOLDOWN_S) * 1000;

		// Re-read the clock after the config await so concurrent calls from the
		// same user see each other's reservation below.
		const now = Date.now();
		const userKey = `${p.guildId}:${p.userId}`;
		const last = this.aiUserLastCall.get(userKey);
		if (cooldownMs > 0 && last !== undefined && now - last < cooldownMs) {
			return { text: null, limited: "user", retryAfterMs: cooldownMs - (now - last) };
		}
		const recent = (this.aiGuildCalls.get(p.guildId) || []).filter((t) => now - t < 60_000);
		if (recent.length >= AI_GUILD_MAX_PER_MINUTE) {
			this.aiGuildCalls.set(p.guildId, recent);
			return { text: null, limited: "guild", retryAfterMs: 60_000 - (now - recent[0]) };
		}
		// Reserve before the API call: a spammer's parallel messages must not all
		// pass the check while the first request is still in flight.
		// ponytail: in-memory, per-process; resets on restart, which is fine for a cooldown.
		this.aiUserLastCall.set(userKey, now);
		recent.push(now);
		this.aiGuildCalls.set(p.guildId, recent);

		if (!this._genai) {
			const { GoogleGenAI } = require("@google/genai");
			this._genai = new GoogleGenAI({ apiKey });
		}
		let timer;
		try {
			const response = await Promise.race([
				this._genai.models.generateContent({
					model: process.env.GEMINI_MODEL || AI_DEFAULT_MODEL,
					contents: p.prompt,
					...(p.systemInstruction ? { config: { systemInstruction: String(p.systemInstruction) } } : {}),
				}),
				new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`AI request timed out after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS); }),
			]);
			return { text: response.text ?? "" };
		} finally {
			clearTimeout(timer);
		}
	}

	// ── Helpers ──────────────────────────────────────────────────────────

	/** Fetch a guild channel; refuses DMs so channel-management RPCs stay guild-scoped. @private */
	async _guildChannel(channelId) {
		const channel = await this.client.channels.fetch(channelId);
		if (!channel?.guild) throw new Error(`Guild channel not found: ${channelId}`);
		return channel;
	}

	/** Whitelisted channel fields for create/edit — never pass a worker object straight to discord.js. @private */
	_channelFields(p) {
		const fields = {};
		for (const key of ["name", "type", "topic", "parent", "nsfw", "rateLimitPerUser", "position", "permissionOverwrites", "bitrate", "userLimit"]) {
			if (p[key] !== undefined) fields[key] = p[key];
		}
		return fields;
	}

	/**
	 * Resolve positional args from worker RPC into named params.
	 * Workers send { args: [arg0, arg1, ...] } — this maps them to
	 * the named param objects that handlers expect.
	 *
	 * @param {string} handler - Handler name
	 * @param {Array} args     - Positional args from the worker
	 * @returns {object} Named params
	 */
	_resolveArgs(handler, args) {
		switch (handler) {
			// DB — Plugin Config
			case "getPluginConfig":       return { guildId: args[0] };
			case "updatePluginConfig":    return { guildId: args[0], data: args[1] };
			case "getAllPluginConfigs":    return { guildId: args[0] };

			// DB — User Profiles
			case "getUserProfile":        return { userId: args[0], guildId: args[1] };
			case "updateUserProfile":     return { userId: args[0], guildId: args[1], data: args[2] };
			case "addXP":                 return { userId: args[0], guildId: args[1], amount: args[2], type: args[3], reason: args[4] };
			case "getTopUsers":           return { guildId: args[0], limit: args[1], type: args[2] };
			case "getUserRank":           return { userId: args[0], guildId: args[1], type: args[2] };
			case "checkRoleRewards":      return { userId: args[0], guildId: args[1] };
			case "updateUserRoles":       return { userId: args[0], guildId: args[1], newRoles: args[2] };
			case "getServerConfig":       return { guildId: args[0] };
			case "updateServerConfig":    return { guildId: args[0], data: args[1] };
			case "getServerStats":        return { guildId: args[0] };
			case "getUserPoints":         return { userId: args[0], guildId: args[1] };
			case "getPointsLeaderboard":  return { guildId: args[0], limit: args[1], skip: args[2] };
			case "givePoints":            return { fromUserId: args[0], toUserId: args[1], guildId: args[2], amount: args[3], reason: args[4] };

			// DB — Tickets
			case "createTicket":          return { ticketData: args[0] };
			case "getTickets":            return { guildId: args[0], status: args[1] };
			case "getTicketById":         return { ticketId: args[0] };
			case "updateTicket":          return { ticketId: args[0], data: args[1] };
			case "updateTicketStatus":    return { ticketId: args[0], status: args[1], moderatorId: args[2] };

			// Discord — Actions
			case "discordSendMessage":    return { channelId: args[0], content: args[1] };
			case "discordSendRichMessage": return { channelId: args[0], content: args[1], embeds: args[2] || [], files: args[3] || [] };
			case "discordSendDM":         return { userId: args[0], content: args[1], embeds: args[2] || [], files: args[3] || [] };
			case "discordSendEmbed":      return { channelId: args[0], embed: args[1] };
			case "discordAddReaction":    return { channelId: args[0], messageId: args[1], emoji: args[2] };
			case "discordDeleteMessage":  return { channelId: args[0], messageId: args[1] };
			case "discordTimeout":        return { guildId: args[0], userId: args[1], durationMs: args[2], reason: args[3] };
			case "discordKick":           return { guildId: args[0], userId: args[1], reason: args[2] };
			case "discordBan":            return { guildId: args[0], userId: args[1], reason: args[2] };

			// Discord — Lookups
			case "discordGetGuild":       return { guildId: args[0], iconFormat: args[1], iconSize: args[2] };
			case "discordGetMember":      return { guildId: args[0], userId: args[1], avatarFormat: args[2], avatarSize: args[3] };
			case "discordFetchChannel":   return { channelId: args[0] };
			case "discordAddRole":        return { guildId: args[0], userId: args[1], roleId: args[2], reason: args[3] };
			case "discordRemoveRole":     return { guildId: args[0], userId: args[1], roleId: args[2], reason: args[3] };

			// Hooks
			case "hooksEmit":             return { hookName: args[0], payload: args[1] };
			case "hooksOn":               return { eventName: args[0] };

			// Model CRUD
			case "modelFind":             return { modelName: args[0], query: args[1] };
			case "modelFindOne":          return { modelName: args[0], query: args[1] };
			case "modelCreate":           return { modelName: args[0], data: args[1] };
			case "modelUpdateOne":        return { modelName: args[0], query: args[1], update: args[2] };
			case "modelDeleteOne":        return { modelName: args[0], query: args[1] };
			case "modelCountDocuments":   return { modelName: args[0], query: args[1] };
			case "modelSave":             return { modelName: args[0], docId: args[1], changes: args[2], markModifiedField: args[3] };
			case "modelMarkModified":     return { modelName: args[0], docId: args[1], field: args[2] };

			// Scheduler
			case "schedulerSchedule":     return { expression: args[0], name: args[1] };
			case "schedulerCancel":       return { taskId: args[0] };

			// Network — { url, options } where options carries method/headers/body
			case "networkFetch":          return { url: args[0], ...(args[1] || {}) };

			// Fallback: unknown handler — fail loud so missing mappings are caught at call time
			default:
				throw new Error(`_resolveArgs: no mapping for handler "${handler}" — add it to _resolveArgs`);
		}
	}

	/**
	 * Serialize a Mongoose document or plain object for IPC transfer.
	 */
	_serialize(value) {
		return serializeValue(value);
	}

	getStats() {
		return { ...this.stats };
	}

	// ── Violation / Suspension Introspection ─────────────────────────────

	/** Whether a plugin is currently suspended. */
	isSuspended(pluginId) {
		return this.violations.isSuspended(pluginId);
	}

	/** Recent violation records for a plugin (newest last). */
	getViolations(pluginId) {
		return this.violations.getViolations(pluginId);
	}

	/** Suspension record for a plugin, or null. */
	getSuspension(pluginId) {
		return this.violations.getSuspension(pluginId);
	}

	/** Cross-plugin violation summary for the admin view. */
	getViolationSummary() {
		return this.violations.summary();
	}

	/**
	 * Lift a plugin's suspension after admin review. Emits "plugin:reinstated"
	 * so the WorkerManager can resume dispatching events to it.
	 */
	reinstate(pluginId) {
		const lifted = this.violations.reinstate(pluginId);
		if (lifted) {
			const pluginName = this.pluginNames.get(pluginId) || pluginId;
			this.logger.info(`Reinstated ${pluginName} after suspension`);
			this.emit("plugin:reinstated", { pluginId, pluginName });
		}
		return lifted;
	}

	getResourceTracker(pluginId) {
		return this.resourceTrackers.get(pluginId);
	}

	getMetrics() {
		return metricsCollector.getGlobalMetrics();
	}

	getHealth() {
		return metricsCollector.getHealthSummary();
	}

	// ── Model Registry ──────────────────────────────────────────────────

	registerModel(pluginId, modelName, schema) {
		if (typeof modelName !== "string" || !modelName || !schema) throw new Error("Invalid model definition");
		if (!this._modelRegistry) this._modelRegistry = new Map();
		const mongoose = require("mongoose");
		const { rehydrateSchema } = require("./schema-serialize");
		const prefixedName = `plugin_${pluginId}_${modelName}`;
		if (!mongoose.models[prefixedName]) {
			// Isolated plugins send a plain schema descriptor over IPC (a real
			// mongoose.Schema can't be structured-cloned). Rehydrate it here.
			// Direct callers may still pass a real Schema — pass those through.
			const realSchema =
				schema && schema.__adbSchema
					? rehydrateSchema(schema)
					: schema;
			// A worker cannot select a Core or another plugin's collection.
			if (schema.__adbSchema) realSchema.set("collection", undefined);
			mongoose.model(prefixedName, realSchema);
		}
		const key = `${pluginId}:${modelName}`;
		this._modelRegistry.set(key, mongoose.models[prefixedName]);
	}

	_getModel(pluginId, modelName) {
		if (!this._modelRegistry) throw new Error("Model registry not initialized");
		const key = `${pluginId}:${modelName}`;
		const model = this._modelRegistry.get(key);
		if (!model) throw new Error(`Model '${modelName}' not registered for plugin '${pluginId}'`);
		return model;
	}

	/**
	 * Apply chained query options (.sort/.limit/.skip/.lean equivalents) sent
	 * from a worker's model proxy, then execute.
	 * @private
	 */
	async _applyQueryOptions(query, options = {}) {
		if (options.select) query = query.select(options.select);
		if (options.sort) query = query.sort(options.sort);
		if (options.limit != null) query = query.limit(options.limit);
		if (options.skip != null) query = query.skip(options.skip);
		return options.lean ? query.lean() : query;
	}
}

module.exports = { CapabilityBroker };
