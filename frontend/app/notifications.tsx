import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/contexts/AuthContext';
import { useApiClient } from '../src/hooks/useApiClient';
import { apiUrl } from '../src/utils/api/http';
import { formatRelativeTime, formatLocalDateTime } from '../src/utils/time';
import { useI18n } from '../src/contexts/I18nContext';

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

type NotificationFilter = 'all' | 'unread';
type NotificationTone = 'brand' | 'success' | 'warning' | 'muted';

const notificationToneStyles: Record<NotificationTone, { backgroundColor: string; color: string }> = {
  brand: { backgroundColor: '#EFF6FF', color: '#0F62FE' },
  success: { backgroundColor: '#ECFDF5', color: '#0F766E' },
  warning: { backgroundColor: '#FFFBEB', color: '#B45309' },
  muted: { backgroundColor: '#F8FAFC', color: '#64748B' },
};

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

  const filteredItems = useMemo(
    () => items.filter((item) => filter === 'unread' ? !item.is_read : true),
    [filter, items],
  );

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
    return `@${item.actor_username} teki uuden toiminnon`;
  };

  const renderDescription = (item: NotificationItem) => {
    if (item.type === 'post_like') return t('notificationsLikeHint');
    if (item.type === 'post_comment') return t('notificationsCommentHint');
    if (item.type === 'user_follow') return t('notificationsFollowHint');
    return t('notificationsGenericHint');
  };

  const resolveAvatarUrl = (avatarUrl?: string | null) => {
    if (!avatarUrl) return null;
    return avatarUrl.startsWith('/') ? apiUrl(avatarUrl) : avatarUrl;
  };

  const getTypeTone = (item: NotificationItem): NotificationTone => {
    if (item.type === 'post_like') return 'brand';
    if (item.type === 'post_comment') return 'success';
    if (item.type === 'user_follow') return 'warning';
    return 'muted';
  };

  const getTypeIcon = (item: NotificationItem) => {
    if (item.type === 'post_like') return 'heart';
    if (item.type === 'post_comment') return 'chatbubble';
    if (item.type === 'user_follow') return 'person-add';
    return 'notifications';
  };

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
    router.back();
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

  const unreadCount = items.filter((item) => !item.is_read).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.backButton, isRTL && styles.rowReverse]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#007AFF" />
          <Text style={[styles.backText, isRTL && styles.backTextRTL]}>{t('back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('notificationsTitle')}</Text>
        <TouchableOpacity style={styles.readAllButton} onPress={markAllAsRead}>
          <Text style={styles.readAllText}>{t('markAllRead')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        <TouchableOpacity style={[styles.filterChip, filter === 'all' && styles.filterChipActive]} onPress={() => setFilter('all')}>
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>{t('all')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterChip, filter === 'unread' && styles.filterChipActive]} onPress={() => setFilter('unread')}>
          <Text style={[styles.filterText, filter === 'unread' && styles.filterTextActive]}>{t('unread')}</Text>
        </TouchableOpacity>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{unreadCount}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadNotifications} />}
      >
        <View style={[styles.personaCard, isNewAccount ? styles.personaCardExplore : styles.personaCardPersonal]}>
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
        {loading ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>{t('noNotifications')}</Text>
        ) : filteredItems.length === 0 ? (
          <Text style={styles.empty}>{filter === 'unread' ? t('notificationsNoUnread') : t('noNotifications')}</Text>
        ) : (
          filteredItems.map((item) => (
            <TouchableOpacity
              key={item.notification_id}
              style={[styles.card, !item.is_read && styles.unreadCard]}
              onPress={() => openNotification(item)}
            >
              <View style={styles.cardHeader}>
                {resolveAvatarUrl(item.actor_profile_picture) ? (
                  <Image source={{ uri: resolveAvatarUrl(item.actor_profile_picture) || undefined }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Ionicons name={getTypeIcon(item)} size={14} color="#fff" />
                  </View>
                )}
                <View style={styles.cardHeaderText}>
                  <Text style={styles.message}>{renderMessage(item)}</Text>
                  <Text style={styles.description}>{renderDescription(item)}</Text>
                </View>
                <View style={styles.badgeWrap}>
                  <Text
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor: notificationToneStyles[getTypeTone(item)].backgroundColor,
                        color: notificationToneStyles[getTypeTone(item)].color,
                      },
                    ]}
                  >
                    {t(`notificationType_${item.type}`) || item.type}
                  </Text>
                </View>
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.date}>{formatRelativeTime(item.created_at) || formatLocalDateTime(item.created_at)}</Text>
                {item.is_read ? <Text style={styles.readState}>{t('read')}</Text> : <Text style={styles.unreadState}>{t('unread')}</Text>}
              </View>
            </TouchableOpacity>
          ))
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
    gap: 10,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
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
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    paddingHorizontal: 8,
  },
  countPillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  personaCard: {
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
  empty: {
    fontSize: 14,
    color: '#777',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
    padding: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardHeaderText: {
    flex: 1,
  },
  badgeWrap: {
    alignItems: 'flex-end',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dbeafe',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
  },
  description: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748B',
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: '900',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  typeBadge_brand: {
    backgroundColor: '#EFF6FF',
    color: '#0F62FE',
  },
  typeBadge_success: {
    backgroundColor: '#ECFDF5',
    color: '#0F766E',
  },
  typeBadge_warning: {
    backgroundColor: '#FFFBEB',
    color: '#B45309',
  },
  typeBadge_muted: {
    backgroundColor: '#F8FAFC',
    color: '#64748B',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  unreadCard: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f7ff',
  },
  message: {
    fontSize: 14,
    color: '#222',
    fontWeight: '600',
  },
  date: {
    fontSize: 12,
    color: '#777',
  },
  readState: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  unreadState: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F62FE',
  },
});
