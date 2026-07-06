import { colors } from '../theme';

export function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num?.toString() || '0';
}

export function formatTime(minutes) {
  if (!minutes) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatDate(date) {
  if (!date) return 'Never';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Returns a { bg, text } tint pair from the signature-ui token set for a
// given ticket status, used for status badges.
export function getStatusColor(status) {
  switch (status) {
    case 'open':
      return { bg: colors.successTint, text: colors.successText };
    case 'in_progress':
      return { bg: colors.warningTint, text: colors.warningText };
    case 'resolved':
      return { bg: colors.successTint, text: colors.successText };
    case 'closed':
      return { bg: colors.surface1, text: colors.inkMuted };
    default:
      return { bg: colors.surface1, text: colors.inkMuted };
  }
}

export function getAvatarUrl(user) {
  if (!user) return null;
  const { id, avatar } = user;
  if (!avatar) {
    const discriminator = user.discriminator || '0';
    return `https://cdn.discordapp.com/embed/avatars/${Number(discriminator) % 5}.png`;
  }
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`;
}

export function getGuildIcon(guild) {
  if (!guild) return null;
  if (!guild.icon) {
    const idNum = parseInt(guild.id.slice(-8), 10);
    return `https://cdn.discordapp.com/embed/avatars/${idNum % 6}.png`;
  }
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`;
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
