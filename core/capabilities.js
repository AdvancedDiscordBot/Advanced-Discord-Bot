/**
 * capabilities.js — Plugin capability schema and validation.
 *
 * Every capability a plugin can request is listed here. At install time the
 * server owner sees this list and approves or rejects. At runtime the broker
 * checks every RPC call against the declared capabilities before executing it.
 *
 * Capability format: "category:value" e.g. "discord:SendMessages", "storage:own-collection"
 */

// ── Schema ────────────────────────────────────────────────────────────────

const CAPABILITY_SCHEMA = {
	discord: {
		valid: [
			"SendMessages",
			"ReadMessageHistory",
			"EmbedLinks",
			"AttachFiles",
			"AddReactions",
			"ManageMessages",
			"ManageRoles",
			"BanMembers",
			"KickMembers",
			"ModerateMembers",
			"ManageChannels",
			"ManageGuild",
			"ManageWebhooks",
			"ViewChannel",
			"ViewAuditLog",
			"MentionEveryone",
		],
		description: "Discord API actions the plugin may perform",
	},
	storage: {
		valid: ["own-collection", "read-profiles", "write-profiles"],
		description: "Database access scope — plugins never get raw Mongo",
	},
	network: {
		valid: ["outbound-http"],
		description: "Outbound network requests (HTTP/HTTPS)",
	},
	ai: {
		valid: ["gemini-proxy"],
		description: "AI model access via the Core proxy (keys never leave Core)",
	},
	hooks: {
		valid: ["subscribe", "emit"],
		description: "Inter-plugin event bus access",
	},
};

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Validate a plugin's declared capabilities against the schema.
 * @param {object} caps - e.g. { discord: ["SendMessages"], storage: ["own-collection"] }
 * @returns {string[]} Array of error messages. Empty if all valid.
 */
function validateCapabilities(caps = {}) {
	const errors = [];

	for (const [category, values] of Object.entries(caps)) {
		if (!CAPABILITY_SCHEMA[category]) {
			errors.push(`Unknown capability category: "${category}"`);
			continue;
		}

		if (!Array.isArray(values)) {
			errors.push(`Capability category "${category}" must be an array, got ${typeof values}`);
			continue;
		}

		for (const value of values) {
			if (typeof value !== "string") {
				errors.push(`Capability value must be a string, got ${typeof value} in "${category}"`);
				continue;
			}
			if (!CAPABILITY_SCHEMA[category].valid.includes(value)) {
				errors.push(
					`Unknown capability: "${category}:${value}". Valid values: ${CAPABILITY_SCHEMA[category].valid.join(", ")}`,
				);
			}
		}
	}

	return errors;
}

/**
 * Check if a plugin has a specific capability.
 * @param {object} pluginCaps - The plugin's declared capabilities object
 * @param {string} requiredCap - "category:value" e.g. "discord:SendMessages"
 * @returns {boolean}
 */
function hasCapability(pluginCaps, requiredCap) {
	if (!pluginCaps || typeof pluginCaps !== "object") return false;

	const colonIdx = requiredCap.indexOf(":");
	if (colonIdx === -1) return false;

	const category = requiredCap.slice(0, colonIdx);
	const value = requiredCap.slice(colonIdx + 1);

	const pluginCategoryCaps = pluginCaps[category];
	if (!Array.isArray(pluginCategoryCaps)) return false;

	// Wildcard: plugin declared "*" for this category
	if (pluginCategoryCaps.includes("*")) return true;

	return pluginCategoryCaps.includes(value);
}

/**
 * Get a human-readable summary of a plugin's capabilities.
 * @param {object} caps
 * @returns {{ category: string, values: string[], description: string }[]}
 */
function describeCapabilities(caps = {}) {
	return Object.entries(caps)
		.filter(([, values]) => Array.isArray(values) && values.length > 0)
		.map(([category, values]) => ({
			category,
			values,
			description: CAPABILITY_SCHEMA[category]?.description || "",
		}));
}

/**
 * Get the default (empty) capabilities object.
 */
function emptyCapabilities() {
	return {};
}

module.exports = {
	CAPABILITY_SCHEMA,
	validateCapabilities,
	hasCapability,
	describeCapabilities,
	emptyCapabilities,
};
