import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Toggle, Button, Select, Input } from '../components/UI';
import { useApiFetch } from '../hooks/useApi';
import { Shield, AlertTriangle, Clock, Users } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

export function AntiRaidSettings() {
  const { guildData, refreshGuild } = useOutletContext();
  const { guild, config, channels } = guildData || {};
  const guildId = guild?.id;

  const antiRaidConfig = config?.antiRaid || {};

  const [formData, setFormData] = useState({
    enabled: antiRaidConfig.enabled || false,
    joinThreshold: antiRaidConfig.joinThreshold || 5,
    timeWindow: antiRaidConfig.timeWindow || 10,
    action: antiRaidConfig.action || 'kick',
    alertChannel: antiRaidConfig.alertChannel || '',
  });

  const { request, loading } = useApiFetch();

  const channelOptions = (channels || []).map((c) => ({
    value: c.id,
    label: `#${c.name}`,
  }));

  const actionOptions = [
    { value: 'kick', label: 'Kick' },
    { value: 'ban', label: 'Ban' },
    { value: 'mute', label: 'Mute' },
  ];

  async function handleSave() {
    try {
      await request(`/api/guild/${guildId}/config`, {
        method: 'PUT',
        body: JSON.stringify({ antiRaid: formData }),
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

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Anti-Raid</h1>
      <p style={styles.pageSubtitle}>
        Configure raid protection for {guild.name}
      </p>

      <div style={styles.grid}>
        <Card title="Raid Protection">
          <div style={styles.header}>
            <div style={styles.headerIcon}>
              <Shield size={28} color={colors.accent} />
            </div>
            <div>
              <h3 style={styles.cardTitle}>Automatic Raid Detection</h3>
              <p style={styles.cardDesc}>
                Detect and stop mass join raids automatically
              </p>
            </div>
          </div>

          <Toggle
            checked={formData.enabled}
            onChange={(v) => updateField('enabled', v)}
            label="Enable Anti-Raid"
            description="Automatically detect and respond to raid attempts"
          />
        </Card>

        {formData.enabled && (
          <>
            <Card title="Detection Settings">
              <Input
                label="Join Threshold"
                type="number"
                value={formData.joinThreshold}
                onChange={(v) => updateField('joinThreshold', v)}
              />
              <p style={styles.fieldDesc}>
                Number of joins that triggers raid detection
              </p>

              <Input
                label="Time Window (seconds)"
                type="number"
                value={formData.timeWindow}
                onChange={(v) => updateField('timeWindow', v)}
              />
              <p style={styles.fieldDesc}>
                Time window to count joins within
              </p>

              <Select
                label="Punishment Action"
                value={formData.action}
                onChange={(v) => updateField('action', v)}
                options={actionOptions}
              />
              <p style={styles.fieldDesc}>
                Action to take when raid is detected
              </p>
            </Card>

            <Card title="Alerts">
              <Select
                label="Alert Channel"
                value={formData.alertChannel}
                onChange={(v) => updateField('alertChannel', v)}
                options={channelOptions}
                placeholder="Select a channel"
              />
              <p style={styles.fieldDesc}>
                Channel for raid alerts and notifications
              </p>
            </Card>
          </>
        )}

        <Card title="How It Works">
          <div style={styles.steps}>
            <div style={styles.step}>
              <div style={styles.stepIcon}>
                <Users size={18} color={colors.ink} />
              </div>
              <div style={styles.stepContent}>
                <div style={styles.stepTitle}>Monitor Joins</div>
                <div style={styles.stepDesc}>
                  Track all new member joins in real-time
                </div>
              </div>
            </div>
            <div style={styles.step}>
              <div style={styles.stepIcon}>
                <Clock size={18} color={colors.ink} />
              </div>
              <div style={styles.stepContent}>
                <div style={styles.stepTitle}>Detect Anomaly</div>
                <div style={styles.stepDesc}>
                  Alert when join threshold is exceeded within time window
                </div>
              </div>
            </div>
            <div style={styles.step}>
              <div style={styles.stepIcon}>
                <AlertTriangle size={18} color={colors.ink} />
              </div>
              <div style={styles.stepContent}>
                <div style={styles.stepTitle}>Auto Response</div>
                <div style={styles.stepDesc}>
                  Automatically kick/ban recent joiners and alert staff
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div style={styles.actions}>
        <Button onClick={handleSave} loading={loading}>
          Save Settings
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
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.heading}px`,
    fontWeight: 400,
    marginBottom: '4px',
  },
  pageSubtitle: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
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
    borderBottom: `1.5px solid ${colors.hairline}`,
    marginBottom: '16px',
  },
  headerIcon: {
    width: '56px',
    height: '56px',
    borderRadius: `${radius.card}px`,
    background: colors.accentTint,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: `${fontSize.title}px`,
    fontWeight: 400,
    marginBottom: '4px',
  },
  cardDesc: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
  },
  fieldDesc: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    marginTop: '-8px',
    marginBottom: '16px',
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
  },
  stepIcon: {
    width: '32px',
    height: '32px',
    borderRadius: `${radius.control}px`,
    background: colors.surface2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 500,
    marginBottom: '2px',
  },
  stepDesc: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px',
  },
};
