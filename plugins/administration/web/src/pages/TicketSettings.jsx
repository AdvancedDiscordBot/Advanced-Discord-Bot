import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Button, Select } from '../components/UI';
import { useApi } from '../hooks/useApi';
import { useApiFetch } from '../hooks/useApi';
import { Ticket, User, Clock } from 'lucide-react';
import { formatDate, getStatusColor } from '../utils/helpers';

export function TicketSettings() {
  const { guildData, refreshGuild } = useOutletContext();
  const { guild, config, categories, channels } = guildData || {};
  const guildId = guild?.id;

  const [formData, setFormData] = useState({
    ticketCategoryId: config?.ticketCategoryId || '',
    ticketLogChannelId: config?.ticketLogChannelId || '',
  });

  const { data: ticketsData } = useApi(
    guildId ? `/api/guild/${guildId}/tickets` : null
  );

  const { request, loading } = useApiFetch();

  const categoryOptions = (categories || []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const channelOptions = (channels || []).map((c) => ({
    value: c.id,
    label: `#${c.name}`,
  }));

  const tickets = ticketsData?.tickets || [];

  async function handleSave() {
    try {
      await request(`/api/guild/${guildId}/config`, {
        method: 'PUT',
        body: JSON.stringify({ serverConfig: formData }),
      });
      refreshGuild();
    } catch (err) {
      console.error('Failed to save:', err);
    }
  }

  function updateField(field, value) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  if (!guild) return null;

  const openTickets = tickets.filter((t) => t.status === 'open');
  const inProgressTickets = tickets.filter((t) => t.status === 'in_progress');

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Ticket System</h1>
      <p style={styles.pageSubtitle}>
        Manage support tickets for {guild.name}
      </p>

      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <div style={styles.statValue}>{tickets.length}</div>
          <div style={styles.statLabel}>Total Tickets</div>
        </div>
        <div style={styles.stat}>
          <div style={{ ...styles.statValue, color: '#10B981' }}>
            {openTickets.length}
          </div>
          <div style={styles.statLabel}>Open</div>
        </div>
        <div style={styles.stat}>
          <div style={{ ...styles.statValue, color: '#F59E0B' }}>
            {inProgressTickets.length}
          </div>
          <div style={styles.statLabel}>In Progress</div>
        </div>
      </div>

      <div style={styles.grid}>
        <Card title="Ticket Configuration">
          <Select
            label="Ticket Category"
            value={formData.ticketCategoryId}
            onChange={(v) => updateField('ticketCategoryId', v)}
            options={categoryOptions}
            placeholder="Select a category"
          />
          <p style={styles.fieldDesc}>
            Category where ticket channels will be created
          </p>

          <Select
            label="Log Channel"
            value={formData.ticketLogChannelId}
            onChange={(v) => updateField('ticketLogChannelId', v)}
            options={channelOptions}
            placeholder="Select a channel"
          />
          <p style={styles.fieldDesc}>
            Channel for ticket logs and notifications
          </p>

          <div style={styles.actions}>
            <Button onClick={handleSave} loading={loading}>
              Save Configuration
            </Button>
          </div>
        </Card>

        <Card title="Recent Tickets">
          {tickets.length > 0 ? (
            <div style={styles.ticketsList}>
              {tickets.slice(0, 10).map((ticket) => (
                <div key={ticket._id} style={styles.ticketRow}>
                  <div style={styles.ticketHeader}>
                    <span style={styles.ticketTitle}>{ticket.title}</span>
                    <span
                      style={{
                        ...styles.ticketStatus,
                        backgroundColor: `${getStatusColor(ticket.status)}20`,
                        color: getStatusColor(ticket.status),
                      }}
                    >
                      {ticket.status}
                    </span>
                  </div>
                  <div style={styles.ticketMeta}>
                    <span style={styles.ticketMetaItem}>
                      <User size={14} />
                      <span>Ticket #{ticket._id.slice(-6)}</span>
                    </span>
                    <span style={styles.ticketMetaItem}>
                      <Clock size={14} />
                      <span>{formatDate(ticket.createdAt)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.empty}>No tickets yet</div>
          )}
        </Card>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '900px',
  },
  pageTitle: {
    color: '#f1f5f9',
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '4px',
  },
  pageSubtitle: {
    color: '#64748b',
    fontSize: '14px',
    marginBottom: '24px',
  },
  statsRow: {
    display: 'flex',
    gap: '24px',
    marginBottom: '24px',
    padding: '16px',
    background: '#1e293b',
    borderRadius: '12px',
  },
  stat: {
    textAlign: 'center',
  },
  statValue: {
    color: '#f1f5f9',
    fontSize: '28px',
    fontWeight: 700,
  },
  statLabel: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '4px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
    gap: '16px',
  },
  fieldDesc: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '-8px',
    marginBottom: '12px',
  },
  actions: {
    marginTop: '16px',
  },
  ticketsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  ticketRow: {
    padding: '12px',
    background: '#0f172a',
    borderRadius: '8px',
    border: '1px solid #334155',
  },
  ticketHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  ticketTitle: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontWeight: 500,
  },
  ticketStatus: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
  },
  ticketMeta: {
    display: 'flex',
    gap: '16px',
    color: '#64748b',
    fontSize: '12px',
  },
  ticketMetaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  empty: {
    color: '#64748b',
    textAlign: 'center',
    padding: '24px',
  },
};
