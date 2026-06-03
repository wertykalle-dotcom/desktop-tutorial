import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useI18n } from '../../src/contexts/I18nContext';

type QueueItem = {
  moderation_id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  user_id: string;
  score: number;
  status: string;
  reason?: string | null;
  text?: string | null;
  created_at: string;
};

type AdSettings = {
  in_feed_enabled: boolean;
  in_feed_frequency: number;
  sidebar_enabled: boolean;
  interstitial_enabled: boolean;
  ad_network_enabled: boolean;
  ad_network_tag: string;
};

type ModerationSettings = {
  sensitivity: number;
};

type AdCampaign = {
  campaign_id: string;
  name: string;
  asset_url?: string | null;
  asset_type: string;
  targeting?: Record<string, unknown>;
  budget: number;
  start_at?: string | null;
  end_at?: string | null;
  impressions_goal?: number | null;
  clicks_goal?: number | null;
  placements?: string[];
  created_at: string;
  status: string;
};

type SystemLog = {
  log_id: string;
  level: string;
  component: string;
  message: string;
  created_at: string;
};

type ExchangeRates = Record<string, number>;

export default function AdminScreen() {
  const { user, token, updateUser } = useAuth();
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [systemSettings, setSystemSettings] = useState<any>(null);
  const [finance, setFinance] = useState<any>(null);
  const [adSettings, setAdSettings] = useState<AdSettings>({
    in_feed_enabled: false,
    in_feed_frequency: 5,
    sidebar_enabled: false,
    interstitial_enabled: false,
    ad_network_enabled: false,
    ad_network_tag: '',
  });
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>({
    EUR: 1,
    USD: 0.92,
    GBP: 1.17,
    SEK: 0.089,
    NOK: 0.086,
    BTC: 61000,
    CAD: 0.68,
    AUD: 0.61,
    CHF: 1.04,
    JPY: 0.0062,
  });
  const [exchangeRatesText, setExchangeRatesText] = useState('');
  const [exchangeRatesUpdatedAt, setExchangeRatesUpdatedAt] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [targetRole, setTargetRole] = useState<'Super Admin' | 'Moderator' | 'User'>('User');
  const [savingRole, setSavingRole] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignAssetUrl, setCampaignAssetUrl] = useState('');
  const [campaignCurrency, setCampaignCurrency] = useState('EUR');
  const [campaignTargeting, setCampaignTargeting] = useState('');
  const [campaignBudget, setCampaignBudget] = useState('0');
  const [campaignPlacements, setCampaignPlacements] = useState('in_feed');
  const [moderationSettings, setModerationSettings] = useState<ModerationSettings>({ sensitivity: 50 });
  const [nukeTargetUserId, setNukeTargetUserId] = useState('');

  const ensureAdmin = useCallback(() => {
    if (user?.role !== 'Super Admin') {
      router.replace('/(tabs)/feed');
      return false;
    }
    return true;
  }, [router, user?.role]);

  const loadAdminData = useCallback(async () => {
    if (!token || !ensureAdmin()) return;
    setLoading(true);
    try {
      const [settingsResp, financeResp, queueResp] = await Promise.all([
        apiFetch('/admin/system-settings'),
        apiFetch('/admin/finance'),
        apiFetch('/admin/moderation-queue'),
      ]);
      const [adsResp, campaignsResp, logsResp] = await Promise.all([
        apiFetch('/admin/ads/settings'),
        apiFetch('/admin/ads/campaigns'),
        apiFetch('/admin/logs'),
      ]);
      const moderationResp = await apiFetch('/admin/moderation/settings');
      const ratesResp = await apiFetch('/admin/exchange-rates');
      if (settingsResp?.ok) setSystemSettings(await settingsResp.json());
      if (financeResp?.ok) setFinance(await financeResp.json());
      if (queueResp?.ok) setQueue(await queueResp.json());
      if (adsResp?.ok) setAdSettings(await adsResp.json());
      if (campaignsResp?.ok) setCampaigns(await campaignsResp.json());
      if (logsResp?.ok) setLogs(await logsResp.json());
      if (moderationResp?.ok) setModerationSettings(await moderationResp.json());
      if (ratesResp?.ok) {
        const payload = await ratesResp.json();
        const rates = payload?.rates || payload || {};
        setExchangeRates(rates);
        setExchangeRatesText(JSON.stringify(rates, null, 2));
        setExchangeRatesUpdatedAt(payload?.updated_at || '');
      }
    } catch (error) {
      console.error('Error loading admin data:', error);
      Alert.alert(t('error'), t('adminLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, ensureAdmin, token, t]);

  useFocusEffect(
    useCallback(() => {
      loadAdminData();
    }, [loadAdminData])
  );

  const updateRole = async () => {
    if (!targetUserId.trim()) {
      Alert.alert(t('error'), t('adminEnterUserId'));
      return;
    }
    setSavingRole(true);
    try {
      const response = await apiFetch(`/admin/users/${targetUserId.trim()}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: targetRole }),
      });
      if (!response || response.status === 401) {
        Alert.alert(t('adminAccessDeniedTitle'), t('adminAccessDeniedBody'));
        return;
      }
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(raw || 'Role update failed');
      }
      Alert.alert(t('adminDone'), t('adminRoleUpdated'));
      if (user?.user_id === targetUserId.trim()) {
        updateUser({ role: targetRole });
      }
      setTargetUserId('');
      await loadAdminData();
    } catch (error: any) {
      Alert.alert(t('error'), error?.message || t('adminRoleUpdateFailed'));
    } finally {
      setSavingRole(false);
    }
  };

  const updateAdSetting = async (next: Partial<AdSettings>) => {
    const updated = { ...adSettings, ...next };
    setAdSettings(updated);
    try {
      const response = await apiFetch('/admin/ads/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!response || !response.ok) throw new Error('Ad settings update failed');
      await loadAdminData();
    } catch (error: any) {
      Alert.alert(t('error'), error?.message || t('adminAdSettingsFailed'));
    }
  };

  const createCampaign = async () => {
    try {
          const response = await apiFetch('/admin/ads/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim(),
          asset_url: campaignAssetUrl.trim() || null,
          asset_type: 'image',
          currency: campaignCurrency.trim() || 'EUR',
          targeting: campaignTargeting.trim() ? JSON.parse(campaignTargeting) : {},
          budget: Number(campaignBudget || 0),
          placements: campaignPlacements.split(',').map((item) => item.trim()).filter(Boolean),
        }),
      });
      if (!response || !response.ok) throw new Error(t('adminCampaignCreateFailed'));
      setCampaignName('');
      setCampaignAssetUrl('');
      setCampaignCurrency('EUR');
      setCampaignTargeting('');
      await loadAdminData();
    } catch (error: any) {
      Alert.alert(t('error'), error?.message || t('adminCampaignCreateFailed'));
    }
  };

  const sendBroadcast = async () => {
    try {
      const response = await apiFetch('/admin/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMessage.trim() }),
      });
      if (!response || !response.ok) throw new Error('Broadcast epäonnistui');
      setBroadcastMessage('');
      Alert.alert(t('adminDone'), t('adminBroadcastSent'));
    } catch (error: any) {
      Alert.alert(t('error'), error?.message || t('adminBroadcastFailed'));
    }
  };

  const nukeUser = async () => {
    const target = nukeTargetUserId.trim();
    if (!target) {
      Alert.alert(t('error'), t('adminEnterTargetUserId'));
      return;
    }
    Alert.alert(
      t('adminConfirmDeleteTitle'),
      t('adminConfirmDeleteBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('feedCommentDelete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await apiFetch(`/admin/users/${target}`, { method: 'DELETE' });
              if (!response || !response.ok) throw new Error(t('adminDeleteUserFailed'));
              setNukeTargetUserId('');
              Alert.alert(t('adminDone'), t('adminUserDeleted'));
              await loadAdminData();
            } catch (error: any) {
              Alert.alert(t('error'), error?.message || t('adminDeleteUserFailed'));
            }
          },
        },
      ]
    );
  };

  const updateModerationSensitivity = async (sensitivity: number) => {
    const next = Math.max(0, Math.min(100, Number.isFinite(sensitivity) ? sensitivity : 50));
    setModerationSettings({ sensitivity: next });
    try {
      const response = await apiFetch('/admin/moderation/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sensitivity: next }),
      });
      if (!response || !response.ok) throw new Error(t('adminModerationSettingsFailed'));
      await loadAdminData();
    } catch (error: any) {
      Alert.alert(t('error'), error?.message || t('adminModerationSettingsFailed'));
    }
  };

  const saveExchangeRates = async () => {
    try {
      const parsed = JSON.parse(exchangeRatesText || '{}') as Record<string, number>;
      const ratesPayload = Object.entries(parsed)
        .map(([currency, rate]) => ({ currency, rate_to_eur: Number(rate) }))
        .filter((item) => item.currency && Number.isFinite(item.rate_to_eur));
      const response = await apiFetch('/admin/exchange-rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: ratesPayload }),
      });
      if (!response || !response.ok) throw new Error(t('adminRatesUpdateFailed'));
      await loadAdminData();
    } catch (error: any) {
      Alert.alert(t('error'), error?.message || t('adminRatesUpdateFailed'));
    }
  };

  const refreshExchangeRates = async () => {
    try {
      const response = await apiFetch('/admin/exchange-rates/refresh', {
        method: 'POST',
      });
      if (!response || !response.ok) throw new Error(t('adminRatesRefreshFailed'));
      await loadAdminData();
      Alert.alert(t('adminDone'), t('adminRatesUpdated'));
    } catch (error: any) {
      Alert.alert(t('error'), error?.message || t('adminRatesRefreshFailed'));
    }
  };

  if (user?.role !== 'Super Admin') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('adminTitle')}</Text>
        <Text style={styles.subtitle}>{t('adminSubtitle')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator color="#007AFF" /> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminSystemSettings')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminRoles')}: {(systemSettings?.roles || []).join(', ') || t('adminNoData')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminModerationQueue')}: {systemSettings?.moderation_queue_count ?? 0}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminFinance')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminUsers')}: {finance?.users_count ?? 0}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminPosts')}: {finance?.posts_count ?? 0}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminModerationItems')}: {finance?.moderation_queue_count ?? 0}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminAdRevenue')}: {finance?.ad_revenue_eur ?? 0}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminRoleSwitch')}</Text>
          <TextInput
            style={styles.input}
            value={targetUserId}
            onChangeText={setTargetUserId}
            placeholder={t('adminUserIdPlaceholder')}
            autoCapitalize="none"
          />
          <View style={[styles.roleRow, isRTL && styles.rowReverseWrap]}>
            {(['User', 'Moderator', 'Super Admin'] as const).map((role) => (
              <TouchableOpacity
                key={role}
                style={[styles.roleButton, targetRole === role && styles.roleButtonActive]}
                onPress={() => setTargetRole(role)}
              >
                <Text style={[styles.roleButtonText, targetRole === role && styles.roleButtonTextActive]}>
                  {role === 'User' ? t('adminRoleUser') : role === 'Moderator' ? t('adminRoleModerator') : t('adminRoleSuperAdmin')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={[styles.primaryButton, isRTL && styles.rowReverse]} onPress={updateRole} disabled={savingRole}>
            {savingRole ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{t('adminUpdateRole')}</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminModerationQueue')}</Text>
          {queue.length === 0 ? (
            <Text style={styles.empty}>{t('adminNoQueue')}</Text>
          ) : (
            queue.map((item) => (
              <View key={item.moderation_id} style={styles.queueItem}>
                <Text style={[styles.queueTitle, isRTL && styles.textRight]}>
                  {item.target_type} · {t('adminPoints')} {item.score}
                </Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminStatus')}: {item.status}</Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminReason')}: {item.reason || t('adminNoData')}</Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminText')}: {item.text || t('adminNoData')}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminAiSensitivity')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminCurrentLevel')}: {moderationSettings.sensitivity}</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={String(moderationSettings.sensitivity)}
            onChangeText={(value) => setModerationSettings({ sensitivity: Number(value || 50) })}
            onEndEditing={() => updateModerationSensitivity(moderationSettings.sensitivity)}
            placeholder={t('adminSensitivityPlaceholder')}
          />
          <Text style={[styles.meta, isRTL && styles.textRight]}>
            {t('adminSensitivityHelp')}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminOverride')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminOverrideDescription')}</Text>
          <TextInput
            style={styles.input}
            value={nukeTargetUserId}
            onChangeText={setNukeTargetUserId}
            placeholder={t('adminOverrideTargetPlaceholder')}
            autoCapitalize="none"
          />
          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#b91c1c' }, isRTL && styles.rowReverse]} onPress={nukeUser}>
            <Text style={styles.primaryButtonText}>{t('adminNukeUser')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminExchangeRates')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminRatesDescription')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>
            {t('adminRatesUpdatedAt')}: {exchangeRatesUpdatedAt || t('adminNoData')}
          </Text>
          <TextInput
            style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
            value={exchangeRatesText}
            onChangeText={setExchangeRatesText}
            placeholder={t('adminRatesPlaceholder')}
            multiline
          />
          <TouchableOpacity style={styles.primaryButton} onPress={saveExchangeRates}>
            <Text style={styles.primaryButtonText}>{t('adminSaveRates')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#0f766e' }]} onPress={refreshExchangeRates}>
            <Text style={styles.primaryButtonText}>{t('adminRefreshRates')}</Text>
          </TouchableOpacity>
          <View style={styles.queueItem}>
            {Object.entries(exchangeRates).map(([currency, rate]) => (
              <Text key={currency} style={[styles.meta, isRTL && styles.textRight]}>
                {currency}: {rate}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminAds')}</Text>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminInFeedAds')}</Text>
          <TouchableOpacity
            style={[styles.toggle, adSettings.in_feed_enabled && styles.toggleActive]}
            onPress={() => updateAdSetting({ in_feed_enabled: !adSettings.in_feed_enabled })}
          >
            <Text style={styles.toggleText}>{adSettings.in_feed_enabled ? t('adminToggleOn') : t('adminToggleOff')}</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={String(adSettings.in_feed_frequency)}
            onChangeText={(value) => setAdSettings((prev) => ({ ...prev, in_feed_frequency: Number(value || 5) }))}
            onEndEditing={() => updateAdSetting({ in_feed_frequency: adSettings.in_feed_frequency })}
            placeholder={t('adminFrequencyPlaceholder')}
          />
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminSidebarAds')}</Text>
          <TouchableOpacity
            style={[styles.toggle, adSettings.sidebar_enabled && styles.toggleActive]}
            onPress={() => updateAdSetting({ sidebar_enabled: !adSettings.sidebar_enabled })}
          >
            <Text style={styles.toggleText}>{adSettings.sidebar_enabled ? t('adminToggleOn') : t('adminToggleOff')}</Text>
          </TouchableOpacity>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminInterstitialAds')}</Text>
          <TouchableOpacity
            style={[styles.toggle, adSettings.interstitial_enabled && styles.toggleActive]}
            onPress={() => updateAdSetting({ interstitial_enabled: !adSettings.interstitial_enabled })}
          >
            <Text style={styles.toggleText}>{adSettings.interstitial_enabled ? t('adminToggleOn') : t('adminToggleOff')}</Text>
          </TouchableOpacity>
          <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminAdNetworkTag')}</Text>
          <TextInput
            style={styles.input}
            value={adSettings.ad_network_tag}
            onChangeText={(value) => setAdSettings((prev) => ({ ...prev, ad_network_tag: value }))}
            placeholder={t('adminAdNetworkPlaceholder')}
            multiline
          />
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => updateAdSetting({ ad_network_enabled: !adSettings.ad_network_enabled })}
          >
            <Text style={styles.primaryButtonText}>
              {adSettings.ad_network_enabled ? t('adminDisableNetwork') : t('adminEnableNetwork')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminCampaigns')}</Text>
          <TextInput style={styles.input} placeholder={t('adminCampaignNamePlaceholder')} value={campaignName} onChangeText={setCampaignName} />
          <TextInput style={styles.input} placeholder={t('adminAssetUrlPlaceholder')} value={campaignAssetUrl} onChangeText={setCampaignAssetUrl} />
          <TextInput style={styles.input} placeholder={t('adminCurrencyPlaceholder')} value={campaignCurrency} onChangeText={setCampaignCurrency} />
          <TextInput
            style={styles.input}
            placeholder={t('adminTargetingPlaceholder')}
            value={campaignTargeting}
            onChangeText={setCampaignTargeting}
            multiline
          />
          <TextInput style={styles.input} placeholder={t('adminBudgetPlaceholder')} keyboardType="numeric" value={campaignBudget} onChangeText={setCampaignBudget} />
          <TextInput
            style={styles.input}
            placeholder={t('adminPlacementsPlaceholder')}
            value={campaignPlacements}
            onChangeText={setCampaignPlacements}
          />
          <TouchableOpacity style={[styles.primaryButton, isRTL && styles.rowReverse]} onPress={createCampaign}>
            <Text style={styles.primaryButtonText}>{t('adminCreateCampaign')}</Text>
          </TouchableOpacity>
          {campaigns.map((campaign) => (
              <View key={campaign.campaign_id} style={styles.queueItem}>
                <Text style={[styles.queueTitle, isRTL && styles.textRight]}>{campaign.name}</Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminStatus')}: {campaign.status}</Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminBudgetPlaceholder')}: {campaign.budget}</Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminPlacementsPlaceholder')}: {(campaign.placements || []).join(', ')}</Text>
              </View>
            ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminBroadcast')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('adminBroadcastPlaceholder')}
            value={broadcastMessage}
            onChangeText={setBroadcastMessage}
            multiline
          />
          <TouchableOpacity style={[styles.primaryButton, isRTL && styles.rowReverse]} onPress={sendBroadcast}>
            <Text style={styles.primaryButtonText}>{t('adminSendPush')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminLogs')}</Text>
          {logs.length === 0 ? (
            <Text style={styles.empty}>{t('adminNoLogs')}</Text>
          ) : (
            logs.map((log) => (
              <View key={log.log_id} style={styles.queueItem}>
                <Text style={[styles.queueTitle, isRTL && styles.textRight]}>{log.level} · {log.component}</Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{log.message}</Text>
                <Text style={[styles.meta, isRTL && styles.textRight]}>{log.created_at}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fb' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e6e8ef' },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  subtitle: { marginTop: 4, color: '#6b7280' },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e6e8ef', gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  meta: { color: '#374151' },
  textRight: { textAlign: 'right' },
  empty: { color: '#6b7280' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  roleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowReverseWrap: { flexDirection: 'row-reverse' },
  roleButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  roleButtonActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  roleButtonText: { color: '#374151', fontWeight: '700' },
  roleButtonTextActive: { color: '#fff' },
  primaryButton: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  rowReverse: { flexDirection: 'row-reverse' },
  primaryButtonText: { color: '#fff', fontWeight: '800' },
  queueItem: { borderTopWidth: 1, borderTopColor: '#eef2f7', paddingTop: 10, gap: 4 },
  queueTitle: { fontWeight: '800', color: '#111827' },
  toggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#eef2f7',
  },
  toggleActive: {
    backgroundColor: '#111827',
  },
  toggleText: {
    color: '#fff',
    fontWeight: '800',
  },
});
