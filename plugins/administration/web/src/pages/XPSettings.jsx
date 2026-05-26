import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Toggle, Button, Select, Input } from '../components/UI';
import { useApiFetch } from '../hooks/useApi';
import { Zap } from 'lucide-react';

export function XPSettings() {
  const { guildData, refreshGuild } = useOutletContext();
  const { guild, config, channels, roles } = guildData || {};
  const guildId = guild?.id;

  const [formData, setFormData] = useState({
    xpEnabled: config?.xpEnabled ?? true,
    xpPerMessage: config?.xpPerMessage || 1,
    xpPerVoiceMinute: config?.xpPerVoiceMinute || 2,
    roleAutomation: config?.roleAutomation || false,
    roleRewards: config?.roleRewards || [],
    trackingChannels: config?.trackingChannels || [],
    excludeChannels: config?.excludeChannels || [],
  });

  const { request, loading } = useApiFetch();

  const channelOptions = (channels || []).map((c) => ({
    value: c.id,
    label: `#${c.name}`,
  }));

  const roleOptions = (roles || []).map((r) => ({
    value: r.id,
    label: r.name,
  }));

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

  function addRoleReward() {
    setFormData((prev) => ({
      ...prev,
      roleRewards: [
        ...prev.roleRewards,
        { roleName: '', roleId: '', xpThreshold: 0, topRank: 0 },
      ],
    }));
  }

  function updateRoleReward(index, field, value) {
    setFormData((prev) => ({
      ...prev,
      roleRewards: prev.roleRewards.map((r, i) =>
        i === index ? { ...r, [field]: value } : r
      ),
    }));
  }

  function removeRoleReward(index) {
    setFormData((prev) => ({
      ...prev,
      roleRewards: prev.roleRewards.filter((_, i) => i !== index),
    }));
  }

  if (!guild) return null;

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>XP & Leveling</h1>
      <p style={styles.pageSubtitle}>
        Configure XP gain and leveling system for {guild.name}
      </p>

      <div style={styles.grid}>
        <Card title="XP Settings">
          <div style={styles.header}>
            <div style={styles.headerIcon}>
              <Zap size={28} />
            </div>
            <div>
              <h3 style={styles.cardTitle}>Experience System</h3>
              <p style={styles.cardDesc}>
                Reward users with XP for activity
              </p>
            </div>
          </div>

          <Toggle
            checked={formData.xpEnabled}
            onChange={(v) => updateField('xpEnabled', v)}
            label="Enable XP System"
            description="Users will gain XP from messages and voice"
          />
        </Card>

        <Card title="XP Rates">
          <Input
            label="XP per Message"
            type="number"
            value={formData.xpPerMessage}
            onChange={(v) => updateField('xpPerMessage', v)}
          />
          <p style={styles.fieldDesc}>XP awarded for each message sent</p>

          <Input
            label="XP per Voice Minute"
            type="number"
            value={formData.xpPerVoiceMinute}
            onChange={(v) => updateField('xpPerVoiceMinute', v)}
          />
          <p style={styles.fieldDesc}>XP awarded per minute in voice chat</p>
        </Card>

        <Card title="Channel Tracking">
          <Select
            label="Tracking Channels"
            value={formData.trackingChannels[0] || ''}
            onChange={(v) => updateField('trackingChannels', v ? [v] : [])}
            options={channelOptions}
            placeholder="All channels (default)"
          />
          <p style={styles.fieldDesc}>
            Only track XP in selected channel (leave empty for all channels)
          </p>

          <Select
            label="Exclude Channels"
            value={formData.excludeChannels[0] || ''}
            onChange={(v) => updateField('excludeChannels', v ? [v] : [])}
            options={channelOptions}
            placeholder="None excluded"
          />
          <p style={styles.fieldDesc}>
            Channels to exclude from XP tracking
          </p>
        </Card>

        <Card title="Role Rewards">
          <Toggle
            checked={formData.roleAutomation}
            onChange={(v) => updateField('roleAutomation', v)}
            label="Enable Role Automation"
            description="Automatically assign roles based on XP thresholds"
          />

          {formData.roleAutomation && (
            <div style={styles.rewardsSection}>
              <div style={styles.rewardsList}>
                {formData.roleRewards.map((reward, index) => (
                  <div key={index} style={styles.rewardRow}>
                    <Select
                      value={reward.roleId}
                      onChange={(v) => {
                        const role = roles?.find((r) => r.id === v);
                        updateRoleReward(index, 'roleId', v);
                        updateRoleReward(index, 'roleName', role?.name || '');
                      }}
                      options={roleOptions}
                      placeholder="Select role"
                    />
                    <Input
                      type="number"
                      value={reward.xpThreshold}
                      onChange={(v) => updateRoleReward(index, 'xpThreshold', v)}
                      placeholder="XP threshold"
                    />
                    <Button
                      variant="secondary"
                      onClick={() => removeRoleReward(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="secondary" onClick={addRoleReward}>
                Add Role Reward
              </Button>
            </div>
          )}
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
    background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
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
  fieldDesc: {
    color: '#64748b',
    fontSize: '12px',
    marginTop: '-8px',
    marginBottom: '12px',
  },
  rewardsSection: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px solid #334155',
  },
  rewardsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '12px',
  },
  rewardRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  },
};
