import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useApiClient } from './useApiClient';
import { isSuperAdmin } from '../utils/roles';

export type AdminQueueItem = {
  moderation_id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  post_id?: string | null;
  user_id: string;
  score: number;
  status: string;
  reason?: string | null;
  text?: string | null;
  created_at: string;
};

export type AdminAdSettings = {
  in_feed_enabled: boolean;
  in_feed_frequency: number;
  sidebar_enabled: boolean;
  interstitial_enabled: boolean;
  ad_network_enabled: boolean;
  ad_network_tag: string;
};

export type AdminModerationSettings = {
  sensitivity: number;
};

export type AdminAuditLog = {
  log_id: string;
  level: string;
  component: string;
  message: string;
  details?: string;
  actor_id?: string | null;
  subject_id?: string | null;
  created_at: string;
};

export type AdminPresenceTelemetry = {
  storage: string;
  total_presence_rows: number;
  active_typing_rows: number;
  online_users_rows?: number;
  stale_presence_rows_estimate: number;
  ttl_seconds: number;
  online_ttl_seconds?: number;
  cutoff: string;
};

export type AdminFinance = {
  users_count?: number;
  posts_count?: number;
  moderation_queue_count?: number;
  payment_intents_count?: number;
  wallet_balance_total?: number;
  ad_revenue_eur?: number;
};

export type AdminPaymentSettings = {
  card_enabled: boolean;
  wallet_enabled: boolean;
  crypto_enabled: boolean;
  card_provider: string;
  wallet_provider: string;
  crypto_provider: string;
  settlement_currency: string;
  wallet_topup_enabled: boolean;
  supported_currencies: string[];
};

