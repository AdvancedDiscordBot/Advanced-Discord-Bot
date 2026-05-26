import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Toggle, Button, Select } from '../components/UI';
import { useApiFetch } from '../hooks/useApi';
import { Bot, Brain, MessageSquare } from 'lucide-react';

export function AISettings() {
  const { guildData, refreshGuild } = useOutletContext();
  const { guild, config, channels } = guildData || {};
  const guildId = guild?.id;

  const [formData, setFormData] = useState({
    aiEnabled: config?.aiEnabled || false,
    aiMode: config?.aiMode || 'disabled',
    aiContext: config?.aiContext || '',
    aiChannels: config?.aiChannels || [],
  });

  const { request, loading } = useApiFetch();

  const channelOptions = (channels || []).map((c) => ({
    value: c.id,
    label: `#${c.name}`,
  }));

  const modeOptions = [
    { value: 'disabled', label: 'Disabled' },
    { value: 'context', label: 'Context Mode' },
    { value: 'auto', label: 'Auto Mode' },
    { value: 'hybrid', label: 'Hybrid Mode' },
  ];

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

  function handleChannelChange(selected) {
    setFormData((prev) => ({
      ...prev,
      aiChannels: selected === '' ? [] : [selected],
    }));
  }

  function updateField(field, value) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  if (!guild) return null;

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>AI Assistant</h1>
      <p style={styles.pageSubtitle}>
        Configure the AI-powered assistant for {guild.name}
      </p>

      <div style={styles.grid}>
        <Card title="AI Settings">
          <div style={styles.content}>
            <div style={styles.header}>
              <div style={styles.headerIcon}>
                <Brain size={28} />
              </div>
              <div>
                <h3 style={styles.cardTitle}>Google Gemini AI</h3>
                <p style={styles.cardDesc}>
                  Intelligent assistant powered by Google's Gemini AI
                </p>
              </div>
            </div>

            <Toggle
              checked={formData.aiEnabled}
              onChange={(v) => updateField('aiEnabled', v)}
              label="Enable AI Assistant"
              description="Allow users to interact with the AI assistant"
            />
          </div>
        </Card>

        <Card title="AI Configuration">
          <Select
            label="AI Mode"
            value={formData.aiMode}
            onChange={(v) => updateField('aiMode', v)}
            options={modeOptions}
          />
          <p style={styles.modeDesc}>
            <strong>Context Mode:</strong> AI responds with FAQ context{' '}
            <br />
            <strong>Auto Mode:</strong> AI auto-responds in channels{' '}
            <br />
            <strong>Hybrid:</strong> Combination of both modes
          </p>

          <Select
            label="AI Channel"
            value={formData.aiChannels[0] || ''}
            onChange={handleChannelChange}
            options={channelOptions}
            placeholder="Select a channel"
          />
          <p style={styles.modeDesc}>
            Channel where AI will auto-respond to messages
          </p>
        </Card>

        <Card title="AI Context / FAQ">
          <div style={styles.contextInfo}>
            <MessageSquare size={20} color="#64748b" />
            <span>
              Provide context or frequently asked questions for the AI to use
            </span>
          </div>
          <textarea
            value={formData.aiContext}
            onChange={(e) => updateField('aiContext', e.target.value)}
            placeholder="Enter FAQ or context for your server. The AI will use this to provide better responses..."
            style={styles.textarea}
            maxLength={2000}
          />
          <div style={styles.charCount}>
            {formData.aiContext.length}/2000 characters
          </div>
        </Card>
      </div>

      <div style={styles.actions}>
        <Button onClick={handleSave} loading={loading}>
          Save Changes
        </Button>
        <Button variant="secondary" onClick={() => refreshGuild()}>
          Reset
        </Button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '800px',
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
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid #334155',
    marginBottom: '8px',
  },
  headerIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
  },
  cardTitle: {
    color: '#f1f5f9',
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '4px',
  },
  cardDesc: {
    color: '#64748b',
    fontSize: '13px',
  },
  modeDesc: {
    color: '#64748b',
    fontSize: '12px',
    marginBottom: '16px',
    lineHeight: 1.5,
  },
  contextInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: '#64748b',
    fontSize: '13px',
    marginBottom: '12px',
  },
  textarea: {
    width: '100%',
    minHeight: '200px',
    padding: '12px',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '14px',
    resize: 'vertical',
    outline: 'none',
    fontFamily: 'inherit',
  },
  charCount: {
    color: '#64748b',
    fontSize: '12px',
    textAlign: 'right',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  },
};
