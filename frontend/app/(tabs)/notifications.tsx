import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../src/contexts/AuthContext';
import { useApiClient } from '../../src/hooks/useApiClient';
import { formatRelativeTime, formatLocalDateTime } from '../../src/utils/time';
import { useI18n } from '../../src/contexts/I18nContext';

type NotificationItem = {
  notification_id: string;
  actor_username: string;
  actor_profile_picture?: string | null;
  type: 'post_like' | 'post_comment' | 'user_follow' | string;
  post_id?: string | null;
  comment_id?: string | null;
  created_at: string;
  is_read?: boolean;
};

type NotificationFilter = 'all' | 'activity';
type NotificationTone = 'brand' | 'success' | 'warning' | 'muted';
type RichNotificationType = 'live' | 'reward' | 'social' | 'community' | 'system';

type RichNotificationItem = {
  id: string;
  type: RichNotificationType;
  tab: NotificationFilter;
  actor: string;
  avatarInitials: string;
  avatarColor: string;
  badgeIcon: keyof typeof Ionicons.glyphMap;
  badgeColor: string;
  title: string;
  body: string;
  time: string;
  unread?: boolean;
  actionLabel?: string;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  trailingColor?: string;
  snippet?: {
    label: string;
    colors: [string, string];
  };
};

const notificationToneStyles: Record<NotificationTone, { backgroundColor: string; color: string }> = {
  brand: { backgroundColor: '#EFF6FF', color: '#0F62FE' },
  success: { backgroundColor: '#ECFDF5', color: '#0F766E' },
  warning: { backgroundColor: '#FFFBEB', color: '#B45309' },
  muted: { backgroundColor: '#F8FAFC', color: '#64748B' },
};

const mockNotifications: RichNotificationItem[] = [
  {
    id: 'live-koodari-maisteri',
    type: 'live',
    tab: 'all',
    actor: '@koodari_maisteri',
    avatarInitials: 'KM',
    avatarColor: '#0F62FE',
    badgeIcon: 'radio',
    badgeColor: '#DC2626',
    title: 'Käyttäjä @koodari_maisteri aloitti LIVE-lähetyksen',
    body: '"Koodataan uutta somea!" 🔴',
    time: 'Nyt',
    unread: true,
    actionLabel: 'Liity mukaan',
  },
  {
    id: 'reward-weekly-discussion',
    type: 'reward',
    tab: 'activity',
    actor: 'YOSLA',
    avatarInitials: 'YO',
    avatarColor: '#8A2BE2',
    badgeIcon: 'trophy',
    badgeColor: '#F59E0B',
    title: 'Onneksi olkoon!',
    body: 'Ansaitsit "Viikon keskustelija" -aktiivisuusmerkin ja +500 YOSLA-pistettä! 🏆',
    time: '12 min',
    unread: true,
    trailingIcon: 'shield-checkmark',
    trailingColor: '#8A2BE2',
  },
  {
    id: 'social-metsamatkailija',
    type: 'social',
    tab: 'all',
    actor: '@metsamatkailija',
    avatarInitials: 'MM',
    avatarColor: '#059669',
    badgeIcon: 'heart',
    badgeColor: '#E11D48',
    title: 'Käyttäjä @metsamatkailija tykkäsi julkaisustasi',
    body: 'ja reagoi: 🚀',
    time: '28 min',
    snippet: {
      label: 'Kesäilta järvellä',
      colors: ['#7DD3FC', '#14532D'],
    },
  },
  {
    id: 'community-photo-challenge',
    type: 'community',
    tab: 'activity',
    actor: '#valokuvaus',
    avatarInitials: '#V',
    avatarColor: '#0EA5E9',
    badgeIcon: 'camera',
    badgeColor: '#0F62FE',
    title: 'Uusi haaste on alkanut yhteisössä #valokuvaus',
    body: '"Kesäyön valot". Osallistu ja ansaitse Streak-pisteitä! 📸',
    time: '1 h',
  },
];

