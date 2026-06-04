import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, KeyboardAvoidingView, NativeSyntheticEvent, NativeScrollEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiUrl } from '../../../src/utils/api/http';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/contexts/AuthContext';
import { useI18n } from '../../../src/contexts/I18nContext';
import { useApiClient } from '../../../src/hooks/useApiClient';
import { formatRelativeTime } from '../../../src/utils/time';

type MessageItem = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  sender_username: string;
  text: string;
  created_at: string;
  is_outgoing: boolean;
  delivered_at?: string | null;
  read_at?: string | null;
};

type ThreadResponse = {
  thread: { id: string; title: string; preview: string; time: string; unread_count?: number; avatar_url?: string | null; last_sender_username?: string | null; last_read_at?: string | null; is_online?: boolean; is_typing?: boolean };
  messages: MessageItem[];
  unread_count: number;
  has_more: boolean;
  has_newer: boolean;
  next_before?: string | null;
  next_after?: string | null;
  typing_usernames?: string[];
};

export default function MessageThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { token } = useAuth();
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const scrollRef = useRef<ScrollView | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const readMarkerAnim = useRef(new Animated.Value(0)).current;

  const messages = useMemo(() => data?.messages || [], [data]);
  const readMarkerIndex = useMemo(() => {
    const lastReadAt = data?.thread.last_read_at;
    if (!lastReadAt) return -1;
    return messages.findIndex((message) => new Date(message.created_at).getTime() > new Date(lastReadAt).getTime());
  }, [data?.thread.last_read_at, messages]);

  const loadThread = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    const response = await apiFetch(`/messages/${threadId}`, {}, { requireAuth: true });
    const payload = response && response.ok ? (await response.json()) as ThreadResponse : null;
    setData(payload);
    setLoading(false);
  }, [apiFetch, threadId]);

  const pushTypingState = useCallback(async (isTyping: boolean) => {
    if (!threadId) return;
    await apiFetch(`/messages/${threadId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_typing: isTyping }),
    }, { requireAuth: true });
  }, [apiFetch, threadId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread, token]);

  useEffect(() => {
    const isWeb = typeof window !== 'undefined' && typeof window.EventSource !== 'undefined';
    if (!isWeb || !threadId) {
      const intervalId = setInterval(() => {
        void loadThread();
      }, 8000);
      return () => clearInterval(intervalId);
    }

    const source = new window.EventSource(apiUrl(`/messages/${threadId}/stream`));
    source.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as ThreadResponse;
        setData(payload);
        setLoading(false);
      } catch {
        // fall back to polling when malformed
      }
    });
    source.addEventListener('error', () => {
      source.close();
    });
    const fallbackIntervalId = setInterval(() => {
      if (source.readyState !== 1) {
        void loadThread();
      }
    }, 8000);
    return () => {
      clearInterval(fallbackIntervalId);
      source.close();
    };
  }, [loadThread, threadId]);

  useEffect(() => {
    if (!loading && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [loading, messages.length]);

  useEffect(() => {
    if (readMarkerIndex >= 0) {
      readMarkerAnim.setValue(0);
      Animated.timing(readMarkerAnim, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [readMarkerAnim, readMarkerIndex]);

  useEffect(() => {
    return () => {
      void pushTypingState(false);
    };
  }, [pushTypingState]);

  const loadOlderMessages = useCallback(async () => {
    if (!threadId || !data?.has_more || !data?.next_before || loadingMore) return;
    setLoadingMore(true);
    const response = await apiFetch(`/messages/${threadId}?before=${encodeURIComponent(data.next_before)}`, {}, { requireAuth: true });
    const payload = response && response.ok ? (await response.json()) as ThreadResponse : null;
    if (payload?.messages?.length) {
      setData((current) => {
        if (!current) return payload;
        const merged = [...payload.messages, ...current.messages];
        const deduped = merged.filter((message, index, array) => array.findIndex((candidate) => candidate.id === message.id) === index);
        return { ...payload, messages: deduped };
      });
    }
    setLoadingMore(false);
  }, [apiFetch, data?.has_more, data?.next_before, loadingMore, threadId]);

  const loadNewerMessages = useCallback(async () => {
    const newestAt = data?.next_after || messages[messages.length - 1]?.created_at;
    if (!threadId || !newestAt || loadingNewer) return;
    setLoadingNewer(true);
    const response = await apiFetch(`/messages/${threadId}?after=${encodeURIComponent(newestAt)}`, {}, { requireAuth: true });
    const payload = response && response.ok ? (await response.json()) as ThreadResponse : null;
    if (payload?.messages?.length) {
      setData((current) => {
        if (!current) return payload;
        const merged = [...current.messages, ...payload.messages];
        const deduped = merged.filter((message, index, array) => array.findIndex((candidate) => candidate.id === message.id) === index);
        return { ...current, ...payload, messages: deduped };
      });
    }
    setLoadingNewer(false);
  }, [apiFetch, data?.next_after, loadingNewer, messages, threadId]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y <= 48) {
      void loadOlderMessages();
    }
  }, [loadOlderMessages]);

  const sendMessage = async () => {
    if (!threadId || !text.trim()) return;
    setSending(true);
    const response = await apiFetch(`/messages/${threadId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }, { requireAuth: true });
    if (response?.ok) {
      const payload = (await response.json()) as ThreadResponse;
      setData(payload);
      setText('');
    }
    setSending(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#007AFF" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={20} color="#111827" />
        </Pressable>
        {data?.thread.avatar_url ? (
          <Image source={{ uri: data.thread.avatar_url.startsWith('/') ? apiUrl(data.thread.avatar_url) : data.thread.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={18} color="#fff" />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.headerTitleRow}>
            <Text style={[styles.title, isRTL && styles.textRight]}>{data?.thread.title || t('messages')}</Text>
            {typeof data?.thread.unread_count === 'number' && data.thread.unread_count > 0 ? (
              <View style={styles.unreadPill}>
                <Text style={styles.unreadPillText}>{data.thread.unread_count}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.subtitle, isRTL && styles.textRight]}>{t('messagesThreadSubtitle')}</Text>
          {data?.thread.is_online ? <Text style={[styles.presenceText, isRTL && styles.textRight]}>{t('messagesOnline')}</Text> : null}
          {data?.typing_usernames?.length ? <Text style={[styles.typingText, isRTL && styles.textRight]}>{data.typing_usernames.join(', ')} {t('messagesTyping')}</Text> : null}
        </View>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.messagesContainer} onScroll={handleScroll} scrollEventThrottle={16}>
        {loadingMore ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 8 }} /> : null}
        {data?.has_more ? <Pressable onPress={() => void loadOlderMessages()} style={styles.loadMoreButton}><Text style={styles.loadMoreText}>{t('messagesLoadOlder')}</Text></Pressable> : null}
        {data?.has_newer ? <Pressable onPress={() => void loadNewerMessages()} style={styles.loadMoreButton}><Text style={styles.loadMoreText}>{loadingNewer ? t('loading') : t('messagesLoadNewer')}</Text></Pressable> : null}
        {messages.map((message, index) => (
          <View key={message.id}>
            {index === readMarkerIndex ? (
              <Animated.View
                style={[
                  styles.readLineWrap,
                  {
                    opacity: readMarkerAnim,
                    transform: [
                      {
                        translateY: readMarkerAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-8, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={styles.readLine} />
                <View style={styles.readLineLabel}>
                  <Text style={styles.readLineLabelText}>{t('messagesReadLine')}</Text>
                  <Text style={styles.readLineText}>{formatRelativeTime(data?.thread.last_read_at)}</Text>
                </View>
                <View style={styles.readLine} />
              </Animated.View>
            ) : null}
            <View style={[styles.bubbleRow, message.is_outgoing ? styles.outgoingRow : styles.incomingRow]}>
              <View style={[styles.bubble, message.is_outgoing ? styles.outgoingBubble : styles.incomingBubble]}>
                <Text style={[styles.sender, message.is_outgoing && styles.outgoingText]}>{message.is_outgoing ? t('messagesYou') : `@${message.sender_username}`}</Text>
                <Text style={[styles.messageText, message.is_outgoing && styles.outgoingText]}>{message.text}</Text>
                <Text style={[styles.messageTime, message.is_outgoing && styles.outgoingMeta]}>{formatRelativeTime(message.created_at)}</Text>
                {message.is_outgoing ? (
                  <View style={styles.statusRow}>
                    <Ionicons
                      name={message.read_at ? 'checkmark-done' : message.delivered_at ? 'checkmark-done' : 'checkmark'}
                      size={11}
                      color={message.read_at ? '#0F62FE' : '#9CA3AF'}
                    />
                    <Text style={[styles.statusText, styles.statusTextInline, message.is_outgoing && styles.outgoingMeta]}>
                      {message.read_at ? t('messageRead') : message.delivered_at ? t('messageDelivered') : t('messageSending')}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={text}
          placeholder={t('messagesComposerPlaceholder')}
          placeholderTextColor="#9CA3AF"
          style={[styles.input, isRTL && styles.textRight]}
          multiline
          onFocus={() => void pushTypingState(true)}
          onBlur={() => void pushTypingState(false)}
          onChangeText={(value) => {
            setText(value);
            void pushTypingState(value.trim().length > 0);
          }}
        />
        <Pressable onPress={sendMessage} disabled={sending || !text.trim()} style={[styles.sendButton, (sending || !text.trim()) && styles.sendButtonDisabled]}>
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f7fb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e5e7eb' },
  avatarFallback: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  presenceText: { fontSize: 12, color: '#2563eb', marginTop: 4, fontWeight: '700' },
  typingText: { fontSize: 12, color: '#007AFF', marginTop: 4, fontWeight: '700' },
  unreadPill: { minWidth: 20, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: '#0F62FE', alignItems: 'center', justifyContent: 'center' },
  unreadPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  messagesContainer: { padding: 16, gap: 10 },
  readLineWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  readLine: { flex: 1, height: 2, backgroundColor: '#C7D2FE' },
  readLineLabel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    alignItems: 'center',
  },
  readLineLabelText: { fontSize: 10, color: '#4338CA', fontWeight: '800', textTransform: 'uppercase' },
  readLineText: { fontSize: 11, color: '#4338CA', fontWeight: '700', marginTop: 2 },
  loadMoreButton: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#E8F1FF', marginBottom: 8 },
  loadMoreText: { color: '#0F62FE', fontWeight: '800', fontSize: 12 },
  bubbleRow: { flexDirection: 'row' },
  incomingRow: { justifyContent: 'flex-start' },
  outgoingRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', borderRadius: 18, padding: 12, borderWidth: 1 },
  incomingBubble: { backgroundColor: '#fff', borderColor: '#e5e7eb' },
  outgoingBubble: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  sender: { fontSize: 12, color: '#4b5563', fontWeight: '800', marginBottom: 4 },
  messageText: { fontSize: 15, color: '#111827', lineHeight: 21 },
  outgoingText: { color: '#fff' },
  messageTime: { fontSize: 11, color: '#6b7280', marginTop: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  statusText: { fontSize: 10, color: '#9ca3af', marginTop: 4, fontWeight: '700' },
  statusTextInline: { marginTop: 0 },
  outgoingMeta: { color: 'rgba(255,255,255,0.8)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, color: '#111827', backgroundColor: '#fff' },
  sendButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.5 },
  textRight: { textAlign: 'right' },
});
