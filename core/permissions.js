const { PermissionsBitField } = require("discord.js");

const FLAGS = PermissionsBitField.Flags;

// Human-readable labels for the permissions plugins commonly request.
// Any valid flag not listed here falls back to a spaced-out flag name.
const HUMAN_LABELS = {
  BanMembers: "Ban Members",
  KickMembers: "Kick Members",
  ModerateMembers: "Timeout Members",
  ManageMessages: "Manage Messages",
  ManageChannels: "Manage Channels",
  ManageRoles: "Manage Roles",
  ManageGuild: "Manage Server",
  ManageWebhooks: "Manage Webhooks",
  ManageNicknames: "Manage Nicknames",
  ViewAuditLog: "View Audit Log",
  SendMessages: "Send Messages",
  SendMessagesInThreads: "Send Messages in Threads",
  EmbedLinks: "Embed Links",
  AttachFiles: "Attach Files",
  AddReactions: "Add Reactions",
  ReadMessageHistory: "Read Message History",
  MentionEveryone: "Mention Everyone",
  MuteMembers: "Mute Members (Voice)",
  DeafenMembers: "Deafen Members (Voice)",
  MoveMembers: "Move Members (Voice)",
  ViewChannel: "View Channels",
};

function spaceFlag(flag) {
  return flag.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function validateFlags(flags = []) {
  const valid = [];
  const invalid = [];
  for (const flag of flags) {
    if (Object.prototype.hasOwnProperty.call(FLAGS, flag)) valid.push(flag);
    else invalid.push(flag);
  }
  return { valid, invalid };
}

function describe(flags = []) {
  return validateFlags(flags).valid.map((flag) => ({
    flag,
    label: HUMAN_LABELS[flag] || spaceFlag(flag),
  }));
}

function computePermissionInteger(pluginList = []) {
  const bits = new PermissionsBitField();
  for (const plugin of pluginList) {
    if (plugin.enabled === false) continue;
    const { valid } = validateFlags(plugin.discordPermissions || []);
    for (const flag of valid) bits.add(FLAGS[flag]);
  }
  return bits.bitfield.toString();
}

module.exports = { HUMAN_LABELS, validateFlags, describe, computePermissionInteger };
