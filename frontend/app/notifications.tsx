import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/contexts/AuthContext';
import { useApiClient } from '../src/hooks/useApiClient';
import { formatRelativeTime, formatLocalDateTime } from '../src/utils/time';
import { useI18n } from '../src/contexts/I18nContext';

type NotificationItem = {
  notification_id: string;
  actor_username: string;
  type: 'post_like' | 'post_comment' | 'user_follow' | string;
  post_id?: string | null;
  created_at: string;
  is_read?: boolean;
};

function NotificationsScreen() {
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
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

  const renderMessage = (item: NotificationItem) => {
    if (item.type === 'post_like') return `@${item.actor_username} tykkäsi julkaisustasi`;
    if (item.type === 'post_comment') return `@${item.actor_username} kommentoi julkaisua`;
    if (item.type === 'user_follow') return `@${item.actor_username} alkoi seurata sinua`;
    return `@${item.actor_username} teki uuden toiminnon`;
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

      <ScrollView contentContainerStyle={styles.content}>
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
        ) : (
          items.map((item) => (
              <TouchableOpacity
                key={item.notification_id}
                style={[styles.card, !item.is_read && styles.unreadCard]}
                onPress={() => openNotification(item)}
              >
              <Text style={styles.message}>{renderMessage(item)}</Text>
              <Text style={styles.date}>
                {formatRelativeTime(item.created_at) || formatLocalDateTime(item.created_at)}
              </Text>
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
    marginTop: 4,
    fontSize: 12,
    color: '#777',
  },
});
