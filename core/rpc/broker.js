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
const { getMethodDef, isValidMethod } = require("./methods");
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
		this.pluginCapabilities.delete(pluginId);
		this.pluginNames.delete(pluginId);
		this.networkAllowlists.delete(pluginId);

		const tracker = this.resourceTrackers.get(pluginId);
		if (tracker) {
			tracker.stop();
			this.resourceTrackers.delete(pluginId);
		}
		metricsCollector.unregisterPlugin(pluginId);
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
	async execute(handler, params, pluginId) {
		const p = params.args ? this._resolveArgs(handler, params.args) : params;

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
				const { EmbedBuilder: RichEmbedBuilder, AttachmentBuilder } = require("discord.js");
				const sendPayload = {};
				if (p.content) sendPayload.content = p.content;
				if (p.embeds && p.embeds.length > 0) {
					sendPayload.embeds = p.embeds.map((e) => new RichEmbedBuilder(e));
				}
				if (p.files && p.files.length > 0) {
					sendPayload.files = p.files.map((f) => {
						if (f.data && f.data.type === "Buffer") {
							return new AttachmentBuilder(Buffer.from(f.data.data), { name: f.name || "attachment.png" });
						}
						if (Buffer.isBuffer(f.data)) {
							return new AttachmentBuilder(f.data, { name: f.name || "attachment.png" });
						}
						if (Array.isArray(f.data)) {
							return new AttachmentBuilder(Buffer.from(f.data), { name: f.name || "attachment.png" });
						}
						return f;
					});
				}
				const richMsg = await richChannel.send(sendPayload);
				return { messageId: richMsg.id };
			}

			case "discordSendDM": {
				const dmUser = await this.client.users.fetch(p.userId);
				if (!dmUser) throw new Error(`User not found: ${p.userId}`);
				const { EmbedBuilder: DmEmbedBuilder, AttachmentBuilder: DmAttachmentBuilder } = require("discord.js");
				const dmPayload = {};
				if (p.content) dmPayload.content = p.content;
				if (p.embeds && p.embeds.length > 0) {
					dmPayload.embeds = p.embeds.map((e) => new DmEmbedBuilder(e));
				}
				if (p.files && p.files.length > 0) {
					dmPayload.files = p.files.map((f) => {
						if (f.data && f.data.type === "Buffer") {
							return new DmAttachmentBuilder(Buffer.from(f.data.data), { name: f.name || "attachment.png" });
						}
						if (Buffer.isBuffer(f.data)) {
							return new DmAttachmentBuilder(f.data, { name: f.name || "attachment.png" });
						}
						if (Array.isArray(f.data)) {
							return new DmAttachmentBuilder(Buffer.from(f.data), { name: f.name || "attachment.png" });
						}
						return f;
					});
				}
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
				const member = await guild.members.fetch(p.userId);
				await member.ban({ reason: p.reason || "Plugin action" });
				return { ok: true };
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
						this.emit("hook:forward", { pluginId, eventName: p.eventName, payload });
					});
					this._hookSubscriptions.set(key, unsub);
				}
				return { ok: true, subscribed: true };
			}

			// ── Plugin-Scoped Model CRUD ───────────────────────────────
			case "modelFind":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).find(p.query || {}),
				);

			case "modelFindOne":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).findOne(p.query || {}),
				);

			case "modelCreate":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).create(p.data),
				);

			case "modelUpdateOne":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).updateOne(p.query || {}, p.update || {}),
				);

			case "modelDeleteOne":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).deleteOne(p.query || {}),
				);

			case "modelCountDocuments":
				return this._serialize(
					await this._getModel(pluginId, p.modelName).countDocuments(p.query || {}),
				);

			case "modelSave": {
				const Model = this._getModel(pluginId, p.modelName);
				const doc = await Model.findOne({ _id: p.docId });
				if (!doc) throw new Error(`Document not found: ${p.docId}`);
				if (p.changes) Object.assign(doc, p.changes);
				if (p.markModifiedField) doc.markModified(p.markModifiedField);
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
				const taskId = `${pluginId}_${p.name || Date.now()}`;
				const task = cron.schedule(p.expression, async () => {
					this.emit("cron:tick", { pluginId, taskId, name: p.name || taskId });
				});
				this._scheduledTasks.set(taskId, task);
				return { ok: true, taskId };
			}

			case "schedulerCancel": {
				if (this._scheduledTasks) {
					const task = this._scheduledTasks.get(p.taskId);
					if (task) {
						task.stop();
						this._scheduledTasks.delete(p.taskId);
					}
				}
				return { ok: true };
			}

			// ── Network ─────────────────────────────────────────────────
			case "networkFetch":
				return await this._networkFetch(pluginId, p);

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

	// ── Helpers ──────────────────────────────────────────────────────────

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
		if (value === null || value === undefined) return value;
		if (typeof value.toObject === "function") return value.toObject();
		if (Array.isArray(value)) return value.map((v) => this._serialize(v));
		return value;
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
		if (!this._modelRegistry) this._modelRegistry = new Map();
		const mongoose = require("mongoose");
		const prefixedName = `plugin_${pluginId}_${modelName}`;
		if (!mongoose.models[prefixedName]) {
			mongoose.model(prefixedName, schema);
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
}

module.exports = { CapabilityBroker };
