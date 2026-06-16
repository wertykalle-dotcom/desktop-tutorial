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
import { Ionicons } from '@expo/vector-icons';
import type { CreatorLevel, DailyTrendsPayload } from '../../src/features/growth/growthTypes';
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
const campaignInput = 'w-full rounded-xl border border-slate-700 bg-[#07111f] px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[#0F62FE] focus:shadow-[0_0_0_3px_rgba(15,98,254,0.22)]';
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
const fundingTiers = [
  { id: 'launch', label: 'Taso 1', amount: 75000, title: 'Lanseeraus' },
  { id: 'mobile', label: 'Taso 2', amount: 100000, title: 'Mobiiliskaalaus' },
  { id: 'national', label: 'Taso 3', amount: 250000, title: 'Valtakunnallinen laajennus' },
];
const editorTools: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'text', label: 'Teksti' },
  { icon: 'list', label: 'Lista' },
  { icon: 'chatbox-ellipses-outline', label: 'Lainaus' },
  { icon: 'link', label: 'Linkki' },
];

type AdminGrowthOverview = {
  generated_at: string;
  daily_trends: DailyTrendsPayload;
  creator_levels: CreatorLevel[];
  moderation: { trend_posts_reviewable: number; note: string };
};

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
    moderationAnalytics,
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
  const [campaignAssetType, setCampaignAssetType] = useState<'image' | 'video'>('image');
  const [campaignVideoUrl, setCampaignVideoUrl] = useState('');
  const [campaignDescription, setCampaignDescription] = useState('');
  const [campaignTargeting, setCampaignTargeting] = useState('');
  const [campaignBudget, setCampaignBudget] = useState('75000');
  const [selectedFundingTierId, setSelectedFundingTierId] = useState('launch');
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
  const [growthOverview, setGrowthOverview] = useState<AdminGrowthOverview | null>(null);

  useEffect(() => {
    setPaymentDraft(paymentSettings ?? defaultPaymentSettings);
  }, [paymentSettings]);

  useEffect(() => {
    setHomepageDraft(homepageSettings ?? defaultHomepageSettings);
  }, [homepageSettings]);

  useEffect(() => {
    if (!token || !canAccess) return undefined;
    const loadGrowth = async () => {
      const response = await apiFetch('/admin/growth/overview');
      if (response?.ok) {
        setGrowthOverview(await response.json());
      }
    };
    void loadGrowth();
    const intervalId = setInterval(() => {
      void loadAdminData();
      void loadGrowth();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [apiFetch, canAccess, loadAdminData, token]);

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

  const selectedFundingTier = fundingTiers.find((tier) => tier.id === selectedFundingTierId) || fundingTiers[0];
  const campaignPreviewAssetUrl = campaignAssetUrl
    ? (campaignAssetUrl.startsWith('http') || campaignAssetUrl.startsWith('blob:') ? campaignAssetUrl : `${BACKEND_ORIGIN}${campaignAssetUrl}`)
    : '';

  const selectFundingTier = (tier: typeof fundingTiers[number]) => {
    setSelectedFundingTierId(tier.id);
    setCampaignBudget(String(tier.amount));
  };

  const uploadCampaignAsset = async (file: File) => {
    const formData = new FormData();
    formData.append('asset', file);
    const response = await apiFetch('/admin/ads/campaign-asset', {
      method: 'POST',
      body: formData,
    });
    if (!response?.ok) throw new Error('Campaign asset upload failed');
    const payload = await response.json();
    setCampaignAssetUrl(payload.asset_url || '');
    setCampaignAssetType(payload.asset_type === 'video' ? 'video' : 'image');
  };

  const pickCampaignAsset = () => {
    if (typeof document === 'undefined') return;
    const inputEl = document.createElement('input');
    inputEl.type = 'file';
    inputEl.accept = 'image/*,video/mp4,video/webm,video/quicktime';
    inputEl.onchange = () => {
      const file = inputEl.files?.[0];
      if (file) void uploadCampaignAsset(file);
    };
    inputEl.click();
  };

  const handleCampaignDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadCampaignAsset(file);
  };

  const createCampaign = async () => {
    const targetingPayload = campaignTargeting.trim() ? JSON.parse(campaignTargeting) : {};
    const response = await apiFetch('/admin/ads/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName.trim(),
        asset_url: (campaignVideoUrl.trim() || campaignAssetUrl.trim()) || null,
        asset_type: campaignVideoUrl.trim() ? 'video' : campaignAssetType,
        currency: campaignCurrency.trim() || 'EUR',
        targeting: {
          ...targetingPayload,
          description: campaignDescription.trim(),
          video_url: campaignVideoUrl.trim() || null,
          funding_tier: selectedFundingTier,
        },
        budget: Number(campaignBudget || selectedFundingTier.amount),
        placements: campaignPlacements.split(',').map((item) => item.trim()).filter(Boolean),
      }),
    });
    if (!response?.ok) throw new Error('Campaign create failed');
    setCampaignName('');
    setCampaignAssetUrl('');
    setCampaignVideoUrl('');
    setCampaignDescription('');
    setCampaignTargeting('');
    setCampaignBudget('75000');
    setSelectedFundingTierId('launch');
    await loadAdminData();
  };

  const broadcastMessage = async () => {
    const message = (window.prompt(t('adminBroadcastMessagePrompt')) || '').trim();
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
              <Text className="text-slate-100">{t('adminRefreshDashboard')}</Text>
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
          <Text className="mt-1 text-xs uppercase tracking-wider text-slate-500">{t('adminLastSynced')}: {overviewUpdatedAt}</Text>
          <View className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {overviewCards.map((item) => cardMetric(item.label, item.value))}
          </View>
        </View>

        <View className={`${card} mb-6`}>
          <View className="flex-row flex-wrap items-start justify-between gap-3">
            <View>
              <Text className="text-lg font-semibold text-white">YOSLA Growth Overview</Text>
              <Text className="mt-2 text-sm text-slate-400">
                Achievements, Daily Trends ja Creator Levels moderation-näkymässä.
              </Text>
            </View>
            <View className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <Text className="text-xs font-bold uppercase tracking-wider text-amber-200">
                Review {growthOverview?.moderation?.trend_posts_reviewable ?? 0}
              </Text>
            </View>
          </View>
          <View className="mt-4 grid gap-4 lg:grid-cols-2">
            <View className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <Text className="text-sm font-bold uppercase tracking-wider text-slate-300">Daily Trends</Text>
              <View className="mt-3 gap-3">
                {(growthOverview?.daily_trends?.posts || []).slice(0, 5).map((trend, index) => (
                  <View key={trend.post_id || `${trend.title}-${index}`} className="flex-row items-center gap-3 rounded-xl bg-slate-900 p-3">
                    <Text className="w-8 text-lg font-black text-rose-300">#{index + 1}</Text>
                    <View className="flex-1">
                      <Text className="font-bold text-white" numberOfLines={1}>{trend.title}</Text>
                      <Text className="mt-1 text-xs text-slate-400">Score {trend.score} · {trend.comments_count} comments · {trend.views} views</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            <View className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <Text className="text-sm font-bold uppercase tracking-wider text-slate-300">Creator Levels</Text>
              <View className="mt-3 gap-3">
                {(growthOverview?.creator_levels || []).slice(0, 5).map((creator) => (
                  <View key={creator.user_id || creator.username} className="rounded-xl bg-slate-900 p-3">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="font-bold text-white">@{creator.username || 'creator'}</Text>
                      <Text className="rounded-full bg-blue-600 px-2 py-1 text-xs font-black text-white">Lv {creator.level}</Text>
                    </View>
                    <Text className="mt-1 text-xs text-slate-400">{creator.name} · {Math.round(creator.score)} rank points</Text>
                    <View className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                      <View className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(4, Math.min(100, Number(creator.progress || 0)))}%` }} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
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

          <View className="xl:col-span-2 overflow-hidden rounded-2xl border border-slate-800 bg-[#050816] shadow-2xl shadow-black/30">
            <View className="border-b border-slate-800 bg-slate-950/70 px-6 py-5">
              <Text className="text-xs font-black uppercase tracking-[0.25em] text-[#0F62FE]">Campaign Studio</Text>
              <Text className="mt-2 text-2xl font-black text-white">{t('adminCampaigns')}</Text>
              <Text className="mt-2 max-w-3xl text-sm text-slate-400">Rakenna premium-kampanja, määritä rahoitustasot ja tarkista backer-näkymä reaaliajassa.</Text>
            </View>

            <View className="grid gap-0 xl:grid-cols-[minmax(0,65fr)_minmax(320px,35fr)]">
              <View className="space-y-5 p-6">
                <div
                  className="group flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-600 bg-[#07111f] p-6 text-center transition hover:border-[#0F62FE] hover:shadow-[0_0_0_3px_rgba(15,98,254,0.18)]"
                  onClick={pickCampaignAsset}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleCampaignDrop}
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0F62FE]/15 text-[#60a5fa]">
                    <Ionicons name="cloud-upload-outline" size={28} color="#60a5fa" />
                  </div>
                  <Text className="mt-4 text-lg font-black text-white">Media Dropzone</Text>
                  <Text className="mt-2 max-w-md text-sm text-slate-400">Raahaa tähän korkean resoluution kampanjakuva tai lyhyt looppaava video. Voit myös klikata valitaksesi tiedoston.</Text>
                  <Text className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-500">PNG, JPG, WEBP, MP4, WEBM</Text>
                </div>

                <View className="grid gap-4 md:grid-cols-2">
                  <View>
                    <Text className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Kampanjan nimi</Text>
                    <TextInput className={campaignInput} value={campaignName} onChangeText={setCampaignName} placeholder="YOSLA kasvurahoitus" placeholderTextColor="#64748b" />
                  </View>
                  <View>
                    <Text className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Kampanja-videon osoite</Text>
                    <TextInput className={campaignInput} value={campaignVideoUrl} onChangeText={(value) => { setCampaignVideoUrl(value); if (value.trim()) setCampaignAssetType('video'); }} placeholder="https://.../campaign-loop.mp4" placeholderTextColor="#64748b" />
                  </View>
                  <View>
                    <Text className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Valuutta</Text>
                    <TextInput className={campaignInput} value={campaignCurrency} onChangeText={setCampaignCurrency} placeholder="EUR" placeholderTextColor="#64748b" />
                  </View>
                  <View>
                    <Text className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Sijoittelut</Text>
                    <TextInput className={campaignInput} value={campaignPlacements} onChangeText={setCampaignPlacements} placeholder="in_feed, sidebar" placeholderTextColor="#64748b" />
                  </View>
                </View>

                <View className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <View className="mb-3 flex-row items-center justify-between">
                    <Text className="text-sm font-black uppercase tracking-wider text-slate-300">Rahoitustavoitteet</Text>
                    <Text className="rounded-full bg-[#0F62FE]/15 px-3 py-1 text-xs font-black text-[#93c5fd]">{Number(campaignBudget || selectedFundingTier.amount).toLocaleString('fi-FI')} €</Text>
                  </View>
                  <View className="grid gap-3 md:grid-cols-3">
                    {fundingTiers.map((tier) => {
                      const active = tier.id === selectedFundingTierId;
                      return (
                        <Pressable
                          key={tier.id}
                          className={`rounded-2xl border p-4 transition ${active ? 'border-[#0F62FE] bg-[#0F62FE]/15 shadow-[0_0_0_3px_rgba(15,98,254,0.16)]' : 'border-slate-800 bg-[#07111f]'}`}
                          onPress={() => selectFundingTier(tier)}
                        >
                          <Text className={`text-xs font-black uppercase tracking-wider ${active ? 'text-[#93c5fd]' : 'text-slate-500'}`}>{tier.label}</Text>
                          <Text className="mt-2 text-xl font-black text-white">{tier.amount.toLocaleString('fi-FI')} €</Text>
                          <Text className="mt-1 text-sm font-bold text-slate-300">{tier.title}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-[#0F62FE]" style={{ width: `${Math.min(100, (Number(campaignBudget || 0) / 250000) * 100)}%` }} />
                  </div>
                </View>

                <View className="rounded-2xl border border-slate-800 bg-[#07111f]">
                  <View className="flex-row flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
                    {editorTools.map((tool) => (
                      <Pressable key={tool.label} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800">
                        <Ionicons name={tool.icon} size={17} color="#94a3b8" />
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    className="min-h-[180px] w-full px-4 py-4 text-base leading-7 text-slate-100 outline-none placeholder:text-slate-500"
                    value={campaignDescription}
                    onChangeText={setCampaignDescription}
                    multiline
                    textAlignVertical="top"
                    placeholder="Kampanjan pitkä kuvausteksti: kerro visio, mihin rahoitus käytetään ja miksi backerit liittyvät mukaan."
                    placeholderTextColor="#64748b"
                  />
                </View>

                <TextInput className={campaignInput} value={campaignTargeting} onChangeText={setCampaignTargeting} multiline placeholder={t('adminCampaignTargetingPlaceholder')} placeholderTextColor="#64748b" />

                <Pressable className="inline-flex items-center justify-center rounded-xl bg-[#0F62FE] px-5 py-4 font-black text-white transition hover:bg-[#2563eb]" onPress={() => void createCampaign()}>
                  <Text className="text-base font-black text-white">{t('adminCreateCampaign')}</Text>
                </Pressable>
              </View>

              <View className="border-t border-slate-800 bg-slate-950/70 p-6 xl:border-l xl:border-t-0">
                <div className="sticky top-6">
                  <Text className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-slate-500">Live preview</Text>
                  <View className="overflow-hidden rounded-2xl border border-slate-800 bg-[#07111f] shadow-xl shadow-black/30">
                    <View className="aspect-video bg-slate-900">
                      {campaignPreviewAssetUrl ? (
                        campaignAssetType === 'video' || campaignVideoUrl.trim() ? (
                          React.createElement('video', {
                            src: campaignVideoUrl.trim() || campaignPreviewAssetUrl,
                            autoPlay: true,
                            muted: true,
                            loop: true,
                            playsInline: true,
                            style: { width: '100%', height: '100%', objectFit: 'cover' },
                          })
                        ) : (
                          <Image source={{ uri: campaignPreviewAssetUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        )
                      ) : (
                        <View className="flex h-full w-full items-center justify-center">
                          <Ionicons name="image-outline" size={42} color="#475569" />
                        </View>
                      )}
                    </View>
                    <View className="p-5">
                      <Text className="text-xs font-black uppercase tracking-wider text-[#60a5fa]">{selectedFundingTier.title}</Text>
                      <Text className="mt-2 text-2xl font-black text-white">{campaignName || 'YOSLA SOME LIFE - kasvukampanja'}</Text>
                      <Text className="mt-3 text-sm leading-6 text-slate-300" numberOfLines={4}>
                        {campaignDescription || 'Tämä preview näyttää, miltä kampanja näyttää backereille. Lisää kuva, nimi ja pitkä kuvaus nähdäksesi valmiin kortin.'}
                      </Text>
                      <View className="mt-5 rounded-2xl bg-slate-950 p-4">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-xs font-black uppercase tracking-wider text-slate-500">Tavoite</Text>
                          <Text className="text-sm font-black text-white">{selectedFundingTier.amount.toLocaleString('fi-FI')} €</Text>
                        </View>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full w-[32%] rounded-full bg-[#0F62FE]" />
                        </div>
                      </View>
                    </View>
                  </View>
                </div>
              </View>
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
            <Text className="text-lg font-semibold text-white">Moderation Analytics</Text>
            <Text className="mt-2 text-sm text-slate-400">Copyright, music risk and Trust Score signals.</Text>
            <View className="mt-4 grid gap-3 md:grid-cols-3">
              {[
                ['Copyright today', moderationAnalytics?.copyright_reports_today ?? 0],
                ['Music today', moderationAnalytics?.music_reports_today ?? 0],
                ['Trust events', moderationAnalytics?.trust_events_today ?? 0],
                ['Pending', moderationAnalytics?.pending_count ?? queue.length],
                ['Reviewed', moderationAnalytics?.reviewed_count ?? history.length],
                ['Total', moderationAnalytics?.total_items ?? queue.length + history.length],
              ].map(([label, value]) => (
                <View key={String(label)} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <Text className="text-xs font-semibold uppercase text-slate-500">{label}</Text>
                  <Text className="mt-1 text-2xl font-black text-white">{value}</Text>
                </View>
              ))}
            </View>
            <View className="mt-5 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={Object.entries(moderationAnalytics?.by_status || {}).map(([name, value]) => ({ name, value }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </View>
          </View>

          <View className={card}>
            <Text className="text-lg font-semibold text-white">Repeat Offenders</Text>
            <Text className="mt-2 text-sm text-slate-400">Users with repeated moderation signals.</Text>
            <View className="mt-4 space-y-3">
              {(moderationAnalytics?.repeat_offenders || []).slice(0, 6).length === 0 ? (
                <Text className="text-sm text-slate-500">{t('adminNoData')}</Text>
              ) : (moderationAnalytics?.repeat_offenders || []).slice(0, 6).map((item) => (
                <View key={item.user_id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <Text className="text-sm font-semibold text-white">{item.user_id}</Text>
                  <Text className="mt-1 text-xs text-slate-400">Reports: {item.count} · {item.latest_reason || t('adminNoData')}</Text>
                  <Text className="mt-1 text-xs text-slate-500">{item.latest_at || t('adminNoData')}</Text>
                </View>
              ))}
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
