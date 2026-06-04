import { Tabs, Redirect, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/contexts/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useI18n } from '../../src/contexts/I18nContext';
import { hasCompletedOnboarding, isNewUserProfile } from '../../src/utils/onboarding';
import { canModerate, isSuperAdmin } from '../../src/utils/roles';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { token, user, loading } = useAuth();
  const { t, isRTL, isReady } = useI18n();
  const { apiFetch } = useApiClient();
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(true);
  const canSeeModerationTabs = canModerate(user?.role);
  const canSeeProjectsTab = isSuperAdmin(user?.role);

  useEffect(() => {
    const resolveOnboarding = async () => {
      try {
        if (!user?.user_id) {
          setHasOnboarded(true);
          return;
        }
        const shouldShow = isNewUserProfile(user);
        if (!shouldShow) {
          setHasOnboarded(true);
          return;
        }
        const completed = await hasCompletedOnboarding(user.user_id);
        setHasOnboarded(completed);
      } catch (error) {
        console.error('Error resolving onboarding state:', error);
        setHasOnboarded(true);
      } finally {
        setOnboardingReady(true);
      }
    };

    resolveOnboarding();
  }, [user, user?.user_id, user?.posts_count, user?.followers_count, user?.following_count]);

  useEffect(() => {
    const loadUnread = async () => {
      if (!token) {
        setNotificationUnreadCount(0);
        setMessageUnreadCount(0);
        return;
      }
      try {
        const [notificationResponse, messagesResponse] = await Promise.all([
          apiFetch('/notifications/unread-count'),
          apiFetch('/messages?limit=1'),
        ]);
        if (notificationResponse?.ok) {
          const payload = await notificationResponse.json();
          setNotificationUnreadCount(Number(payload?.unread_count || 0));
        }
        if (messagesResponse?.ok) {
          const payload = await messagesResponse.json();
          setMessageUnreadCount(Number(payload?.unread_count || 0));
        }
      } catch (error) {
        console.error('Error loading unread counts:', error);
      }
    };

    loadUnread();
    const intervalId = setInterval(loadUnread, 30000);
    return () => clearInterval(intervalId);
  }, [token, pathname, apiFetch]);

  if (loading || !isReady || !onboardingReady) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!token || !user) {
    return <Redirect href="/(auth)/login" />;
  }

  if (isNewUserProfile(user) && !hasOnboarded && pathname !== '/onboarding') {
    return <Redirect href="/onboarding" />;
  }

  return (
    <Tabs
      key={isRTL ? 'rtl' : 'ltr'}
      screenLayout={({ children }) => (
        <View style={[styles.screenLayout, isRTL ? styles.screenLayoutRTL : undefined] as any}>{children}</View>
      )}
      initialRouteName="feed"
      screenOptions={{
        tabBarPosition: 'top',
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#8E8E93',
        tabBarItemStyle: {
          flex: 1,
        },
        tabBarStyle: {
          backgroundColor: '#fff',
          borderBottomWidth: 1,
          borderBottomColor: '#E5E5EA',
          borderTopWidth: 0,
          height: 60 + insets.top,
          paddingTop: insets.top + 6,
          paddingBottom: 6,
        },
        headerStyle: {
          backgroundColor: '#007AFF',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
      >
        <Tabs.Screen
          name="onboarding"
          options={{
            href: null,
          }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: t('feed'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('explore'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t('search'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: t('createPost'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('messages'),
          tabBarLabel: t('messages'),
          tabBarBadge: messageUnreadCount > 0 ? messageUnreadCount : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="network"
        options={{
          title: t('connections'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="communities"
        options={{
          title: t('communities'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      {canSeeModerationTabs ? (
        <Tabs.Screen
          name="moderation"
          options={{
            title: t('moderation'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="shield-checkmark" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      {canSeeProjectsTab ? (
        <Tabs.Screen
          name="projects"
          options={{
            title: t('projects'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="briefcase" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      {canSeeModerationTabs ? (
        <Tabs.Screen
          name="admin"
          options={{
            title: t('admin'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings" size={size} color={color} />
            ),
          }}
        />
      ) : null}
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarBadge: notificationUnreadCount > 0 ? notificationUnreadCount : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  screenLayout: { flex: 1 },
  screenLayoutRTL: { writingDirection: 'rtl' as any },
});
