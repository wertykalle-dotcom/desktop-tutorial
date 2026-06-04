import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { useApiClient } from '../../src/hooks/useApiClient';
import { API_BASE } from '../../src/utils/api/http';
import {
  useAdminDashboardData,
  type AdminAdSettings as AdSettings,
  type AdminHomepageSettings,
  type AdminPaymentSettings,
} from '../../src/hooks/useAdminDashboardData';
import { useI18n } from '../../src/contexts/I18nContext';
import { ROLE_OPTIONS, isSuperAdmin, roleLabel, type RoleKey } from '../../src/utils/roles';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const card = 'rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg shadow-black/20';
const input = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500';
const buttonBase = 'inline-flex items-center justify-center rounded-xl px-4 py-3 font-semibold transition';
const primaryButton = `${buttonBase} bg-brand-600 text-white hover:bg-brand-500`;
const secondaryButton = `${buttonBase} border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800`;
const dangerButton = `${buttonBase} bg-rose-600 text-white hover:bg-rose-500`;
const defaultPaymentSettings: AdminPaymentSettings = {
  card_enabled: true,
  wallet_enabled: true,
  crypto_enabled: true,
  card_provider: 'visa-or-psp',
  wallet_provider: 'internal-wallet',
  crypto_provider: 'onchain',
  settlement_currency: 'EUR',
  wallet_topup_enabled: true,
  supported_currencies: ['EUR', 'USD', 'BTC'],
};
const defaultHomepageSettings: AdminHomepageSettings = {
  title: 'Tervetuloa YOSLA SOME LIFE',
  subtitle: 'Suomalainen some, jossa voit julkaista, keskustella ja rakentaa verkoston yhdessä paikassa.',
  badge: 'Suomalainen some',
  hero_image_url: null,
  hero_image_alt: 'YOSLA SOME LIFE',
};
const BACKEND_ORIGIN = API_BASE.replace(/\/api$/, '');

