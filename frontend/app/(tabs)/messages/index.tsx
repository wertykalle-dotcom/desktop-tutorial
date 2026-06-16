import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../../src/contexts/I18nContext';
import { useAuth } from '../../../src/contexts/AuthContext';
import { Badge } from '../../../src/components/Badge';
import { type ThreadItem } from '../../../src/features/directories/directory-data';
import { useApiClient } from '../../../src/hooks/useApiClient';
import { formatRelativeTime } from '../../../src/utils/time';
import { apiUrl } from '../../../src/utils/api/http';
import { storage } from '../../../src/utils/storage';

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

const activeCommunityMembers = [
  { userId: 'user_sihvonen', username: 'Sihvonen', subtitle: 'Yhteisön jäsen', initials: 'SI', color: '#0F62FE' },
  { userId: 'user_kalevi', username: 'Kalevi', subtitle: 'Aktiivinen tänään', initials: 'KA', color: '#059669' },
  { userId: 'user_testuser', username: 'testuser', subtitle: 'Demo-käyttäjä', initials: 'TU', color: '#7C3AED' },
  { userId: 'user_yosla_kaveri', username: 'Yosla_Kaveri', subtitle: 'Valmis keskustelemaan', initials: 'YK', color: '#EA580C' },
  { userId: 'user_demo_2026', username: 'demo_user_2026', subtitle: 'Aktiivinen nyt', initials: 'D2', color: '#0F62FE' },
  { userId: 'user_testaaja_1', username: 'Testaaja1', subtitle: 'Vastasi juuri keskusteluun', initials: 'T1', color: '#7C3AED' },
  { userId: 'user_yosla_mod', username: 'YOSLA_Moderaattori', subtitle: 'Yhteisön moderaattori', initials: 'YM', color: '#059669' },
  { userId: 'user_demo_testaaja', username: 'demo_testaaja', subtitle: 'Demo-keskustelukaveri', initials: 'DT', color: '#EA580C' },
];

type CommunityMember = typeof activeCommunityMembers[number];

type ChatMessage = {
  id: string;
  author: string;
  text: string;
  mine?: boolean;
  time: string;
  createdAt: string;
};

type PersistedMessagesState = {
  friends: CommunityMember[];
  activeChatMember: CommunityMember | null;
  chatHistories: Record<string, ChatMessage[]>;
  threads: MessagesResponse['threads'];
  savedAt: string;
};

const MESSAGE_STORAGE_KEY_PREFIX = 'yosla_messages_state_v1';
const MESSAGE_AUTO_DELETE_MS = 14 * 24 * 60 * 60 * 1000;

const normalizePersistedMember = (member: Partial<CommunityMember> | null | undefined): CommunityMember | null => {
  if (!member?.userId || !member.username) return null;
  return {
    userId: String(member.userId),
    username: String(member.username),
    subtitle: String(member.subtitle || 'Yhteisön jäsen'),
    initials: String(member.initials || member.username.slice(0, 2).toUpperCase()),
    color: String(member.color || '#0F62FE'),
  };
};

const pruneExpiredMessages = (histories: Record<string, ChatMessage[]>, now = Date.now()) => {
  return Object.entries(histories).reduce<Record<string, ChatMessage[]>>((next, [memberId, messages]) => {
    const keptMessages = messages
      .map((message) => {
        const createdAt = message.createdAt || message.time || new Date(now).toISOString();
        return { ...message, createdAt, time: message.time || createdAt };
      })
      .filter((message) => {
        const createdAtMs = Date.parse(message.createdAt);
        if (Number.isNaN(createdAtMs)) return true;
        return now - createdAtMs < MESSAGE_AUTO_DELETE_MS;
      });
    if (keptMessages.length) {
      next[memberId] = keptMessages;
    }
    return next;
  }, {});
};

const removeExpiredMessagesFromState = (
  state: Omit<PersistedMessagesState, 'savedAt'> & { savedAt?: string },
  now = Date.now(),
): PersistedMessagesState => ({
  ...state,
  chatHistories: pruneExpiredMessages(state.chatHistories, now),
  savedAt: new Date(now).toISOString(),
});

