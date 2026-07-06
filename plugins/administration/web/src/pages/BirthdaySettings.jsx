import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Toggle, Button, Select } from '../components/UI';
import { useApiFetch } from '../hooks/useApi';
import { Cake } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

export function BirthdaySettings() {
  const { guildData, refreshGuild } = useOutletContext();
  const { guild, config, channels, roles } = guildData || {};
  const guildId = guild?.id;

  const [formData, setFormData] = useState({
    birthdayEnabled: config?.birthdayEnabled || false,
    birthdayChannelId: config?.birthdayChannelId || '',
    birthdayRoleId: config?.birthdayRoleId || '',
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

  if (!guild) return null;

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Birthday System</h1>
      <p style={styles.pageSubtitle}>
        Configure birthday announcements for {guild.name}
      </p>

      <div style={styles.grid}>
        <Card title="Birthday Settings">
          <div style={styles.header}>
            <div style={styles.headerIcon}>
              <Cake size={28} color={colors.accent} />
            </div>
            <div>
              <h3 style={styles.cardTitle}>Birthday Celebrations</h3>
              <p style={styles.cardDesc}>
                Automatically celebrate member birthdays
              </p>
            </div>
          </div>

          <Toggle
            checked={formData.birthdayEnabled}
            onChange={(v) => updateField('birthdayEnabled', v)}
            label="Enable Birthday System"
            description="Allow users to set their birthday and receive announcements"
          />

          {formData.birthdayEnabled && (
            <>
              <Select
                label="Announcement Channel"
                value={formData.birthdayChannelId}
                onChange={(v) => updateField('birthdayChannelId', v)}
                options={channelOptions}
                placeholder="Select a channel"
              />
              <p style={styles.fieldDesc}>
                Channel where birthday announcements will be posted
              </p>

              <Select
                label="Birthday Role"
                value={formData.birthdayRoleId}
                onChange={(v) => updateField('birthdayRoleId', v)}
                options={roleOptions}
                placeholder="Select a role"
              />
              <p style={styles.fieldDesc}>
                Role to temporarily assign on member's birthday
              </p>
            </>
          )}
        </Card>

        <Card title="How It Works">
          <div style={styles.steps}>
            <div style={styles.step}>
              <div style={styles.stepNumber}>1</div>
              <div style={styles.stepContent}>
                <div style={styles.stepTitle}>Users Set Birthdays</div>
                <div style={styles.stepDesc}>
                  Members use the /birthday command to set their date
                </div>
              </div>
            </div>
            <div style={styles.step}>
              <div style={styles.stepNumber}>2</div>
              <div style={styles.stepContent}>
                <div style={styles.stepTitle}>Automatic Detection</div>
                <div style={styles.stepDesc}>
                  The bot checks daily for birthdays at 8:00 UTC
                </div>
              </div>
            </div>
            <div style={styles.step}>
              <div style={styles.stepNumber}>3</div>
              <div style={styles.stepContent}>
                <div style={styles.stepTitle}>Celebration</div>
                <div style={styles.stepDesc}>
                  Birthday role assigned and announcement posted
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
  stepNumber: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: colors.accentTint,
    color: colors.accentOnTint,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: fonts.body,
    fontWeight: 700,
    fontSize: `${fontSize.caption}px`,
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
