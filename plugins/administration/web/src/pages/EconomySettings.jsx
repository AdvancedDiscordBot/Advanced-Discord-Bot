import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, Button, Input, Select } from '../components/UI';
import { useApi } from '../hooks/useApi';
import { useApiFetch } from '../hooks/useApi';
import { Coins } from 'lucide-react';
import { colors, fonts, radius, fontSize } from '../theme';

export function EconomySettings() {
  const { guildData, refreshGuild } = useOutletContext();
  const { guild, config, roles } = guildData || {};
  const guildId = guild?.id;

  const economyConfig = config?.economy || {};

  const [formData, setFormData] = useState({
    minWorkAmount: economyConfig.minWorkAmount || 50,
    maxWorkAmount: economyConfig.maxWorkAmount || 250,
    workCooldown: economyConfig.workCooldown || 3600,
  });

  const [newItem, setNewItem] = useState({
    name: '',
    roleId: '',
    price: 100,
    itemType: 'cosmetic',
  });

  const { data: shopData, refetch: refetchShop } = useApi(
    guildId ? `/api/guild/${guildId}/shop` : null
  );

  const { request, loading } = useApiFetch();

  const shopItems = shopData?.items || [];

  const roleOptions = (roles || []).map((r) => ({
    value: r.id,
    label: r.name,
  }));

  async function handleSave() {
    try {
      await request(`/api/guild/${guildId}/config`, {
        method: 'PUT',
        body: JSON.stringify({ economy: formData }),
      });
      refreshGuild();
    } catch (err) {
      console.error('Failed to save:', err);
    }
  }

  async function handleAddItem() {
    if (!newItem.name || !newItem.roleId || !newItem.price) return;
    try {
      await request(`/api/guild/${guildId}/shop`, {
        method: 'POST',
        body: JSON.stringify(newItem),
      });
      setNewItem({ name: '', roleId: '', price: 100, itemType: 'cosmetic' });
      refetchShop();
    } catch (err) {
      console.error('Failed to add item:', err);
    }
  }

  async function handleDeleteItem(itemId) {
    try {
      await request(`/api/guild/${guildId}/shop/${itemId}`, {
        method: 'DELETE',
      });
      refetchShop();
    } catch (err) {
      console.error('Failed to delete item:', err);
    }
  }

  function updateField(field, value) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  if (!guild) return null;

  return (
    <div style={styles.container}>
      <h1 style={styles.pageTitle}>Economy</h1>
      <p style={styles.pageSubtitle}>
        Configure economy settings for {guild.name}
      </p>

      <div style={styles.grid}>
        <Card title="Work Settings">
          <div style={styles.header}>
            <div style={styles.headerIcon}>
              <Coins size={28} color={colors.accent} />
            </div>
            <div>
              <h3 style={styles.cardTitle}>Currency Settings</h3>
              <p style={styles.cardDesc}>
                Configure how users earn currency
              </p>
            </div>
          </div>

          <Input
            label="Minimum Work Reward"
            type="number"
            value={formData.minWorkAmount}
            onChange={(v) => updateField('minWorkAmount', v)}
          />
          <p style={styles.fieldDesc}>
            Minimum coins users can earn from /work
          </p>

          <Input
            label="Maximum Work Reward"
            type="number"
            value={formData.maxWorkAmount}
            onChange={(v) => updateField('maxWorkAmount', v)}
          />
          <p style={styles.fieldDesc}>
            Maximum coins users can earn from /work
          </p>

          <Input
            label="Work Cooldown (seconds)"
            type="number"
            value={formData.workCooldown}
            onChange={(v) => updateField('workCooldown', v)}
          />
          <p style={styles.fieldDesc}>
            Cooldown between work commands
          </p>

          <div style={styles.actions}>
            <Button onClick={handleSave} loading={loading}>
              Save Settings
            </Button>
          </div>
        </Card>

        <Card title="Shop Items">
          <div style={styles.shopHeader}>
            <span style={styles.shopCount}>{shopItems.length} items</span>
          </div>

          {shopItems.length > 0 ? (
            <div style={styles.shopList}>
              {shopItems.map((item) => (
                <div key={item._id} style={styles.shopItem}>
                  <div style={styles.shopItemInfo}>
                    <span style={styles.shopItemName}>{item.name}</span>
                    <span style={styles.shopItemPrice}>
                      {item.price.toLocaleString()} coins
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => handleDeleteItem(item._id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.empty}>No items in shop</div>
          )}
        </Card>

        <Card title="Add Shop Item">
          <div style={styles.addForm}>
            <Input
              label="Item Name"
              value={newItem.name}
              onChange={(v) => setNewItem((p) => ({ ...p, name: v }))}
              placeholder="e.g., VIP Role"
            />

            <Select
              label="Role"
              value={newItem.roleId}
              onChange={(v) => setNewItem((p) => ({ ...p, roleId: v }))}
              options={roleOptions}
              placeholder="Select role"
            />

            <Input
              label="Price"
              type="number"
              value={newItem.price}
              onChange={(v) => setNewItem((p) => ({ ...p, price: v }))}
            />

            <Select
              label="Item Type"
              value={newItem.itemType}
              onChange={(v) => setNewItem((p) => ({ ...p, itemType: v }))}
              options={[
                { value: 'cosmetic', label: 'Cosmetic' },
                { value: 'income', label: 'Income Generator' },
              ]}
            />

            <Button onClick={handleAddItem}>Add Item</Button>
          </div>
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
  actions: {
    marginTop: '16px',
  },
  shopHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  shopCount: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
  },
  shopList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  shopItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    background: colors.cream,
    borderRadius: `${radius.control}px`,
    border: `1.5px solid ${colors.hairline}`,
  },
  shopItemInfo: {
    flex: 1,
  },
  shopItemName: {
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    fontWeight: 500,
    display: 'block',
  },
  shopItemPrice: {
    color: colors.accent,
    fontFamily: fonts.body,
    fontSize: `${fontSize.caption}px`,
    marginTop: '2px',
    display: 'block',
  },
  empty: {
    color: colors.inkMuted,
    fontFamily: fonts.body,
    fontSize: `${fontSize.meta}px`,
    textAlign: 'center',
    padding: '24px',
  },
  addForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
};
