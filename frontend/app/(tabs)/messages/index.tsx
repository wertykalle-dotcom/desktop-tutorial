import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../../src/contexts/I18nContext';
import { useAuth } from '../../../src/contexts/AuthContext';
import { Badge } from '../../../src/components/Badge';
import { type ThreadItem } from '../../../src/features/directories/directory-data';
import { useApiClient } from '../../../src/hooks/useApiClient';
import { formatRelativeTime } from '../../../src/utils/time';
import { apiUrl } from '../../../src/utils/api/http';

type MessagesResponse = {
  threads: (ThreadItem & {
    unread_count?: number;
    avatar_url?: string | null;
    last_sender_username?: string | null;
    last_sender_user_id?: string | null;
    participant_user_id?: string | null;
    last_read_at?: string | null;
    last_message_delivered_at?: string | null;
    last_message_read_at?: string | null;
    last_message_state?: 'sending' | 'delivered' | 'read' | null;
    is_typing?: boolean;
    is_online?: boolean;
    direction?: 'sent' | 'received' | null;
  })[];
  unread_count: number;
};

type MessageScope = 'all' | 'received' | 'sent';

export default function MessagesScreen() {
  const { t, isRTL } = useI18n();
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const [threads, setThreads] = useState<MessagesResponse['threads']>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<MessageScope>('all');
  const [composeOpen, setComposeOpen] = useState(false);
  const [recipientUserId, setRecipientUserId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    const response = await apiFetch('/messages?limit=20', {}, { requireAuth: true });
    const data = response && response.ok ? (await response.json()) as MessagesResponse : null;
    setThreads(Array.isArray(data?.threads) ? data.threads : []);
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads, token]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void loadThreads();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [loadThreads]);

  const resolveAvatarUrl = (avatarUrl?: string | null) => {
    if (!avatarUrl) return null;
    return avatarUrl.startsWith('/') ? apiUrl(avatarUrl) : avatarUrl;
  };

  const filteredThreads = useMemo(() => {
    if (scope === 'received') return threads.filter((thread) => thread.direction !== 'sent');
    if (scope === 'sent') return threads.filter((thread) => thread.direction === 'sent');
    return threads;
  }, [scope, threads]);

  const openComposer = (participantUserId?: string | null) => {
    setRecipientUserId(participantUserId || '');
    setMessageText('');
    setComposeOpen(true);
  };

  const sendMessage = async () => {
    if (!token || !user?.user_id) return;
    const trimmedRecipient = recipientUserId.trim();
    const trimmedText = messageText.trim();
    if (!trimmedRecipient || !trimmedText) return;

    setSending(true);
    try {
      const threadId = [user.user_id, trimmedRecipient].sort().join('::');
      const response = await apiFetch(`/messages/${encodeURIComponent(threadId)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmedText,
          recipient_user_id: trimmedRecipient,
        }),
      });
      if (!response || !response.ok) {
        throw new Error(t('messageSendFailed'));
      }
      setComposeOpen(false);
      setRecipientUserId('');
      setMessageText('');
      await loadThreads();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  const scopeButton = (value: MessageScope, label: string) => (
    <Pressable
      style={[styles.scopeButton, scope === value && styles.scopeButtonActive]}
      onPress={() => setScope(value)}
    >
      <Text style={[styles.scopeButtonText, scope === value && styles.scopeButtonTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, isRTL && styles.textRight]}>{t('messages')}</Text>
          <Text style={[styles.body, isRTL && styles.textRight]}>{t('messagesSubtitle')}</Text>
        </View>
        <Pressable style={styles.composeButton} onPress={() => openComposer('')}>
          <Ionicons name="send" size={16} color="#fff" />
          <Text style={styles.composeButtonText}>{t('sendMessage')}</Text>
        </Pressable>
      </View>

      <View style={styles.scopeRow}>
        {scopeButton('all', t('messagesAll'))}
        {scopeButton('received', t('messagesReceived'))}
        {scopeButton('sent', t('messagesSent'))}
      </View>

      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}
      {filteredThreads.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.iconWrap}>
            <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.threadName, isRTL && styles.textRight]}>{t('messagesEmptyTitle')}</Text>
            <Text style={[styles.preview, isRTL && styles.textRight]}>{t('messagesEmptyBody')}</Text>
          </View>
        </View>
      ) : (
        filteredThreads.map((thread) => (
          <View key={thread.id} style={styles.card}>
            <View style={styles.avatarWrap}>
              {resolveAvatarUrl(thread.avatar_url) ? (
                <Image source={{ uri: resolveAvatarUrl(thread.avatar_url) || undefined }} style={styles.avatar} />
              ) : (
                <View style={styles.iconWrap}>
                  <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
                </View>
              )}
              {thread.is_typing || thread.is_online ? <View style={[styles.presenceDot, thread.is_typing ? styles.presenceTyping : styles.presenceOnline]} /> : null}
              <Badge
                tone={thread.last_message_state === 'read' ? 'brand' : thread.last_message_state === 'delivered' ? 'muted' : thread.last_message_state === 'sending' ? 'warning' : thread.unread_count ? 'brand' : 'muted'}
                compact
                icon={<Ionicons name={thread.last_message_state === 'read' ? 'checkmark-done' : thread.last_message_state === 'delivered' ? 'checkmark-done-outline' : thread.last_message_state === 'sending' ? 'time-outline' : thread.unread_count ? 'mail-unread' : 'checkmark-done'} size={9} color={thread.last_message_state === 'sending' ? '#B45309' : thread.last_message_state === 'delivered' ? '#64748B' : '#0F62FE'} />}
                count={thread.unread_count || undefined}
                countOnly
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.threadName, isRTL && styles.textRight]}>{thread.title}</Text>
              {thread.last_sender_username ? <Text style={[styles.senderName, isRTL && styles.textRight]}>@{thread.last_sender_username}</Text> : null}
              <Text style={[styles.preview, isRTL && styles.textRight]} numberOfLines={1}>{thread.preview}</Text>
              {thread.last_read_at ? <Text style={[styles.readMeta, isRTL && styles.textRight]}>{t('messagesLastRead')}: {formatRelativeTime(thread.last_read_at)}</Text> : null}
              {!thread.last_read_at && thread.unread_count ? <Text style={[styles.readMeta, isRTL && styles.textRight]}>{t('messagesLastRead')}: {t('messagesNever')}</Text> : null}
              <Text style={[styles.statusMeta, isRTL && styles.textRight]}>
                {thread.direction === 'sent' ? t('messagesSent') : t('messagesReceived')}
              </Text>
              {thread.last_message_state === 'delivered' && thread.last_message_delivered_at ? <Text style={[styles.stateMeta, isRTL && styles.textRight]}>{t('messageDelivered')}: {formatRelativeTime(thread.last_message_delivered_at)}</Text> : null}
              {thread.last_message_state === 'read' && thread.last_message_read_at ? <Text style={[styles.stateMeta, isRTL && styles.textRight]}>{t('messageRead')}: {formatRelativeTime(thread.last_message_read_at)}</Text> : null}
            </View>
            <View style={styles.metaColumn}>
              <Text style={styles.time}>{formatRelativeTime(thread.time)}</Text>
              <Pressable
                style={styles.replyButton}
                onPress={() => openComposer(thread.participant_user_id)}
                disabled={!thread.participant_user_id}
              >
                <Text style={styles.replyButtonText}>{t('sendMessage')}</Text>
              </Pressable>
              {thread.unread_count ? <Badge tone="brand" count={thread.unread_count} compact countOnly /> : null}
            </View>
          </View>
        ))
      )}

      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('sendMessage')}</Text>
            <TextInput
              value={recipientUserId}
              onChangeText={setRecipientUserId}
              placeholder={t('recipientUserId')}
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={messageText}
              onChangeText={setMessageText}
              placeholder={t('messageText')}
              multiline
              style={[styles.input, styles.messageInput]}
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={() => setComposeOpen(false)}>
                <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.sendButton, sending && styles.sendButtonDisabled]}
                onPress={() => void sendMessage()}
                disabled={sending}
              >
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendButtonText}>{t('sendMessage')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
  body: { color: '#4b5563', fontSize: 15, lineHeight: 22 },
  composeButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#007AFF', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4 },
  composeButtonText: { color: '#fff', fontWeight: '800' },
  scopeRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  scopeButton: { backgroundColor: '#e5e7eb', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  scopeButtonActive: { backgroundColor: '#007AFF' },
  scopeButtonText: { color: '#374151', fontWeight: '800' },
  scopeButtonTextActive: { color: '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, marginBottom: 10 },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, marginBottom: 10 },
  avatarWrap: { position: 'relative', width: 38, height: 38 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#e5e7eb' },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  presenceDot: { position: 'absolute', left: -1, top: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: '#10b981', borderWidth: 2, borderColor: '#fff' },
  presenceTyping: { backgroundColor: '#f59e0b' },
  presenceOnline: { backgroundColor: '#10b981' },
  threadName: { fontSize: 15, fontWeight: '800', color: '#111827' },
  senderName: { fontSize: 12, color: '#6b7280', fontWeight: '700', marginTop: 1 },
  preview: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  readMeta: { fontSize: 11, color: '#9ca3af', marginTop: 4, fontWeight: '700' },
  statusMeta: { fontSize: 11, color: '#0F62FE', marginTop: 4, fontWeight: '800' },
  stateMeta: { fontSize: 10, color: '#94A3B8', marginTop: 2, fontWeight: '600' },
  metaColumn: { alignItems: 'flex-end', gap: 6 },
  time: { fontSize: 12, color: '#9ca3af', fontWeight: '700' },
  replyButton: { backgroundColor: '#eef2ff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  replyButtonText: { color: '#4338ca', fontWeight: '800', fontSize: 12 },
  textRight: { textAlign: 'right' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#111827' },
  messageInput: { minHeight: 120, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  modalButton: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, minWidth: 110, alignItems: 'center' },
  cancelButton: { backgroundColor: '#f3f4f6' },
  cancelButtonText: { color: '#374151', fontWeight: '800' },
  sendButton: { backgroundColor: '#007AFF' },
  sendButtonDisabled: { opacity: 0.7 },
  sendButtonText: { color: '#fff', fontWeight: '800' },
});
