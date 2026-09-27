const { PermissionFlagsBits, PermissionsBitField } = require("discord.js");

// 🛡️ Check if user is a moderator
function isModerator(member) {
  if (!member) return false;

  // Check for specific moderation permissions
  const modPermissions = [
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.Administrator,
  ];

	try {
		const permissions = new PermissionsBitField(member.permissions?.bitfield ?? member.permissions ?? 0n);
		return permissions.any(modPermissions);
	} catch {
		return false;
	}
}

// 👑 Check if user is server owner
function isServerOwner(member, guild) {
  if (!member || !guild) return false;
	const id = member.id || member.user?.id;
	return typeof id === "string" && id.length > 0 && id === guild.ownerId;
}

// 🔒 Check if user has specific role names commonly used for moderators
function hasModeratorRole(member, guild) {
  if (!member) return false;

  const modRoleNames = [
    "moderator",
    "mod",
    "admin",
    "administrator",
    "staff",
    "helper",
    "support",
    "team",
  ];

	const roles = Array.isArray(member.roles)
		? member.roles.map((id) => guild?.roles?.cache?.get(id))
		: Array.from(member.roles?.cache?.values() || []);
	return roles.some((role) => typeof role?.name === "string" &&
		modRoleNames.some((modRole) => role.name.toLowerCase().includes(modRole)));
}

// 🎯 Comprehensive moderator check
function isModeratorOrOwner(member, guild) {
  return (
    isServerOwner(member, guild) ||
    isModerator(member) ||
    hasModeratorRole(member, guild)
  );
}

// 🎫 Generate unique ticket ID
function generateTicketId() {
  return Math.random().toString(36).substr(2, 9).toUpperCase();
}

// 🎨 Get priority color
function getPriorityColor(priority, colors) {
  switch (priority.toLowerCase()) {
    case "high":
      return colors.error;
    case "medium":
      return colors.warning;
    case "low":
      return colors.success;
    default:
      return colors.primary;
  }
}

// 📊 Format ticket status
function formatTicketStatus(status) {
  const statusEmojis = {
    open: "🟢 Open",
    in_progress: "🟡 In Progress",
    waiting: "🟠 Waiting for Response",
    closed: "🔴 Closed",
    resolved: "✅ Resolved",
  };

  return statusEmojis[status] || "❓ Unknown";
}

// ⏱️ Format time ago
function timeAgo(date) {
  const now = new Date();
  const diffInMs = now - new Date(date);
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  if (diffInHours < 24) return `${diffInHours}h ago`;
  return `${diffInDays}d ago`;
}

// 📝 Sanitize input for AI
function sanitizeInput(text) {
  if (!text) return "";

  // Remove potential harmful content
  return text
    .replace(/<@!?(\d+)>/g, "[USER_MENTION]") // Remove user mentions
    .replace(/<#(\d+)>/g, "[CHANNEL_MENTION]") // Remove channel mentions
    .replace(/<@&(\d+)>/g, "[ROLE_MENTION]") // Remove role mentions
    .replace(/https?:\/\/[^\s]+/g, "[URL]") // Remove URLs
    .trim()
    .substring(0, 2000); // Limit length
}

// 🤖 Check if message looks like a question
function isQuestion(message) {
  const questionIndicators = [
    "?",
    "how",
    "what",
    "when",
    "where",
    "why",
    "who",
    "which",
    "can",
    "could",
    "would",
    "should",
    "is",
    "are",
    "do",
    "does",
    "help",
    "please",
    "question",
  ];

  const lowerMessage = message.toLowerCase();
  return questionIndicators.some((indicator) =>
    lowerMessage.includes(indicator)
  );
}

// 📊 Parse channel list from string
function parseChannelList(channelString) {
  if (!channelString) return [];

  try {
    return JSON.parse(channelString);
  } catch {
    return channelString
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id);
  }
}

// 🎯 Format channel list for display
function formatChannelList(channels, guild) {
  if (!channels || channels.length === 0) return "None configured";

  return channels
    .map((channelId) => {
      const channel = guild.channels.cache.get(channelId);
      return channel ? `<#${channelId}>` : `Unknown Channel (${channelId})`;
    })
    .join(", ");
}

module.exports = {
  isModerator,
  isServerOwner,
  hasModeratorRole,
  isModeratorOrOwner,
  generateTicketId,
  getPriorityColor,
  formatTicketStatus,
  timeAgo,
  sanitizeInput,
  isQuestion,
  parseChannelList,
  formatChannelList,
};
