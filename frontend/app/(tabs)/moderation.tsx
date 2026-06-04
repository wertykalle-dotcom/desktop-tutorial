import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { Badge } from '../../src/components/Badge';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useI18n } from '../../src/contexts/I18nContext';
import { formatRelativeTime } from '../../src/utils/time';
import { canModerate } from '../../src/utils/roles';

const DECISION_REASONS = [
  'spam',
  'harassment',
  'off_topic',
  'unsafe_content',
  'duplicate',
] as const;

type QueueItem = {
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
  post_summary?: {
    post_id?: string;
    username?: string;
    text?: string;
  } | null;
  author_presence?: {
    is_online?: boolean;
    last_active_at?: string | null;
  } | null;
};

type ModerationSettings = {
  sensitivity: number;
};

type HistoryItem = QueueItem & {
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  reviewed_reason?: string | null;
  reviewed_reason_tags?: string[] | string | null;
  reviewed_reason_custom?: string | null;
  post_summary?: {
    post_id?: string;
    username?: string;
    text?: string;
  } | null;
  author_presence?: {
    is_online?: boolean;
    last_active_at?: string | null;
  } | null;
};

export default function ModerationScreen() {
  const { user, token } = useAuth();
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [moderationSettings, setModerationSettings] = useState<ModerationSettings>({ sensitivity: 50 });
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionAction, setDecisionAction] = useState<'approve' | 'reject' | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<QueueItem | null>(null);
  const [decisionReasonTags, setDecisionReasonTags] = useState<string[]>([]);
  const [queueFilter, setQueueFilter] = useState('');
  const [historyFilter, setHistoryFilter] = useState('');

  const canAccess = canModerate(user?.role);

  const loadData = useCallback(async () => {
    if (!token || !canAccess) return;
    setLoading(true);
    try {
      const [queueResp, settingsResp] = await Promise.all([
        apiFetch('/admin/moderation-queue'),
        apiFetch('/admin/moderation/settings'),
      ]);
      const historyResp = await apiFetch('/admin/moderation-history');
      if (queueResp?.ok) setQueue(await queueResp.json());
      if (settingsResp?.ok) setModerationSettings(await settingsResp.json());
      if (historyResp?.ok) setHistory(await historyResp.json());
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canAccess, token]);

  const resolveItem = async (item: QueueItem, action: 'approve' | 'reject', reason: string) => {
    try {
      const response = await apiFetch(`/admin/moderation-queue/${item.moderation_id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: item.score,
          action,
          queue: false,
          reason: reason.trim() || item.reason || undefined,
          reason_tags: decisionReasonTags,
          reason_custom: decisionReason.trim() || undefined,
          reviewed_reason: [decisionReasonTags.map((tag) => t(`moderationReason_${tag}`)), decisionReason.trim()].flat().filter(Boolean).join(' · ') || undefined,
        }),
      });
      if (!response || !response.ok) throw new Error('Moderation action failed');
      await loadData();
    } catch (error) {
      console.error('Moderation action failed:', error);
    }
  };

  const openDecisionModal = (item: QueueItem, action: 'approve' | 'reject') => {
    setDecisionTarget(item);
    setDecisionAction(action);
    setDecisionReason(item.reason || '');
    setDecisionReasonTags([]);
    setDecisionModalOpen(true);
  };

  const submitDecision = async () => {
    if (!decisionTarget || !decisionAction) return;
    const reasonParts = [...decisionReasonTags, decisionReason.trim()].filter(Boolean);
    await resolveItem(decisionTarget, decisionAction, reasonParts.join(', '));
    setDecisionModalOpen(false);
    setDecisionTarget(null);
    setDecisionAction(null);
    setDecisionReason('');
    setDecisionReasonTags([]);
  };

  const toggleReasonTag = (tag: string) => {
    setDecisionReasonTags((current) => (
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    ));
  };

  const buildDecisionSummary = (item: HistoryItem) => `${item.reviewed_reason || t('adminNoData')} · ${item.reviewed_by || t('adminNoData')} · ${item.reviewed_at ? formatRelativeTime(item.reviewed_at) : t('adminNoData')}`;
  const filteredQueue = queue.filter((item) => {
    const needle = queueFilter.trim().toLowerCase();
    if (!needle) return true;
    return [item.target_type, item.status, item.reason, item.text, item.post_id, item.target_id].some((value) =>
      String(value || '').toLowerCase().includes(needle)
    );
  });
  const filteredHistory = history.filter((item) => {
    const needle = historyFilter.trim().toLowerCase();
    if (!needle) return true;
    return [
      item.target_type,
      item.status,
      item.reason,
      item.reviewed_reason,
      item.reviewed_reason_custom,
      item.text,
      item.post_id,
      item.target_id,
      item.reviewed_by,
    ].some((value) => String(value || '').toLowerCase().includes(needle));
  });
  const parseReasonTags = (item: HistoryItem) => {
    if (Array.isArray(item.reviewed_reason_tags)) return item.reviewed_reason_tags.map(String);
    if (typeof item.reviewed_reason_tags === 'string' && item.reviewed_reason_tags.trim()) {
      try {
        const parsed = JSON.parse(item.reviewed_reason_tags);
        return Array.isArray(parsed) ? parsed.map((tag) => String(tag)) : [item.reviewed_reason_tags];
      } catch {
        return item.reviewed_reason_tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      }
    }
    return [];
  };

  const openOriginal = (item: QueueItem) => {
    const destinationPostId = item.target_type === 'post' ? item.target_id : item.post_id;
    if (destinationPostId) {
      if (item.target_type === 'comment' && item.post_id) {
        router.push({ pathname: '/posts/[postId]', params: { postId: destinationPostId, commentId: item.target_id } });
        return;
      }
      router.push(`/posts/${destinationPostId}`);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!canAccess) {
        router.replace('/(tabs)/feed');
        return undefined;
      }
      void loadData();
      return undefined;
    }, [canAccess, loadData, router])
  );

  useEffect(() => {
    if (!token || !canAccess) return undefined;
    const intervalId = setInterval(() => {
      void loadData();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [canAccess, loadData, token]);

  if (!canAccess) {
    router.replace('/(tabs)/feed');
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.title, isRTL && styles.textRight]}>{t('moderation')}</Text>
      <Text style={[styles.body, isRTL && styles.textRight]}>Moderointi on sisällön valvontaa: teksti, kuva ja ääni käydään läpi sääntöjen mukaisesti ennen kuin sisältö leviää laajasti.</Text>
      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('moderationSensitivity')}</Text>
        <Text style={[styles.meta, isRTL && styles.textRight]}>{t('moderationCurrentLevel')}: {moderationSettings.sensitivity}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('moderationQueue')}</Text>
        <TextInput
          style={styles.filterInput}
          value={queueFilter}
          onChangeText={setQueueFilter}
          placeholder="Filter queue"
          autoCapitalize="none"
        />
        {filteredQueue.length === 0 ? (
          <Text style={styles.empty}>{t('moderationNoQueue')}</Text>
        ) : filteredQueue.map((item) => (
          <View key={item.moderation_id} style={styles.queueItem}>
            <View style={styles.queueHeader}>
              <Ionicons name={item.target_type === 'post' ? 'chatbox' : 'chatbubble'} size={18} color="#007AFF" />
              <Text style={[styles.queueTitle, isRTL && styles.textRight]}>{item.target_type} · {item.score}</Text>
              {item.author_presence?.is_online ? <View style={styles.presenceHalo} /> : null}
            </View>
            <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminStatus')}: {item.status}</Text>
            <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminReason')}: {item.reason || t('adminNoData')}</Text>
            <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminText')}: {item.text || t('adminNoData')}</Text>
            {item.post_summary ? (
              <Text style={[styles.meta, isRTL && styles.textRight]}>
                {t('moderationPostPreview')}: @{item.post_summary.username || t('adminNoData')} · {item.post_summary.text || t('adminNoData')}
              </Text>
            ) : null}
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionButton, styles.approveButton]} onPress={() => openDecisionModal(item, 'approve')}>
                <Text style={styles.actionButtonText}>{t('adminApprove')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.rejectButton]} onPress={() => openDecisionModal(item, 'reject')}>
                <Text style={styles.actionButtonText}>{t('adminReject')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.secondaryButton, item.target_type !== 'post' && styles.secondaryButtonDisabled]}
              onPress={() => openOriginal(item)}
              disabled={item.target_type !== 'post'}
            >
              <Text style={styles.secondaryButtonText}>
                {item.target_type === 'post' || item.post_id ? t('moderationOpenOriginal') : t('moderationOpenOriginalUnavailable')}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Moderation history</Text>
        <TextInput
          style={styles.filterInput}
          value={historyFilter}
          onChangeText={setHistoryFilter}
          placeholder="Filter history"
          autoCapitalize="none"
        />
        {filteredHistory.length === 0 ? (
          <Text style={styles.empty}>{t('adminNoQueue')}</Text>
        ) : filteredHistory.map((item) => (
          <View key={item.moderation_id} style={styles.queueItem}>
            <View style={styles.historyHeader}>
              <Text style={[styles.queueTitle, isRTL && styles.textRight]}>
                {item.target_type}
              </Text>
              <Badge tone={item.status.toLowerCase() === 'approved' ? 'success' : item.status.toLowerCase() === 'rejected' ? 'warning' : 'muted'} label={item.status} compact />
            </View>
            <Text style={[styles.meta, isRTL && styles.textRight]}>{t('adminReason')}: {item.reason || t('adminNoData')}</Text>
            <Text style={[styles.meta, isRTL && styles.textRight]}>{t('moderationCommentText')}: {item.text || t('adminNoData')}</Text>
            {item.post_summary ? (
              <Text style={[styles.meta, isRTL && styles.textRight]}>
                {t('moderationPostPreview')}: @{item.post_summary.username || t('adminNoData')} · {item.post_summary.text || t('adminNoData')}
              </Text>
            ) : null}
            <Text style={[styles.meta, isRTL && styles.textRight]}>
              {t('profileLastActive')}: {item.author_presence?.last_active_at ? formatRelativeTime(item.author_presence.last_active_at) : t('messagesNever')}
            </Text>
            <Text style={[styles.auditLine, isRTL && styles.textRight]} numberOfLines={1}>{buildDecisionSummary(item)}</Text>
            {parseReasonTags(item).length ? (
              <View style={styles.reasonTagRow}>
                {parseReasonTags(item).map((tag) => (
                  <Badge key={tag} tone="muted" label={t(`moderationReason_${tag}`) || tag} compact />
                ))}
              </View>
            ) : null}
            {item.reviewed_reason_custom ? (
              <Text style={[styles.meta, isRTL && styles.textRight]} numberOfLines={1}>{item.reviewed_reason_custom}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.secondaryButton, !(item.target_type === 'post' || item.post_id) && styles.secondaryButtonDisabled]}
              onPress={() => openOriginal(item)}
              disabled={!(item.target_type === 'post' || item.post_id)}
            >
              <Text style={styles.secondaryButtonText}>
                {item.target_type === 'post' || item.post_id ? t('moderationOpenOriginal') : t('moderationOpenOriginalUnavailable')}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <Modal visible={decisionModalOpen} transparent animationType="fade" onRequestClose={() => setDecisionModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {decisionAction === 'approve' ? t('moderationApproveDialogTitle') : t('moderationRejectDialogTitle')}
            </Text>
            <Text style={styles.modalBody}>
              {decisionAction === 'approve' ? t('moderationApproveDialogBody') : t('moderationRejectDialogBody')}
            </Text>
            <View style={styles.reasonTagRow}>
              {DECISION_REASONS.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={[styles.reasonTag, decisionReasonTags.includes(tag) && styles.reasonTagActive]}
                  onPress={() => toggleReasonTag(tag)}
                >
                  <Text style={[styles.reasonTagText, decisionReasonTags.includes(tag) && styles.reasonTagTextActive]}>
                    {t(`moderationReason_${tag}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.modalInput}
              value={decisionReason}
              onChangeText={setDecisionReason}
              placeholder={t('moderationDecisionReasonPlaceholder')}
              multiline
            />
            <Text style={styles.modalHelperText}>{t('moderationDecisionReasonHelp')}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalButton, styles.modalCancelButton]} onPress={() => setDecisionModalOpen(false)}>
                <Text style={styles.modalCancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, decisionAction === 'approve' ? styles.modalApproveButton : styles.modalRejectButton]} onPress={() => void submitDecision()}>
                <Text style={styles.modalConfirmText}>{decisionAction === 'approve' ? t('adminApprove') : t('adminReject')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  title: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
  body: { color: '#4b5563', fontSize: 15, marginBottom: 16, lineHeight: 22 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 8 },
  meta: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  auditLine: { fontSize: 10, color: '#9ca3af', marginTop: 3, fontWeight: '700', letterSpacing: 0.1 },
  queueItem: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eef2f7' },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  queueHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  presenceHalo: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(16, 185, 129, 0.35)', backgroundColor: '#10b981' },
  queueTitle: { fontSize: 14, fontWeight: '800', color: '#111827' },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionButton: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  approveButton: { backgroundColor: '#0f766e' },
  rejectButton: { backgroundColor: '#b91c1c' },
  actionButtonText: { color: '#fff', fontWeight: '800' },
  secondaryButton: { marginTop: 10, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: '#e5e7eb' },
  secondaryButtonDisabled: { opacity: 0.45 },
  secondaryButtonText: { color: '#111827', fontWeight: '800' },
  filterInput: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', marginBottom: 10 },
  empty: { color: '#6b7280', fontStyle: 'italic' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  modalBody: { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  modalHelperText: { fontSize: 12, color: '#6b7280', lineHeight: 18 },
  modalInput: { minHeight: 88, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 14, padding: 12, fontSize: 14, color: '#111827', textAlignVertical: 'top' },
  reasonTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonTag: { borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff' },
  reasonTagActive: { backgroundColor: '#0F62FE', borderColor: '#0F62FE' },
  reasonTagText: { fontSize: 12, color: '#374151', fontWeight: '700' },
  reasonTagTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  modalButton: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, minWidth: 96, alignItems: 'center' },
  modalCancelButton: { backgroundColor: '#e5e7eb' },
  modalApproveButton: { backgroundColor: '#0f766e' },
  modalRejectButton: { backgroundColor: '#b91c1c' },
  modalCancelText: { color: '#111827', fontWeight: '800' },
  modalConfirmText: { color: '#fff', fontWeight: '800' },
  textRight: { textAlign: 'right' },
});
