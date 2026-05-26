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

export function getStatusColor(status) {
  switch (status) {
    case 'open': return '#10B981';
    case 'in_progress': return '#F59E0B';
    case 'closed': return '#6B7280';
    case 'resolved': return '#3B82F6';
    default: return '#6B7280';
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