function NotificationsScreen() {
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const isNewAccount = (user?.posts_count ?? 0) < 3 && (user?.followers_count ?? 0) === 0 && (user?.following_count ?? 0) <= 2;

  const loadNotifications = useCallback(async () => {
    if (!token) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const response = await apiFetch('/notifications?limit=50');
      if (!response || response.status === 401) return;
      if (response.ok) {
        const data = await response.json();
        setItems(Array.isArray(data) ? data : []);
      } else {
        setItems([]);
        Alert.alert(t('error'), t('notificationsLoadFailed'));
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      Alert.alert(t('error'), t('notificationsLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [token, apiFetch, t]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications])
  );

  useEffect(() => {
    if (!token) return undefined;
    const intervalId = setInterval(() => {
      void loadNotifications();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [loadNotifications, token]);

  const renderMessage = (item: NotificationItem) => {
    if (item.type === 'post_like') return `@${item.actor_username} tykkäsi julkaisustasi`;
    if (item.type === 'post_comment') return `@${item.actor_username} kommentoi julkaisua`;
    if (item.type === 'user_follow') return `@${item.actor_username} alkoi seurata sinua`;
    if (item.type === 'moderation_content_approved') return 'Julkaisusi hyväksyttiin';
    if (item.type === 'moderation_distribution_limited') return 'Julkaisusi jakelua rajoitettiin';
    if (item.type === 'moderation_warning') return 'Sait moderointivaroituksen';
    if (item.type === 'moderation_content_removed') return 'Julkaisusi poistettiin';
    if (item.type === 'moderation_trust_score_updated') return 'Trust Score päivitettiin';
    return `@${item.actor_username} teki uuden toiminnon`;
  };

  const renderDescription = (item: NotificationItem) => {
    if (item.type === 'post_like') return t('notificationsLikeHint');
    if (item.type === 'post_comment') return t('notificationsCommentHint');
    if (item.type === 'user_follow') return t('notificationsFollowHint');
    if (item.type === 'moderation_content_approved') return 'Sisältö on tarkistettu ja näkyvyys palautettu normaaliksi.';
    if (item.type === 'moderation_distribution_limited') return 'Sisältö voi sisältää musiikki- tai tekijänoikeusriskin, joten sen jakelua on rajoitettu.';
    if (item.type === 'moderation_warning') return 'Tarkista käyttöehdot ja vältä uusia rikkomuksia, jotta Trust Score palautuu.';
    if (item.type === 'moderation_content_removed') return 'Sisältö poistettiin tai piilotettiin sääntöjen rikkomisen vuoksi.';
    if (item.type === 'moderation_trust_score_updated') return 'Näet nykyisen tilanteen asetusten Account Health -kortista.';
    return t('notificationsGenericHint');
  };

  const getTypeTone = (item: NotificationItem): NotificationTone => {
    if (item.type === 'post_like') return 'brand';
    if (item.type === 'post_comment') return 'success';
    if (item.type === 'user_follow') return 'warning';
    if (item.type.startsWith('moderation_')) return item.type === 'moderation_content_approved' ? 'success' : 'warning';
    return 'muted';
  };

  const getTypeIcon = (item: NotificationItem): keyof typeof Ionicons.glyphMap => {
    if (item.type === 'post_like') return 'heart';
    if (item.type === 'post_comment') return 'chatbubble';
    if (item.type === 'user_follow') return 'person-add';
    if (item.type === 'moderation_content_approved') return 'shield-checkmark';
    if (item.type === 'moderation_distribution_limited') return 'volume-mute';
    if (item.type === 'moderation_warning') return 'warning';
    if (item.type === 'moderation_content_removed') return 'trash';
    if (item.type === 'moderation_trust_score_updated') return 'speedometer';
    return 'notifications';
  };

  const backendNotifications: RichNotificationItem[] = items.map((item) => ({
    id: item.notification_id,
    type: 'system',
    tab: 'all',
    actor: `@${item.actor_username}`,
    avatarInitials: item.actor_username.slice(0, 2).toUpperCase(),
    avatarColor: notificationToneStyles[getTypeTone(item)].color,
    badgeIcon: getTypeIcon(item),
    badgeColor: notificationToneStyles[getTypeTone(item)].color,
    title: renderMessage(item),
    body: renderDescription(item),
    time: formatRelativeTime(item.created_at) || formatLocalDateTime(item.created_at),
    unread: !item.is_read,
  }));

  const richItems = backendNotifications.length > 0 ? backendNotifications : mockNotifications;

  const filteredItems = useMemo(
    () => richItems.filter((item) => filter === 'all' ? true : item.tab === 'activity'),
    [filter, richItems],
  );

  const openRichNotification = (item: RichNotificationItem) => {
    if (item.type === 'live') {
      router.push('/(tabs)/live');
      return;
    }
    if (item.type === 'community') {
      router.push('/(tabs)/communities');
      return;
    }
    if (item.type === 'social') {
      router.push('/(tabs)/feed');
      return;
    }
    if (item.type === 'system') {
      const backendItem = items.find((candidate) => candidate.notification_id === item.id);
      if (backendItem) {
        void openNotification(backendItem);
      }
    }
  };

  const goBackOrFeed = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.push('/(tabs)/feed');
  };

  const renderAvatar = (item: RichNotificationItem) => (
    <View style={[styles.richAvatar, { backgroundColor: item.avatarColor }]}>
      <Text style={styles.richAvatarText}>{item.avatarInitials}</Text>
      <View style={[styles.microBadge, { backgroundColor: item.badgeColor }]}>
        <Ionicons name={item.badgeIcon} size={11} color="#fff" />
      </View>
    </View>
  );

  const renderSnippet = (item: RichNotificationItem) => {
    if (!item.snippet) return null;
    return (
      <LinearGradient colors={item.snippet.colors} style={styles.postSnippet}>
        <Ionicons name="image-outline" size={15} color="#fff" />
        <Text style={styles.postSnippetText}>{item.snippet.label}</Text>
      </LinearGradient>
    );
  };

  const renderRichNotification = (item: RichNotificationItem) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.richCard, item.unread && styles.richCardUnread]}
      onPress={() => openRichNotification(item)}
      activeOpacity={0.84}
    >
      {renderAvatar(item)}
      <View style={styles.richContent}>
        <View style={styles.richMetaRow}>
          <Text style={styles.richActor}>{item.actor}</Text>
          <Text style={styles.richTime}>{item.time}</Text>
        </View>
        <Text style={styles.richTitle}>{item.title}</Text>
        <Text style={styles.richBody}>{item.body}</Text>
        {item.actionLabel ? (
          <TouchableOpacity style={styles.primaryAction} onPress={() => router.push('/(tabs)/live')} activeOpacity={0.85}>
            <Ionicons name="play-circle" size={16} color="#fff" />
            <Text style={styles.primaryActionText}>{item.actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {renderSnippet(item)}
      {item.trailingIcon ? (
        <View style={[styles.trailingShield, { backgroundColor: `${item.trailingColor}18` }]}>
          <Ionicons name={item.trailingIcon} size={30} color={item.trailingColor} />
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyCard}>
      <View style={styles.bellHalo}>
        <View style={styles.bellHaloInner}>
          <Ionicons name="notifications" size={54} color="rgba(15, 98, 254, 0.38)" />
          <View style={styles.bellRingOne} />
          <View style={styles.bellRingTwo} />
        </View>
      </View>
      <Text style={styles.emptyTitle}>Ilmoituksistasi tulee rikkaampia</Text>
      <Text style={styles.emptySubtitle}>
        Tykkäykset, kommentit, live-lähetykset ja saavutetut merkit auttavat nostamaan tärkeimmät päivitykset ensin näkyviin.
      </Text>
      <TouchableOpacity style={styles.emptyActionButton} onPress={() => router.push('/(tabs)/feed')} activeOpacity={0.85}>
        <Ionicons name="compass-outline" size={17} color="#fff" />
        <Text style={styles.emptyActionText}>Löydä kiinnostavaa sisältöä</Text>
      </TouchableOpacity>
    </View>
  );

  const openNotification = async (item: NotificationItem) => {
    if (!token) return;
    try {
      const response = await apiFetch(`/notifications/${item.notification_id}/read`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      setItems((prev) =>
        prev.map((n) => (n.notification_id === item.notification_id ? { ...n, is_read: true } : n))
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }

    if (item.post_id) {
      router.push(`/(tabs)/feed?highlightPostId=${item.post_id}`);
      return;
    }
    goBackOrFeed();
  };

  const markAllAsRead = async () => {
    if (!token) return;
    try {
      const response = await apiFetch('/notifications/read-all', {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      if (response.ok) {
        setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      } else {
        Alert.alert(t('error'), t('notificationsMarkReadFailed'));
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      Alert.alert(t('error'), t('notificationsMarkReadFailed'));
    }
  };

  const unreadCount = richItems.filter((item) => item.unread).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.backButton, isRTL && styles.rowReverse]} onPress={goBackOrFeed}>
          <Ionicons name="arrow-back" size={22} color="#007AFF" />
          <Text style={[styles.backText, isRTL && styles.backTextRTL]}>{t('back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('notificationsTitle')}</Text>
        <TouchableOpacity style={styles.readAllButton} onPress={markAllAsRead}>
          <Text style={styles.readAllText}>{t('markAllRead')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadNotifications} />}
      >
        <View style={styles.centerHeader}>
          <View>
            <Text style={styles.centerKicker}>YOSLA CENTER</Text>
            <Text style={styles.centerTitle}>Päivitykset ja palkinnot</Text>
          </View>
          <View style={styles.countPill}>
            <Ionicons name="flash" size={12} color="#fff" />
            <Text style={styles.countPillText}>{unreadCount}</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity style={[styles.filterChip, filter === 'all' && styles.filterChipActive]} onPress={() => setFilter('all')}>
            <Ionicons name="notifications-outline" size={15} color={filter === 'all' ? '#fff' : '#334155'} />
            <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>Kaikki</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterChip, filter === 'activity' && styles.filterChipActive]} onPress={() => setFilter('activity')}>
            <Ionicons name="sparkles-outline" size={15} color={filter === 'activity' ? '#fff' : '#334155'} />
            <Text style={[styles.filterText, filter === 'activity' && styles.filterTextActive]}>Toimintasi</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.personaCard, isNewAccount ? styles.personaCardExplore : styles.personaCardPersonal]}>
          <View style={styles.personaIcon}>
            <Ionicons name={isNewAccount ? 'compass-outline' : 'shield-checkmark-outline'} size={18} color="#0F62FE" />
          </View>
          <View style={styles.personaCopy}>
            <Text style={styles.personaLabel}>
              {isNewAccount ? t('notificationsExploreModeLabel') : t('notificationsPersonalModeLabel')}
            </Text>
            <Text style={styles.personaTitle}>
              {isNewAccount ? t('notificationsExploreModeTitle') : t('notificationsPersonalModeTitle')}
            </Text>
            <Text style={styles.personaBody}>
              {isNewAccount ? t('notificationsExploreModeBody') : t('notificationsPersonalModeBody')}
            </Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : filteredItems.length === 0 ? (
          renderEmptyState()
        ) : (
          filteredItems.map(renderRichNotification)
        )}
      </ScrollView>
    </View>
  );
}

export default NotificationsScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9e9e9',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  backText: {
    color: '#007AFF',
    fontWeight: '600',
    marginLeft: 6,
  },
  backTextRTL: {
    marginLeft: 0,
    marginRight: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  readAllButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  readAllText: {
    color: '#007AFF',
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    padding: 16,
    gap: 12,
  },
  centerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
  },
  centerKicker: {
    color: '#0F62FE',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  centerTitle: {
    marginTop: 3,
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF2FF',
    borderRadius: 14,
    padding: 4,
  },
  filterChip: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
  },
  filterChipActive: {
    backgroundColor: '#0F62FE',
  },
  filterText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  filterTextActive: {
    color: '#fff',
  },
  countPill: {
    minWidth: 46,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  countPillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  personaCard: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  personaCardExplore: {
    backgroundColor: '#F7FBFF',
    borderColor: '#CFE4FF',
  },
  personaCardPersonal: {
    backgroundColor: '#F5F9F4',
    borderColor: '#D6E8D1',
  },
  personaLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#60708A',
    marginBottom: 4,
  },
  personaTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#16233A',
    marginBottom: 4,
  },
  personaBody: {
    fontSize: 13,
    lineHeight: 19,
    color: '#3F4B63',
  },
  personaIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  personaCopy: {
    flex: 1,
  },
  richCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 12,
    elevation: 2,
  },
  richCardUnread: {
    borderColor: '#BFDBFE',
    backgroundColor: '#F8FBFF',
  },
  richAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  richAvatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  microBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  richContent: {
    flex: 1,
    minWidth: 0,
  },
  richMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  richActor: {
    flex: 1,
    color: '#0F62FE',
    fontSize: 12,
    fontWeight: '900',
  },
  richTime: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  richTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  richBody: {
    marginTop: 3,
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  primaryAction: {
    marginTop: 10,
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: '#0F62FE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  trailingShield: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postSnippet: {
    width: 58,
    height: 58,
    borderRadius: 12,
    overflow: 'hidden',
    padding: 6,
    justifyContent: 'space-between',
  },
  postSnippetText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 11,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DCEBFF',
    paddingHorizontal: 22,
    paddingVertical: 28,
    overflow: 'hidden',
  },
  bellHalo: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: 'rgba(15, 98, 254, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  bellHaloInner: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(15, 98, 254, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellRingOne: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    borderColor: 'rgba(15, 98, 254, 0.14)',
  },
  bellRingTwo: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 1,
    borderColor: 'rgba(15, 98, 254, 0.08)',
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 8,
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyActionButton: {
    marginTop: 18,
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: '#0F62FE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emptyActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  unreadState: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F62FE',
  },
});