export default function AdminWebScreen() {
  const { user, token, updateUser } = useAuth();
  const { apiFetch } = useApiClient();
  const {
    loading,
    queue,
    history,
    systemSettings,
    finance,
    adSettings,
    auditLogs,
    presenceTelemetry,
    moderationSettings,
    exchangeRatesText,
    exchangeRatesUpdatedAt,
    systemOverview,
    paymentSettings,
    paymentSummary,
    homepageSettings,
    setPaymentSettings,
    setHomepageSettings,
    setAdSettings,
    setExchangeRatesText,
    setModerationSettings,
    loadAdminData,
    canAccess,
  } = useAdminDashboardData();
  const { t, isRTL } = useI18n();
  const [targetUserId, setTargetUserId] = useState('');
  const [targetRole, setTargetRole] = useState<RoleKey>('user');
  const [nukeTargetUserId, setNukeTargetUserId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [campaignAssetUrl, setCampaignAssetUrl] = useState('');
  const [campaignTargeting, setCampaignTargeting] = useState('');
  const [campaignBudget, setCampaignBudget] = useState('0');
  const [campaignPlacements, setCampaignPlacements] = useState('in_feed');
  const [campaignCurrency, setCampaignCurrency] = useState('EUR');
  const [paymentUserId, setPaymentUserId] = useState('');
  const [paymentPurpose, setPaymentPurpose] = useState('wallet_topup');
  const [paymentReferenceId, setPaymentReferenceId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('0');
  const [paymentCurrency, setPaymentCurrency] = useState('EUR');
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'wallet' | 'crypto'>('card');
  const [walletAdjustUserId, setWalletAdjustUserId] = useState('');
  const [walletAdjustAmount, setWalletAdjustAmount] = useState('0');
  const [walletAdjustCurrency, setWalletAdjustCurrency] = useState('EUR');
  const [paymentDraft, setPaymentDraft] = useState<AdminPaymentSettings>(defaultPaymentSettings);
  const [homepageDraft, setHomepageDraft] = useState<AdminHomepageSettings>(defaultHomepageSettings);

  useEffect(() => {
    setPaymentDraft(paymentSettings ?? defaultPaymentSettings);
  }, [paymentSettings]);

  useEffect(() => {
    setHomepageDraft(homepageSettings ?? defaultHomepageSettings);
  }, [homepageSettings]);

  useEffect(() => {
    if (!token || !canAccess) return undefined;
    const intervalId = setInterval(() => {
      void loadAdminData();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [canAccess, loadAdminData, token]);

  const statusChartData = useMemo(
    () => [
      { name: 'Queued', value: systemOverview?.moderation_queue_count ?? queue.length },
      { name: 'Reviewed', value: history.length },
      { name: 'Unread', value: systemOverview?.unread_notifications_count ?? 0 },
      { name: 'Posts', value: systemOverview?.posts_count ?? finance?.posts_count ?? 0 },
      { name: 'Comments', value: systemOverview?.comments_count ?? 0 },
    ],
    [finance?.posts_count, history.length, queue.length, systemOverview]
  );

  const presenceChartData = useMemo(
    () => [
      { name: 'Online', value: presenceTelemetry?.online_users_rows ?? 0 },
      { name: 'Typing', value: presenceTelemetry?.active_typing_rows ?? 0 },
      { name: 'Total', value: presenceTelemetry?.total_presence_rows ?? 0 },
      { name: 'Stale', value: presenceTelemetry?.stale_presence_rows_estimate ?? 0 },
    ],
    [presenceTelemetry]
  );

  const roleChartData = useMemo(
    () => [
      { name: roleLabel('user'), value: 1 },
      { name: roleLabel('moderator'), value: 1 },
      { name: roleLabel('super_admin'), value: 1 },
    ],
    []
  );

  const overviewCards = useMemo(
    () => [
      { label: t('adminPosts'), value: systemOverview?.posts_count ?? finance?.posts_count ?? 0 },
      { label: t('adminComments'), value: systemOverview?.comments_count ?? 0 },
      { label: t('adminLikes'), value: systemOverview?.likes_count ?? 0 },
      { label: t('adminNotifications'), value: systemOverview?.notifications_total ?? 0 },
      { label: t('adminUnread'), value: systemOverview?.unread_notifications_count ?? 0 },
      { label: t('adminModerationQueue'), value: systemOverview?.moderation_queue_count ?? queue.length },
      { label: t('adminCampaignsCount'), value: systemOverview?.campaigns_count ?? 0 },
      { label: t('adminAdsEnabled'), value: systemOverview?.ads_enabled_count ?? 0 },
      { label: t('adminPresenceOnline'), value: systemOverview?.online_users_count ?? 0 },
      { label: t('adminPresenceActive'), value: systemOverview?.active_typing_count ?? 0 },
    ],
    [finance?.posts_count, queue.length, systemOverview, t]
  );

  const overviewUpdatedAt = useMemo(() => {
    if (!systemOverview?.updated_at) return '—';
    const parsed = new Date(systemOverview.updated_at);
    return Number.isNaN(parsed.getTime()) ? systemOverview.updated_at : parsed.toLocaleString();
  }, [systemOverview?.updated_at]);

  const updateRole = async () => {
    const target = targetUserId.trim();
    if (!target) return;
    const response = await apiFetch(`/admin/users/${target}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: targetRole }),
    });
    if (!response?.ok) {
      throw new Error('Role update failed');
    }
    if (user?.user_id === target) updateUser({ role: targetRole });
    setTargetUserId('');
    await loadAdminData();
  };

  const updateAdSetting = async (next: Partial<AdSettings>) => {
    const updated = { ...adSettings, ...next };
    setAdSettings(updated);
    const response = await apiFetch('/admin/ads/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!response?.ok) throw new Error('Ad settings update failed');
    await loadAdminData();
  };

  const updateModerationSensitivity = async (value: number) => {
    const next = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
    setModerationSettings({ sensitivity: next });
    const response = await apiFetch('/admin/moderation/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensitivity: next }),
    });
    if (!response?.ok) throw new Error('Moderation settings update failed');
    await loadAdminData();
  };

  const updateExchangeRates = async () => {
    const parsed = JSON.parse(exchangeRatesText || '{}') as Record<string, number>;
    const ratesPayload = Object.entries(parsed)
      .map(([currency, rate]) => ({ currency, rate_to_eur: Number(rate) }))
      .filter((item) => item.currency && Number.isFinite(item.rate_to_eur));
    const response = await apiFetch('/admin/exchange-rates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rates: ratesPayload }),
    });
    if (!response?.ok) throw new Error('Exchange rates update failed');
    await loadAdminData();
  };

  const refreshExchangeRates = async () => {
    const response = await apiFetch('/admin/exchange-rates/refresh', { method: 'POST' });
    if (!response?.ok) throw new Error('Exchange rates refresh failed');
    await loadAdminData();
  };

  const activePaymentSettings = paymentDraft;

  const updatePaymentSettings = async (next: AdminPaymentSettings) => {
    const updated = { ...next };
    setPaymentSettings(updated);
    const response = await apiFetch('/admin/payments/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!response?.ok) throw new Error('Payment settings update failed');
    await loadAdminData();
  };

  const updateHomepageSettings = async (next: AdminHomepageSettings) => {
    setHomepageSettings(next);
    const response = await apiFetch('/admin/homepage/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!response?.ok) throw new Error('Homepage settings update failed');
    await loadAdminData();
  };

  const uploadHomepageImage = async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const inputEl = document.createElement('input');
    inputEl.type = 'file';
    inputEl.accept = 'image/*';
    inputEl.onchange = async () => {
      const file = inputEl.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('image', file);
      const response = await apiFetch('/admin/homepage/hero-image', {
        method: 'POST',
        body: formData,
      });
      if (!response?.ok) throw new Error('Homepage image upload failed');
      const payload = await response.json();
      const next = { ...homepageDraft, hero_image_url: payload.image_url };
      setHomepageDraft(next);
      await updateHomepageSettings(next);
    };
    inputEl.click();
  };

  const createPaymentIntent = async () => {
    const response = await apiFetch('/admin/payments/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: paymentUserId.trim() || null,
        purpose: paymentPurpose.trim() || 'ad_campaign',
        reference_type: paymentPurpose.trim() || 'ad_campaign',
        reference_id: paymentReferenceId.trim() || null,
        payment_method: paymentMethod,
        amount: Number(paymentAmount || 0),
        currency: paymentCurrency.trim().toUpperCase() || activePaymentSettings.settlement_currency,
      }),
    });
    if (!response?.ok) throw new Error('Payment intent create failed');
    setPaymentUserId('');
    setPaymentReferenceId('');
    setPaymentAmount('0');
    await loadAdminData();
  };

  const adjustWalletBalance = async () => {
    const target = walletAdjustUserId.trim();
    if (!target) return;
    const response = await apiFetch(`/admin/payments/wallets/${target}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(walletAdjustAmount || 0),
        currency: walletAdjustCurrency.trim().toUpperCase() || activePaymentSettings.settlement_currency,
        reason: 'Admin adjustment',
      }),
    });
    if (!response?.ok) throw new Error('Wallet adjustment failed');
    setWalletAdjustUserId('');
    setWalletAdjustAmount('0');
    await loadAdminData();
  };

  const confirmPaymentIntent = async (paymentId: string, status: string) => {
    const nextStatus = status === 'pending_confirmation' ? 'succeeded' : 'succeeded';
    const response = await apiFetch(`/admin/payments/intents/${paymentId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!response?.ok) throw new Error('Payment confirm failed');
    await loadAdminData();
  };

  const refreshDashboard = async () => {
    await loadAdminData();
  };

  const createCampaign = async () => {
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
    if (!response?.ok) throw new Error('Campaign create failed');
    setCampaignName('');
    setCampaignAssetUrl('');
    setCampaignTargeting('');
    await loadAdminData();
  };

  const broadcastMessage = async () => {
    const message = (window.prompt('Broadcast message') || '').trim();
    if (!message) return;
    const response = await apiFetch('/admin/notifications/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response?.ok) throw new Error('Broadcast failed');
    await loadAdminData();
  };

  const deleteUser = async () => {
    const target = nukeTargetUserId.trim();
    if (!target) return;
    if (!window.confirm(`Delete ${target} permanently?`)) return;
    const response = await apiFetch(`/admin/users/${target}`, { method: 'DELETE' });
    if (!response?.ok) throw new Error('Delete failed');
    setNukeTargetUserId('');
    await loadAdminData();
  };

  const cardMetric = (labelText: string, value: string | number) => (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{labelText}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  );

  if (!user || !token) return null;
  if (!isSuperAdmin(user?.role)) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950 px-6">
        <View className="max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <Text className="text-2xl font-bold text-white">{t('adminAccessDeniedTitle')}</Text>
          <Text className="mt-3 text-slate-300">{t('adminAccessDeniedBody')}</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <View className="mx-auto w-full max-w-7xl" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
        <View className="mb-6 flex-row flex-wrap items-end justify-between gap-4">
          <View>
            <Text className="text-3xl font-black text-white">{t('dashboard')}</Text>
            <Text className="mt-2 text-slate-400">{t('adminSubtitle')}</Text>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <Pressable className={primaryButton} onPress={broadcastMessage}>
              <Text className="text-white">{t('adminBroadcast')}</Text>
            </Pressable>
            <Pressable className={secondaryButton} onPress={() => void refreshDashboard()}>
              <Text className="text-slate-100">Refresh dashboard</Text>
            </Pressable>
            <Pressable className={secondaryButton} onPress={() => void refreshExchangeRates()}>
              <Text className="text-slate-100">{t('adminRatesRefresh')}</Text>
            </Pressable>
          </View>
        </View>

        <View className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cardMetric(t('adminUsers'), finance?.users_count ?? 0)}
          {cardMetric(t('adminPosts'), finance?.posts_count ?? 0)}
          {cardMetric(t('adminModerationItems'), finance?.moderation_queue_count ?? 0)}
          {cardMetric(t('adminAdRevenue'), `${Number(finance?.ad_revenue_eur ?? 0).toFixed(2)} EUR`)}
        </View>

        <View className={`${card} mb-6`}>
          <Text className="text-lg font-semibold text-white">{t('adminSystemOverview')}</Text>
          <Text className="mt-2 text-sm text-slate-400">
            {systemOverview?.updated_at ? `${t('adminRatesUpdatedAt')}: ${systemOverview.updated_at}` : t('adminNoData')}
          </Text>
          <Text className="mt-1 text-xs uppercase tracking-wider text-slate-500">Last synced: {overviewUpdatedAt}</Text>
          <View className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {overviewCards.map((item) => cardMetric(item.label, item.value))}
          </View>
        </View>

        <View className="mb-6 grid gap-6 xl:grid-cols-2">
          <View className={card}>
            <Text className="text-lg font-semibold text-white">Etusivun hallinta</Text>
            <Text className="mt-2 text-sm text-slate-400">
              Täältä voit vaihtaa etusivun otsikon, selitteen ja kuvan.
            </Text>
            <View className="mt-4 gap-3">
              <TextInput className={input} value={homepageDraft.title} onChangeText={(value) => setHomepageDraft((current) => ({ ...current, title: value }))} placeholder="Otsikko" placeholderTextColor="#64748b" />
              <TextInput className={input} value={homepageDraft.badge} onChangeText={(value) => setHomepageDraft((current) => ({ ...current, badge: value }))} placeholder="Badge" placeholderTextColor="#64748b" />
              <TextInput className={input} value={homepageDraft.subtitle} onChangeText={(value) => setHomepageDraft((current) => ({ ...current, subtitle: value }))} placeholder="Kuvausteksti" placeholderTextColor="#64748b" multiline />
              <TextInput className={input} value={homepageDraft.hero_image_url || ''} onChangeText={(value) => setHomepageDraft((current) => ({ ...current, hero_image_url: value }))} placeholder="Kuvan URL" placeholderTextColor="#64748b" />
              <TextInput className={input} value={homepageDraft.hero_image_alt} onChangeText={(value) => setHomepageDraft((current) => ({ ...current, hero_image_alt: value }))} placeholder="Alt-teksti" placeholderTextColor="#64748b" />
            </View>
            <View className="mt-4 flex-row flex-wrap gap-3">
              <Pressable className={primaryButton} onPress={() => void updateHomepageSettings(homepageDraft)}>
                <Text className="text-white">Tallenna etusivu</Text>
              </Pressable>
              <Pressable className={secondaryButton} onPress={() => void uploadHomepageImage()}>
                <Text className="text-slate-100">Lataa kuva</Text>
              </Pressable>
            </View>
            {homepageDraft.hero_image_url ? (
              <View className="mt-4">
              <Image
                  source={{ uri: homepageDraft.hero_image_url.startsWith('http') ? homepageDraft.hero_image_url : `${BACKEND_ORIGIN}${homepageDraft.hero_image_url}` }}
                  style={{ width: '100%', height: 200, borderRadius: 16, backgroundColor: '#e2e8f0' }}
                />
              </View>
            ) : null}
          </View>
        </View>

        <View className="mb-6 grid gap-6 xl:grid-cols-2">
          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminPresenceTelemetry')}</Text>
            <View className="mt-4 grid gap-3 md:grid-cols-2">
              {cardMetric(t('adminPresenceOnline'), presenceTelemetry?.online_users_rows ?? 0)}
              {cardMetric(t('adminPresenceActive'), presenceTelemetry?.active_typing_rows ?? 0)}
              {cardMetric(t('adminPresenceStale'), presenceTelemetry?.stale_presence_rows_estimate ?? 0)}
              {cardMetric(t('adminPresenceStorage'), presenceTelemetry?.storage || t('adminNoData'))}
            </View>
            <div className="mt-6 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={presenceChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminSystemSettings')}</Text>
            <Text className="mt-2 text-sm text-slate-400">
              {t('adminRoles')}: {(systemSettings?.roles || []).join(', ') || t('adminNoData')}
            </Text>
            <Text className="mt-1 text-sm text-slate-400">
              {t('adminModerationQueue')}: {systemSettings?.moderation_queue_count ?? 0}
            </Text>
            <Text className="mt-1 text-sm text-slate-400">
              {t('adminSystemLogs')}: {systemOverview?.system_logs_count ?? 0}
            </Text>
            <Text className="mt-1 text-sm text-slate-400">
              {t('adminAuditLogs')}: {systemOverview?.audit_logs_count ?? auditLogs.length}
            </Text>
            <div className="mt-6 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusChartData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                    {statusChartData.map((entry, index) => (
                      <Cell key={entry.name} fill={['#3b82f6', '#8b5cf6', '#22c55e'][index % 3]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </View>
        </View>

        <View className="mb-6 grid gap-6 xl:grid-cols-2">
          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminRoleSwitch')}</Text>
            <View className="mt-4 gap-3">
              <TextInput className={input} value={targetUserId} onChangeText={setTargetUserId} placeholder={t('adminUserIdPlaceholder')} placeholderTextColor="#64748b" />
              <View className="flex-row flex-wrap gap-2">
                {ROLE_OPTIONS.map((role) => (
                  <Pressable
                    key={role}
                    className={`rounded-xl px-4 py-2 ${targetRole === role ? 'bg-brand-600' : 'bg-slate-800'}`}
                    onPress={() => setTargetRole(role)}
                  >
                    <Text className="text-white">{roleLabel(role)}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable className={primaryButton} onPress={() => void updateRole()}>
                <Text className="text-white">{t('adminUpdateRole')}</Text>
              </Pressable>
            </View>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminOverride')}</Text>
            <Text className="mt-2 text-sm text-slate-400">{t('adminOverrideDescription')}</Text>
            <View className="mt-4 gap-3">
              <TextInput className={input} value={nukeTargetUserId} onChangeText={setNukeTargetUserId} placeholder={t('adminOverrideTargetPlaceholder')} placeholderTextColor="#64748b" />
              <Pressable className={dangerButton} onPress={() => void deleteUser()}>
                <Text className="text-white">{t('adminNukeUser')}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className="mb-6 grid gap-6 xl:grid-cols-2">
          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminAds')}</Text>
            <View className="mt-4 grid gap-3 md:grid-cols-2">
              <Pressable className={`rounded-xl p-4 ${adSettings.in_feed_enabled ? 'bg-brand-700' : 'bg-slate-800'}`} onPress={() => void updateAdSetting({ in_feed_enabled: !adSettings.in_feed_enabled })}>
                <Text className="font-semibold text-white">{t('adminInFeedAds')}</Text>
                <Text className="text-xs text-slate-200">{adSettings.in_feed_enabled ? t('enabled') : t('disabled')}</Text>
              </Pressable>
              <Pressable className={`rounded-xl p-4 ${adSettings.sidebar_enabled ? 'bg-brand-700' : 'bg-slate-800'}`} onPress={() => void updateAdSetting({ sidebar_enabled: !adSettings.sidebar_enabled })}>
                <Text className="font-semibold text-white">{t('adminSidebarAds')}</Text>
                <Text className="text-xs text-slate-200">{adSettings.sidebar_enabled ? t('enabled') : t('disabled')}</Text>
              </Pressable>
              <Pressable className={`rounded-xl p-4 ${adSettings.interstitial_enabled ? 'bg-brand-700' : 'bg-slate-800'}`} onPress={() => void updateAdSetting({ interstitial_enabled: !adSettings.interstitial_enabled })}>
                <Text className="font-semibold text-white">{t('adminInterstitialAds')}</Text>
                <Text className="text-xs text-slate-200">{adSettings.interstitial_enabled ? t('enabled') : t('disabled')}</Text>
              </Pressable>
              <Pressable className={`rounded-xl p-4 ${adSettings.ad_network_enabled ? 'bg-brand-700' : 'bg-slate-800'}`} onPress={() => void updateAdSetting({ ad_network_enabled: !adSettings.ad_network_enabled })}>
                <Text className="font-semibold text-white">{t('adminAdNetwork')}</Text>
                <Text className="text-xs text-slate-200">{adSettings.ad_network_enabled ? t('enabled') : t('disabled')}</Text>
              </Pressable>
            </View>
            <View className="mt-4 gap-3">
              <TextInput className={input} value={String(adSettings.in_feed_frequency)} onChangeText={(value) => void updateAdSetting({ in_feed_frequency: Number(value || 5) })} keyboardType="numeric" placeholder={t('adminAdFrequencyPlaceholder')} placeholderTextColor="#64748b" />
              <TextInput className={input} value={adSettings.ad_network_tag} onChangeText={(value) => void updateAdSetting({ ad_network_tag: value })} placeholder={t('adminAdTagPlaceholder')} placeholderTextColor="#64748b" />
            </View>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminCampaigns')}</Text>
            <View className="mt-4 gap-3">
              <TextInput className={input} value={campaignName} onChangeText={setCampaignName} placeholder={t('adminCampaignNamePlaceholder')} placeholderTextColor="#64748b" />
              <TextInput className={input} value={campaignAssetUrl} onChangeText={setCampaignAssetUrl} placeholder={t('adminCampaignAssetPlaceholder')} placeholderTextColor="#64748b" />
              <TextInput className={input} value={campaignCurrency} onChangeText={setCampaignCurrency} placeholder={t('adminCampaignCurrencyPlaceholder')} placeholderTextColor="#64748b" />
              <TextInput className={input} value={campaignBudget} onChangeText={setCampaignBudget} keyboardType="numeric" placeholder={t('adminCampaignBudgetPlaceholder')} placeholderTextColor="#64748b" />
              <TextInput className={input} value={campaignPlacements} onChangeText={setCampaignPlacements} placeholder={t('adminCampaignPlacementsPlaceholder')} placeholderTextColor="#64748b" />
              <TextInput className={input} value={campaignTargeting} onChangeText={setCampaignTargeting} multiline placeholder={t('adminCampaignTargetingPlaceholder')} placeholderTextColor="#64748b" />
              <Pressable className={primaryButton} onPress={() => void createCampaign()}>
                <Text className="text-white">{t('adminCreateCampaign')}</Text>
              </Pressable>
            </View>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminAiSensitivity')}</Text>
            <Text className="mt-2 text-sm text-slate-400">{t('adminCurrentLevel')}: {moderationSettings.sensitivity}</Text>
            <View className="mt-4 gap-3">
              <TextInput className={input} keyboardType="numeric" value={String(moderationSettings.sensitivity)} onChangeText={(value) => setModerationSettings({ sensitivity: Number(value || 50) })} onEndEditing={() => void updateModerationSensitivity(moderationSettings.sensitivity)} placeholder={t('adminSensitivityPlaceholder')} placeholderTextColor="#64748b" />
              <View className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={roleChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" stroke="#cbd5e1" />
                    <YAxis stroke="#cbd5e1" />
                    <Tooltip />
                    <Bar dataKey="value" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </View>
            </View>
          </View>
        </View>

        <View className="mb-6 grid gap-6 xl:grid-cols-2">
          <View className={card}>
            <Text className="text-lg font-semibold text-white">Payments</Text>
            <Text className="mt-2 text-sm text-slate-400">Card, wallet and crypto support share one payment config.</Text>
            <View className="mt-4 grid gap-3 md:grid-cols-3">
              <Pressable className={`rounded-xl p-4 ${activePaymentSettings.card_enabled ? 'bg-brand-700' : 'bg-slate-800'}`} onPress={() => setPaymentDraft((current) => ({ ...current, card_enabled: !current.card_enabled }))}>
                <Text className="font-semibold text-white">Card</Text>
                <Text className="text-xs text-slate-200">{activePaymentSettings.card_enabled ? t('enabled') : t('disabled')}</Text>
              </Pressable>
              <Pressable className={`rounded-xl p-4 ${activePaymentSettings.wallet_enabled ? 'bg-brand-700' : 'bg-slate-800'}`} onPress={() => setPaymentDraft((current) => ({ ...current, wallet_enabled: !current.wallet_enabled }))}>
                <Text className="font-semibold text-white">Wallet</Text>
                <Text className="text-xs text-slate-200">{activePaymentSettings.wallet_enabled ? t('enabled') : t('disabled')}</Text>
              </Pressable>
              <Pressable className={`rounded-xl p-4 ${activePaymentSettings.crypto_enabled ? 'bg-brand-700' : 'bg-slate-800'}`} onPress={() => setPaymentDraft((current) => ({ ...current, crypto_enabled: !current.crypto_enabled }))}>
                <Text className="font-semibold text-white">Crypto</Text>
                <Text className="text-xs text-slate-200">{activePaymentSettings.crypto_enabled ? t('enabled') : t('disabled')}</Text>
              </Pressable>
            </View>
            <View className="mt-4 gap-3">
              <TextInput className={input} value={activePaymentSettings.card_provider} onChangeText={(value) => setPaymentDraft((current) => ({ ...current, card_provider: value }))} placeholder="Card provider" placeholderTextColor="#64748b" />
              <TextInput className={input} value={activePaymentSettings.wallet_provider} onChangeText={(value) => setPaymentDraft((current) => ({ ...current, wallet_provider: value }))} placeholder="Wallet provider" placeholderTextColor="#64748b" />
              <TextInput className={input} value={activePaymentSettings.crypto_provider} onChangeText={(value) => setPaymentDraft((current) => ({ ...current, crypto_provider: value }))} placeholder="Crypto provider" placeholderTextColor="#64748b" />
              <TextInput className={input} value={activePaymentSettings.settlement_currency} onChangeText={(value) => setPaymentDraft((current) => ({ ...current, settlement_currency: value.toUpperCase() || 'EUR' }))} placeholder="Settlement currency" placeholderTextColor="#64748b" />
              <TextInput className={input} value={activePaymentSettings.supported_currencies.join(', ')} onChangeText={(value) => setPaymentDraft((current) => ({ ...current, supported_currencies: value.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean) }))} placeholder="Supported currencies (EUR, USD, BTC)" placeholderTextColor="#64748b" />
              <Pressable className={secondaryButton} onPress={() => setPaymentDraft((current) => ({ ...current, wallet_topup_enabled: !current.wallet_topup_enabled }))}>
                <Text className="text-slate-100">
                  Wallet top-up: {activePaymentSettings.wallet_topup_enabled ? t('enabled') : t('disabled')}
                </Text>
              </Pressable>
            </View>
            <View className="mt-4 flex-row flex-wrap gap-3">
              <Pressable className={primaryButton} onPress={() => void updatePaymentSettings(activePaymentSettings)}>
                <Text className="text-white">Save payment config</Text>
              </Pressable>
            </View>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">Payment summary</Text>
            <View className="mt-4 grid gap-3 md:grid-cols-2">
              {cardMetric('Payment intents', paymentSummary?.intents_count ?? finance?.payment_intents_count ?? 0)}
              {cardMetric('Wallets', paymentSummary?.wallets_count ?? 0)}
              {cardMetric('Wallet total', `${Number(paymentSummary?.wallet_balance_total ?? finance?.wallet_balance_total ?? 0).toFixed(2)} EUR`)}
              {cardMetric('Methods', [
                activePaymentSettings.card_enabled ? 'card' : null,
                activePaymentSettings.wallet_enabled ? 'wallet' : null,
                activePaymentSettings.crypto_enabled ? 'crypto' : null,
              ].filter(Boolean).join(', ') || 'none')}
            </View>
            <View className="mt-4 gap-3">
              <TextInput className={input} value={paymentUserId} onChangeText={setPaymentUserId} placeholder="User user_id" placeholderTextColor="#64748b" />
              <TextInput className={input} value={paymentPurpose} onChangeText={setPaymentPurpose} placeholder="Purpose: ad_campaign, wallet_topup" placeholderTextColor="#64748b" />
              <TextInput className={input} value={paymentReferenceId} onChangeText={setPaymentReferenceId} placeholder="Reference id" placeholderTextColor="#64748b" />
              <TextInput className={input} value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="numeric" placeholder="Amount" placeholderTextColor="#64748b" />
              <TextInput className={input} value={paymentCurrency} onChangeText={setPaymentCurrency} placeholder="Currency" placeholderTextColor="#64748b" />
              <View className="flex-row flex-wrap gap-2">
                {(['card', 'wallet', 'crypto'] as const).map((method) => (
                  <Pressable key={method} className={`rounded-xl px-4 py-2 ${paymentMethod === method ? 'bg-brand-600' : 'bg-slate-800'}`} onPress={() => setPaymentMethod(method)}>
                    <Text className="text-white">{method}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable className={primaryButton} onPress={() => void createPaymentIntent()}>
                <Text className="text-white">Create payment intent</Text>
              </Pressable>
            </View>
            <View className="mt-6 border-t border-slate-800 pt-4">
              <Text className="text-sm font-semibold text-white">Recent intents</Text>
              <View className="mt-3 gap-3">
                {(paymentSummary?.recent_intents || []).slice(0, 5).map((intent) => (
                  <View key={intent.payment_id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <Text className="text-sm font-semibold text-white">{intent.payment_method} · {intent.status}</Text>
                    <Text className="mt-1 text-xs text-slate-400">{intent.amount} {intent.currency} · {intent.purpose}</Text>
                    <Text className="mt-1 text-xs text-slate-500">{intent.payment_id}</Text>
                    {intent.status === 'pending_confirmation' ? (
                      <Pressable className={`${secondaryButton} mt-3`} onPress={() => void confirmPaymentIntent(intent.payment_id, intent.status)}>
                        <Text className="text-slate-100">Confirm crypto payment</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
            <View className="mt-6 border-t border-slate-800 pt-4">
              <Text className="text-sm font-semibold text-white">Wallet adjustment</Text>
              <View className="mt-3 gap-3">
                <TextInput className={input} value={walletAdjustUserId} onChangeText={setWalletAdjustUserId} placeholder="Wallet user_id" placeholderTextColor="#64748b" />
                <TextInput className={input} value={walletAdjustAmount} onChangeText={setWalletAdjustAmount} keyboardType="numeric" placeholder="Adjustment amount" placeholderTextColor="#64748b" />
                <TextInput className={input} value={walletAdjustCurrency} onChangeText={setWalletAdjustCurrency} placeholder="Currency" placeholderTextColor="#64748b" />
                <Pressable className={secondaryButton} onPress={() => void adjustWalletBalance()}>
                  <Text className="text-slate-100">Apply wallet adjustment</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        <View className="mb-6 grid gap-6 xl:grid-cols-2">
          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminFinance')}</Text>
            <Text className="mt-2 text-sm text-slate-400">Payments and ads are tracked together here.</Text>
            <div className="mt-4 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { name: 'Users', value: finance?.users_count ?? 0 },
                  { name: 'Posts', value: finance?.posts_count ?? 0 },
                  { name: 'Queue', value: finance?.moderation_queue_count ?? 0 },
                  { name: 'Payments', value: finance?.payment_intents_count ?? 0 },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminExchangeRates')}</Text>
            <Text className="mt-2 text-xs text-slate-400">{exchangeRatesUpdatedAt ? `${t('adminRatesUpdatedAt')}: ${exchangeRatesUpdatedAt}` : t('adminNoData')}</Text>
            <TextInput
              className={`${input} mt-4 min-h-48 font-mono`}
              multiline
              numberOfLines={8}
              value={exchangeRatesText}
              onChangeText={setExchangeRatesText}
              placeholder={t('adminExchangeRatesPlaceholder')}
              placeholderTextColor="#64748b"
            />
            <View className="mt-4 flex-row flex-wrap gap-3">
              <Pressable className={primaryButton} onPress={() => void updateExchangeRates()}>
                <Text className="text-white">{t('adminSaveRates')}</Text>
              </Pressable>
              <Pressable className={secondaryButton} onPress={() => void refreshExchangeRates()}>
                <Text className="text-slate-100">{t('adminRefreshRates')}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className="mb-6 grid gap-6 xl:grid-cols-2">
          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminModerationQueue')}</Text>
            <Text className="mt-2 text-sm text-slate-400">{t('adminQueueCount')}: {queue.length}</Text>
            <View className="mt-4 space-y-3">
              {queue.slice(0, 5).map((item) => (
                <View key={item.moderation_id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <Text className="text-sm font-semibold text-white">{item.target_type} · {item.status}</Text>
                  <Text className="mt-1 text-xs text-slate-400">{item.reason || t('adminNoData')}</Text>
                  <Text className="mt-2 text-xs text-slate-500">{item.text || t('adminNoData')}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">{t('adminAuditLogs')}</Text>
            <View className="mt-4 space-y-3">
              {auditLogs.slice(0, 6).map((log) => (
                <View key={log.log_id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <Text className="text-sm font-semibold text-white">{log.component} · {log.level}</Text>
                  <Text className="mt-1 text-xs text-slate-400">{log.message}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {loading ? (
          <View className="flex-row items-center gap-3">
            <ActivityIndicator color="#3b82f6" />
            <Text className="text-sm text-slate-400">{t('adminLoading')}</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