export type AdminPaymentIntent = {
  payment_id: string;
  user_id?: string | null;
  purpose: string;
  reference_type?: string | null;
  reference_id?: string | null;
  payment_method: string;
  amount: number;
  currency: string;
  status: string;
  provider?: string | null;
  provider_reference?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AdminPaymentSummary = {
  intents_count: number;
  wallets_count: number;
  wallet_balance_total: number;
  recent_intents: AdminPaymentIntent[];
  recent_wallets: {
    wallet_id: string;
    user_id: string;
    currency: string;
    balance: number;
    updated_at: string;
  }[];
};

export type AdminHomepageSettings = {
  title: string;
  subtitle: string;
  badge: string;
  hero_image_url?: string | null;
  hero_image_alt: string;
};

export type AdminSystemOverview = {
  posts_count?: number;
  comments_count?: number;
  likes_count?: number;
  notifications_total?: number;
  unread_notifications_count?: number;
  moderation_queue_count?: number;
  campaigns_count?: number;
  audit_logs_count?: number;
  system_logs_count?: number;
  ads_enabled_count?: number;
  online_users_count?: number;
  active_typing_count?: number;
  stale_presence_count?: number;
  storage?: string;
  updated_at?: string;
};

export type AdminModerationAnalytics = {
  generated_at: string;
  total_items: number;
  pending_count: number;
  reviewed_count: number;
  copyright_reports_today: number;
  music_reports_today: number;
  trust_events_today: number;
  by_status: Record<string, number>;
  by_reason: Record<string, number>;
  repeat_offenders: {
    user_id: string;
    count: number;
    latest_reason?: string;
    latest_at?: string | null;
  }[];
  priority_queue: AdminQueueItem[];
};

export type AdminCampaign = {
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

export function useAdminDashboardData() {
  const { user, token } = useAuth();
  const { apiFetch } = useApiClient();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<AdminQueueItem[]>([]);
  const [history, setHistory] = useState<AdminQueueItem[]>([]);
  const [systemSettings, setSystemSettings] = useState<{ roles?: string[]; moderation_queue_count?: number } | null>(null);
  const [finance, setFinance] = useState<AdminFinance | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<AdminPaymentSettings | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<AdminPaymentSummary | null>(null);
  const [homepageSettings, setHomepageSettings] = useState<AdminHomepageSettings | null>(null);
  const [campaigns, setCampaigns] = useState<AdminCampaign[]>([]);
  const [adSettings, setAdSettings] = useState<AdminAdSettings>({
    in_feed_enabled: false,
    in_feed_frequency: 5,
    sidebar_enabled: false,
    interstitial_enabled: false,
    ad_network_enabled: false,
    ad_network_tag: '',
  });
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [presenceTelemetry, setPresenceTelemetry] = useState<AdminPresenceTelemetry | null>(null);
  const [moderationSettings, setModerationSettings] = useState<AdminModerationSettings>({ sensitivity: 50 });
  const [exchangeRatesText, setExchangeRatesText] = useState('');
  const [exchangeRatesUpdatedAt, setExchangeRatesUpdatedAt] = useState('');
  const [systemOverview, setSystemOverview] = useState<AdminSystemOverview | null>(null);
  const [moderationAnalytics, setModerationAnalytics] = useState<AdminModerationAnalytics | null>(null);

  const canAccess = isSuperAdmin(user?.role);

  const loadAdminData = useCallback(async () => {
    if (!token || !canAccess) return;
    setLoading(true);
    try {
      const [
        settingsResp,
        financeResp,
        queueResp,
        adsResp,
        auditResp,
        moderationResp,
        ratesResp,
        presenceResp,
        historyResp,
        logsResp,
        campaignsResp,
        overviewResp,
        paymentSettingsResp,
        paymentSummaryResp,
        homepageSettingsResp,
        moderationAnalyticsResp,
      ] = await Promise.all([
        apiFetch('/admin/system-settings'),
        apiFetch('/admin/finance'),
        apiFetch('/admin/moderation-queue'),
        apiFetch('/admin/ads/settings'),
        apiFetch('/admin/audit-logs'),
        apiFetch('/admin/moderation/settings'),
        apiFetch('/admin/exchange-rates'),
        apiFetch('/admin/presence-telemetry'),
        apiFetch('/admin/moderation-history'),
        apiFetch('/admin/logs'),
        apiFetch('/admin/ads/campaigns'),
        apiFetch('/admin/system-overview'),
        apiFetch('/admin/payments/config'),
        apiFetch('/admin/payments/summary'),
        apiFetch('/admin/homepage/config'),
        apiFetch('/admin/moderation/analytics'),
      ]);
      if (settingsResp?.ok) setSystemSettings(await settingsResp.json());
      if (financeResp?.ok) setFinance(await financeResp.json());
      if (queueResp?.ok) setQueue(await queueResp.json());
      if (adsResp?.ok) setAdSettings(await adsResp.json());
      if (auditResp?.ok) setAuditLogs(await auditResp.json());
      if (moderationResp?.ok) setModerationSettings(await moderationResp.json());
      if (ratesResp?.ok) {
        const payload = await ratesResp.json();
        setExchangeRatesText(JSON.stringify(payload?.rates || payload || {}, null, 2));
        setExchangeRatesUpdatedAt(payload?.updated_at || '');
      }
      if (presenceResp?.ok) setPresenceTelemetry(await presenceResp.json());
      if (historyResp?.ok) setHistory(await historyResp.json());
      if (logsResp?.ok) setLogs(await logsResp.json());
      if (campaignsResp?.ok) setCampaigns(await campaignsResp.json());
      if (overviewResp?.ok) setSystemOverview(await overviewResp.json());
      if (paymentSettingsResp?.ok) setPaymentSettings(await paymentSettingsResp.json());
      if (paymentSummaryResp?.ok) setPaymentSummary(await paymentSummaryResp.json());
      if (homepageSettingsResp?.ok) setHomepageSettings(await homepageSettingsResp.json());
      if (moderationAnalyticsResp?.ok) setModerationAnalytics(await moderationAnalyticsResp.json());
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canAccess, token]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  return {
    loading,
    queue,
    history,
    systemSettings,
    finance,
    paymentSettings,
    paymentSummary,
    homepageSettings,
    adSettings,
    logs,
    auditLogs,
    presenceTelemetry,
    moderationSettings,
    exchangeRatesText,
    exchangeRatesUpdatedAt,
    systemOverview,
    moderationAnalytics,
    setQueue,
    setHistory,
    setSystemSettings,
    setFinance,
    setPaymentSettings,
    setPaymentSummary,
    setHomepageSettings,
    campaigns,
    setCampaigns,
    setAdSettings,
    setLogs,
    setAuditLogs,
    setPresenceTelemetry,
    setModerationSettings,
    setExchangeRatesText,
    setExchangeRatesUpdatedAt,
    setSystemOverview,
    setModerationAnalytics,
    loadAdminData,
    canAccess,
  };
}