const parsePersistedMessagesState = (raw: unknown): PersistedMessagesState | null => {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string'
      ? JSON.parse(raw) as Partial<PersistedMessagesState>
      : raw as Partial<PersistedMessagesState>;
    const friends = Array.isArray(parsed.friends)
      ? parsed.friends.map(normalizePersistedMember).filter((member): member is CommunityMember => !!member)
      : [];
    const activeChatMember = parsed.activeChatMember ? normalizePersistedMember(parsed.activeChatMember) : null;
    const chatHistories = parsed.chatHistories && typeof parsed.chatHistories === 'object'
      ? pruneExpiredMessages(parsed.chatHistories as Record<string, ChatMessage[]>)
      : {};
    const threads = Array.isArray(parsed.threads) ? parsed.threads : [];
    return removeExpiredMessagesFromState({
      friends,
      activeChatMember,
      chatHistories,
      threads,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Failed to parse persisted messages state:', error);
    return null;
  }
};

export default function MessagesScreen() {
  const { t, isRTL } = useI18n();
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const { width } = useWindowDimensions();
  const [threads, setThreads] = useState<MessagesResponse['threads']>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<MessageScope>('all');
  const [peoplePickerOpen, setPeoplePickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [friendSearch, setFriendSearch] = useState('');
  const [friends, setFriends] = useState<CommunityMember[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [activeChatMember, setActiveChatMember] = useState<CommunityMember | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMessage[]>>({});
  const chatScrollRef = useRef<ScrollView | null>(null);
  const hasHydratedMessagesRef = useRef(false);
  const pickerAnim = useRef(new Animated.Value(0)).current;
  const isCompact = width < 520;
  const messageStorageKey = `${MESSAGE_STORAGE_KEY_PREFIX}:${user?.user_id || 'guest'}`;

  const loadThreads = useCallback(async () => {
    setLoading(true);
    const response = await apiFetch('/messages?limit=20', {}, { requireAuth: true });
    const data = response && response.ok ? (await response.json()) as MessagesResponse : null;
    const remoteThreads = Array.isArray(data?.threads) ? data.threads : [];
    setThreads((current) => {
      const remoteIds = new Set(remoteThreads.map((thread) => thread.id));
      const localOnlyThreads = current.filter((thread) => !remoteIds.has(thread.id));
      return [...localOnlyThreads, ...remoteThreads];
    });
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

  useEffect(() => {
    hasHydratedMessagesRef.current = false;
    let cancelled = false;
    const hydrateMessages = async () => {
      const raw = await storage.getItem<PersistedMessagesState | string | null>(messageStorageKey, null);
      if (cancelled) return;
      const persistedState = parsePersistedMessagesState(raw || null);
      if (persistedState) {
        setFriends(persistedState.friends);
        setActiveChatMember(persistedState.activeChatMember);
        setChatHistories(persistedState.chatHistories);
        setThreads((current) => {
          const currentIds = new Set(current.map((thread) => thread.id));
          const localThreads = persistedState.threads.filter((thread) => !currentIds.has(thread.id));
          return [...localThreads, ...current];
        });
        await storage.setItem(messageStorageKey, persistedState);
      }
      hasHydratedMessagesRef.current = true;
    };
    void hydrateMessages();
    return () => {
      cancelled = true;
    };
  }, [messageStorageKey]);

  useEffect(() => {
    if (!hasHydratedMessagesRef.current) return;
    const persistedState: PersistedMessagesState = {
      friends,
      activeChatMember,
      chatHistories,
      threads,
      savedAt: new Date().toISOString(),
    };
    void storage.setItem(messageStorageKey, removeExpiredMessagesFromState(persistedState));
  }, [activeChatMember, chatHistories, friends, messageStorageKey, threads]);

  const resolveAvatarUrl = (avatarUrl?: string | null) => {
    if (!avatarUrl) return null;
    return avatarUrl.startsWith('/') ? apiUrl(avatarUrl) : avatarUrl;
  };

  const filteredThreads = useMemo(() => {
    if (scope === 'received') return threads.filter((thread) => thread.direction !== 'sent');
    if (scope === 'sent') return threads.filter((thread) => thread.direction === 'sent');
    return threads;
  }, [scope, threads]);

  const openPeoplePicker = () => {
    setUserSearch('');
    pickerAnim.setValue(0);
    setPeoplePickerOpen(true);
  };

  useEffect(() => {
    if (!peoplePickerOpen) return;
    Animated.timing(pickerAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [peoplePickerOpen, pickerAnim]);

  const filteredMembers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    const source = friends.length ? friends : activeCommunityMembers;
    if (!query) return source;
    return source.filter((member) =>
      member.username.toLowerCase().includes(query) ||
      member.subtitle.toLowerCase().includes(query)
    );
  }, [friends, userSearch]);

  const suggestedFriends = useMemo(() => {
    const query = friendSearch.trim().toLowerCase();
    const friendIds = new Set(friends.map((friend) => friend.userId));
    return activeCommunityMembers.filter((member) => {
      if (friendIds.has(member.userId)) return false;
      if (!query) return true;
      return member.username.toLowerCase().includes(query) || member.subtitle.toLowerCase().includes(query);
    });
  }, [friendSearch, friends]);

  const selectedInviteMember = suggestedFriends[0] || friends.find((friend) =>
    friend.username.toLowerCase().includes(friendSearch.trim().toLowerCase())
  ) || activeCommunityMembers[0];

  const findMemberByThread = (thread: MessagesResponse['threads'][number]) => {
    const knownMembers = [...friends, ...activeCommunityMembers];
    const byUserId = knownMembers.find((item) => item.userId === thread.participant_user_id);
    if (byUserId) return byUserId;

    const username = (thread.title || thread.last_sender_username || '').replace(/^@/, '').trim().toLowerCase();
    return knownMembers.find((item) => item.username.toLowerCase() === username) || null;
  };

  const ensureThreadForMember = (member: CommunityMember) => {
    const now = new Date().toISOString();
    const threadId = [user?.user_id || 'me', member.userId].sort().join('::');
    setThreads((current) => {
      const withoutDuplicate = current.filter((thread) => thread.id !== threadId);
      return [
        {
          id: threadId,
          title: `@${member.username}`,
          preview: 'Uusi keskustelu valmiina. Kirjoita ensimmäinen viesti.',
          time: now,
          unread_count: 0,
          participant_user_id: member.userId,
          last_sender_username: member.username,
          last_sender_user_id: member.userId,
          direction: 'received',
          is_online: true,
        },
        ...withoutDuplicate,
      ];
    });
    return threadId;
  };

  const addFriend = (member: CommunityMember) => {
    setFriends((current) => current.some((friend) => friend.userId === member.userId) ? current : [...current, member]);
    ensureThreadForMember(member);
  };

  const openChatWithMember = (member: CommunityMember) => {
    addFriend(member);
    setActiveChatMember(member);
    setChatDraft('');
    setPeoplePickerOpen(false);
  };

  const startThreadWithMember = (member: CommunityMember) => {
    openChatWithMember(member);
    setScope('all');
  };

  const sendChatMessage = () => {
    if (!activeChatMember) return;
    const text = chatDraft.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const author = user?.username?.trim() || 'sinä';
    const member = activeChatMember;
    setChatHistories((current) => ({
      ...current,
      [member.userId]: [
        ...(current[member.userId] || []),
        {
          id: `message_${Date.now()}`,
          author,
          text,
          mine: true,
          time: now,
          createdAt: now,
        },
      ],
    }));
    setThreads((current) => {
      const threadId = [user?.user_id || 'me', member.userId].sort().join('::');
      const withoutDuplicate = current.filter((thread) => thread.id !== threadId);
      return [
        {
          id: threadId,
          title: `@${member.username}`,
          preview: text,
          time: now,
          unread_count: 0,
          participant_user_id: member.userId,
          last_sender_username: author,
          last_sender_user_id: user?.user_id || 'me',
          direction: 'sent',
          last_message_state: 'delivered',
          last_message_delivered_at: now,
          is_online: true,
        },
        ...withoutDuplicate,
      ];
    });
    setChatDraft('');
  };

  useEffect(() => {
    if (!activeChatMember) return;
    const timeoutId = setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timeoutId);
  }, [activeChatMember, chatHistories]);

  const activeChatMessages = activeChatMember ? chatHistories[activeChatMember.userId] || [] : [];

  const scopeButton = (value: MessageScope, label: string) => (
    <Pressable
      style={[styles.scopeButton, scope === value && styles.scopeButtonActive]}
      onPress={() => setScope(value)}
    >
      <Text style={[styles.scopeButtonText, scope === value && styles.scopeButtonTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, isRTL && styles.textRight]}>{t('messages')}</Text>
          <Text style={[styles.body, isRTL && styles.textRight]}>{t('messagesSubtitle')}</Text>
        </View>
        <Pressable style={styles.composeButton} onPress={openPeoplePicker}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.composeButtonText}>Aloita viesti</Text>
        </Pressable>
      </View>

      <View style={styles.scopeRow}>
        {scopeButton('all', t('messagesAll'))}
        {scopeButton('received', t('messagesReceived'))}
        {scopeButton('sent', t('messagesSent'))}
      </View>

      <View style={styles.friendsCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Aloita uusi keskustelu</Text>
            <Text style={styles.sectionSubtitle}>Etsi käyttäjä, lisää kaveriksi ja avaa yksityisviesti.</Text>
          </View>
          <Pressable style={styles.inviteButton} onPress={() => setInviteOpen(true)}>
            <Ionicons name="link" size={16} color="#fff" />
            <Text style={styles.inviteButtonText}>Lähetä kutsulinkki</Text>
          </Pressable>
        </View>
        <View style={styles.friendInviteRow}>
          <TextInput
            value={friendSearch}
            onChangeText={setFriendSearch}
            placeholder="Etsi käyttäjää nimellä"
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.friendSearchInput]}
          />
          <Pressable
            style={styles.quickInviteButton}
            onPress={() => openChatWithMember(selectedInviteMember)}
          >
            <Ionicons name="person-add" size={16} color="#fff" />
            <Text style={styles.quickInviteButtonText}>Lisää kaveriksi / Kutsu</Text>
          </Pressable>
        </View>

        <Text style={styles.listTitle}>Omat kaverit</Text>
        {friends.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.myFriendsRow}>
            {friends.map((friend) => (
              <Pressable key={friend.userId} style={styles.friendChip} onPress={() => openChatWithMember(friend)}>
                <View style={[styles.friendChipAvatar, { backgroundColor: friend.color }]}>
                  <Text style={styles.friendChipAvatarText}>{friend.initials}</Text>
                </View>
                <Text style={styles.friendChipText}>@{friend.username}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.friendEmptyText}>Lisää ensimmäinen kaveri ehdotuksista.</Text>
        )}

        <Text style={styles.listTitle}>Ehdotetut kaverit</Text>
        <View style={styles.suggestedList}>
          {suggestedFriends.map((member) => (
            <View key={member.userId} style={styles.suggestedFriendRow}>
              <View style={[styles.memberAvatar, { backgroundColor: member.color }]}>
                <Text style={styles.memberAvatarText}>{member.initials}</Text>
              </View>
              <View style={styles.memberTextWrap}>
                <Text style={styles.memberName}>@{member.username}</Text>
                <Text style={styles.memberSubtitle}>{member.subtitle}</Text>
              </View>
              <Pressable style={styles.addFriendButton} onPress={() => openChatWithMember(member)}>
                <Ionicons name="person-add" size={15} color="#0F62FE" />
                <Text style={styles.addFriendButtonText}>Lisää / Kutsu</Text>
              </Pressable>
            </View>
          ))}
          {!suggestedFriends.length ? <Text style={styles.friendEmptyText}>Ei uusia ehdotuksia tällä haulla.</Text> : null}
        </View>
      </View>

      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}
      <View style={[styles.messagingWorkspace, isCompact && styles.messagingWorkspaceCompact]}>
        <View style={styles.threadPane}>
          {filteredThreads.length === 0 && !activeChatMember ? (
            <View style={styles.emptyCard}>
              <View style={styles.iconWrap}>
                <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.threadName, isRTL && styles.textRight]}>{t('messagesEmptyTitle')}</Text>
                <Text style={[styles.preview, isRTL && styles.textRight]}>{t('messagesEmptyBody')}</Text>
                <Pressable style={styles.emptyActionButton} onPress={openPeoplePicker}>
                  <Ionicons name="search" size={15} color="#fff" />
                  <Text style={styles.emptyActionText}>Etsi ensimmäinen keskustelukaveri</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            filteredThreads.map((thread) => (
              <Pressable key={thread.id} style={styles.card} onPress={() => {
                const member = findMemberByThread(thread);
                if (member) openChatWithMember(member);
              }}>
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
                    onPress={() => {
                      const member = findMemberByThread(thread);
                      if (member) openChatWithMember(member);
                      else openPeoplePicker();
                    }}
                    disabled={!thread.participant_user_id}
                  >
                    <Text style={styles.replyButtonText}>{t('sendMessage')}</Text>
                  </Pressable>
                  {thread.unread_count ? <Badge tone="brand" count={thread.unread_count} compact countOnly /> : null}
                </View>
              </Pressable>
            ))
          )}
        </View>

        {activeChatMember ? (
          <View style={[styles.inlineChatCard, isCompact && styles.inlineChatCardCompact]}>
            <View style={styles.chatHeader}>
              <View style={[styles.memberAvatar, { backgroundColor: activeChatMember.color }]}>
                <Text style={styles.memberAvatarText}>{activeChatMember.initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chatTitle}>@{activeChatMember.username}</Text>
                <Text style={styles.chatSubtitle}>Keskustelu aktiivinen</Text>
              </View>
              <Pressable style={styles.modalCloseButton} onPress={() => setActiveChatMember(null)}>
                <Ionicons name="close" size={20} color="#111827" />
              </Pressable>
            </View>
            <ScrollView ref={chatScrollRef} style={styles.chatHistory} contentContainerStyle={styles.chatHistoryContent} keyboardShouldPersistTaps="handled">
              {activeChatMessages.length ? (
                activeChatMessages.map((message) => (
                  <View key={message.id} style={[styles.chatBubble, message.mine && styles.chatBubbleMine]}>
                    <Text style={[styles.chatBubbleAuthor, message.mine && styles.chatBubbleAuthorMine]}>@{message.author}</Text>
                    <Text style={[styles.chatBubbleText, message.mine && styles.chatBubbleTextMine]}>{message.text}</Text>
                  </View>
                ))
              ) : (
                <View style={styles.chatEmptyState}>
                  <Ionicons name="chatbubbles-outline" size={24} color="#64748B" />
                  <Text style={styles.chatEmptyTitle}>Kirjoita ensimmäinen viesti.</Text>
                </View>
              )}
            </ScrollView>
            <View style={styles.chatInputBar}>
              <TextInput
                value={chatDraft}
                onChangeText={setChatDraft}
                placeholder={t('messagesComposerPlaceholder')}
                autoCapitalize="sentences"
                returnKeyType="send"
                onSubmitEditing={sendChatMessage}
                blurOnSubmit={false}
                style={styles.chatInput}
              />
              <Pressable
                style={[styles.chatSendButton, !chatDraft.trim() && styles.chatSendButtonDisabled]}
                disabled={!chatDraft.trim()}
                onPress={sendChatMessage}
              >
                <Ionicons name="paper-plane" size={17} color="#fff" />
                {!isCompact ? <Text style={styles.chatSendButtonText}>Lähetä</Text> : null}
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      <Modal visible={peoplePickerOpen} transparent animationType="none" onRequestClose={() => setPeoplePickerOpen(false)}>
        <Animated.View style={[styles.modalBackdrop, { opacity: pickerAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPeoplePickerOpen(false)} />
          <Animated.View
            style={[
              styles.modalCard,
              isCompact && styles.modalCardCompact,
              {
                opacity: pickerAnim,
                transform: [
                  {
                    translateY: pickerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [isCompact ? 36 : 18, 0],
                    }),
                  },
                  {
                    scale: pickerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.97, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <View>
                <Text style={styles.modalTitle}>Aloita viesti</Text>
                <Text style={styles.modalSubtitle}>Valitse aktiivinen yhteisön jäsen.</Text>
              </View>
              <Pressable style={styles.modalCloseButton} onPress={() => setPeoplePickerOpen(false)}>
                <Ionicons name="close" size={20} color="#111827" />
              </Pressable>
            </View>
            <TextInput
              value={userSearch}
              onChangeText={setUserSearch}
              placeholder="Etsi käyttäjää..."
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.searchInput]}
            />
            <ScrollView style={styles.memberList} contentContainerStyle={styles.memberListContent} keyboardShouldPersistTaps="handled">
              {friends.length ? <Text style={styles.modalListLabel}>Omat kaverit</Text> : null}
              {filteredMembers.map((member) => (
                <Pressable key={member.userId} style={styles.memberRow} onPress={() => startThreadWithMember(member)}>
                  <View style={[styles.memberAvatar, { backgroundColor: member.color }]}>
                    <Text style={styles.memberAvatarText}>{member.initials}</Text>
                  </View>
                  <View style={styles.memberTextWrap}>
                    <Text style={styles.memberName}>@{member.username}</Text>
                    <Text style={styles.memberSubtitle}>{member.subtitle}</Text>
                  </View>
                  <Ionicons name="chatbubble-ellipses-outline" size={20} color="#0F62FE" />
                </Pressable>
              ))}
              {!filteredMembers.length ? (
                <View style={styles.noMembersCard}>
                  <Text style={styles.noMembersText}>Ei käyttäjiä tällä haulla.</Text>
                </View>
              ) : null}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>

      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.inviteModalCard}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Kutsulinkki valmis</Text>
                <Text style={styles.modalSubtitle}>Jaa tämä linkki kaverille ja aloita keskustelu.</Text>
              </View>
              <Pressable style={styles.modalCloseButton} onPress={() => setInviteOpen(false)}>
                <Ionicons name="close" size={20} color="#111827" />
              </Pressable>
            </View>
            <View style={styles.inviteLinkBox}>
              <Ionicons name="link-outline" size={18} color="#0F62FE" />
              <Text style={styles.inviteLinkText}>yosla.app/invite/demo-2026</Text>
            </View>
            <Pressable style={styles.inviteConfirmButton} onPress={() => setInviteOpen(false)}>
              <Ionicons name="share-social" size={17} color="#fff" />
              <Text style={styles.inviteConfirmText}>Simuloi jakaminen</Text>
            </Pressable>
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
  friendsCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dbeafe', borderRadius: 18, padding: 14, marginBottom: 14, gap: 12 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  sectionTitle: { color: '#111827', fontSize: 17, fontWeight: '900' },
  sectionSubtitle: { color: '#64748B', fontSize: 13, fontWeight: '700', marginTop: 3 },
  inviteButton: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#111827', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  inviteButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  friendInviteRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, flexWrap: 'wrap' },
  friendSearchInput: { flex: 1, minWidth: 210, minHeight: 46, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', fontWeight: '800' },
  quickInviteButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#0F62FE', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  quickInviteButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  listTitle: { color: '#111827', fontSize: 13, fontWeight: '900', marginTop: 2 },
  myFriendsRow: { gap: 8, paddingVertical: 2 },
  friendChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#DBEAFE', backgroundColor: '#F8FAFC', borderRadius: 999, paddingLeft: 5, paddingRight: 12, paddingVertical: 5 },
  friendChipAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  friendChipAvatarText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  friendChipText: { color: '#1E293B', fontSize: 12, fontWeight: '900' },
  friendEmptyText: { color: '#64748B', fontSize: 12, fontWeight: '700' },
  suggestedList: { gap: 8 },
  suggestedFriendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff', borderRadius: 14, padding: 10 },
  addFriendButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 8 },
  addFriendButtonText: { color: '#0F62FE', fontSize: 12, fontWeight: '900' },
  messagingWorkspace: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  messagingWorkspaceCompact: { flexDirection: 'column' },
  threadPane: { flex: 1, minWidth: 0 },
  inlineChatCard: { flex: 1.1, minWidth: 320, minHeight: 430, maxHeight: 620, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dbeafe', borderRadius: 18, overflow: 'hidden', marginBottom: 10 },
  inlineChatCardCompact: { minWidth: 0, minHeight: 460 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, marginBottom: 10 },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, marginBottom: 10 },
  emptyActionButton: { marginTop: 12, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#0F62FE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  emptyActionText: { color: '#fff', fontSize: 12, fontWeight: '900' },
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
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', padding: 16 },
  modalCard: { width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 12 },
  modalCardCompact: { maxHeight: '88%' },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  modalCloseButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  modalSubtitle: { color: '#64748B', fontSize: 13, marginTop: 3, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#111827' },
  searchInput: { minHeight: 48, borderColor: '#A5B4FC', backgroundColor: '#EEF2FF', fontWeight: '800' },
  memberList: { maxHeight: 360 },
  memberListContent: { gap: 8 },
  modalListLabel: { color: '#64748B', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff', borderRadius: 14, padding: 12 },
  memberAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  memberTextWrap: { flex: 1, minWidth: 0 },
  memberName: { color: '#111827', fontSize: 15, fontWeight: '900' },
  memberSubtitle: { color: '#64748B', fontSize: 12, fontWeight: '700', marginTop: 2 },
  noMembersCard: { borderRadius: 12, backgroundColor: '#F8FAFC', padding: 14, alignItems: 'center' },
  noMembersText: { color: '#64748B', fontWeight: '800' },
  chatBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.62)', justifyContent: 'center', padding: 16 },
  chatCard: { width: '100%', maxWidth: 620, height: '82%', alignSelf: 'center', backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' },
  chatCardCompact: { height: '92%', borderRadius: 18 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', padding: 14 },
  chatTitle: { color: '#111827', fontSize: 17, fontWeight: '900' },
  chatSubtitle: { color: '#64748B', fontSize: 12, fontWeight: '700', marginTop: 2 },
  chatHistory: { flex: 1, backgroundColor: '#F8FAFC' },
  chatHistoryContent: { flexGrow: 1, justifyContent: 'flex-end', gap: 8, padding: 14 },
  chatBubble: { alignSelf: 'flex-start', maxWidth: '84%', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 15, paddingHorizontal: 12, paddingVertical: 9 },
  chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#0F62FE', borderColor: '#0F62FE' },
  chatBubbleAuthor: { color: '#64748B', fontSize: 11, fontWeight: '900', marginBottom: 3 },
  chatBubbleAuthorMine: { color: '#DBEAFE' },
  chatBubbleText: { color: '#111827', fontSize: 14, lineHeight: 19, fontWeight: '600' },
  chatBubbleTextMine: { color: '#fff' },
  chatEmptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 40 },
  chatEmptyTitle: { color: '#475569', fontSize: 14, fontWeight: '800' },
  chatInputBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff', padding: 10 },
  chatInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: '#111827', fontSize: 14 },
  chatSendButton: { minHeight: 44, borderRadius: 14, backgroundColor: '#0F62FE', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  chatSendButtonDisabled: { opacity: 0.45 },
  chatSendButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  inviteModalCard: { width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 16, gap: 12 },
  inviteLinkBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', borderRadius: 14, padding: 12 },
  inviteLinkText: { flex: 1, color: '#1E3A8A', fontSize: 13, fontWeight: '900' },
  inviteConfirmButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0F62FE', borderRadius: 14, paddingVertical: 12 },
  inviteConfirmText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  messageInput: { minHeight: 120, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  modalButton: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, minWidth: 110, alignItems: 'center' },
  cancelButton: { backgroundColor: '#f3f4f6' },
  cancelButtonText: { color: '#374151', fontWeight: '800' },
  sendButton: { backgroundColor: '#007AFF' },
  sendButtonDisabled: { opacity: 0.7 },
  sendButtonText: { color: '#fff', fontWeight: '800' },
});
