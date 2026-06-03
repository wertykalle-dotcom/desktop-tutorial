import { Tabs, Redirect, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/contexts/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useI18n } from '../../src/contexts/I18nContext';
import { hasCompletedOnboarding, isNewUserProfile } from '../../src/utils/onboarding';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { token, user, loading } = useAuth();
  const { t, isRTL, isReady } = useI18n();
  const { apiFetch } = useApiClient();
  const [unreadCount, setUnreadCount] = useState(0);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(true);

  useEffect(() => {
    const resolveOnboarding = async () => {
      if (!user?.user_id) {
        setHasOnboarded(true);
        setOnboardingReady(true);
        return;
      }
      const shouldShow = isNewUserProfile(user);
      if (!shouldShow) {
        setHasOnboarded(true);
        setOnboardingReady(true);
        return;
      }
      const completed = await hasCompletedOnboarding(user.user_id);
      setHasOnboarded(completed);
      setOnboardingReady(true);
    };

    resolveOnboarding();
  }, [user, user?.user_id, user?.posts_count, user?.followers_count, user?.following_count]);

  useEffect(() => {
    const loadUnread = async () => {
      if (!token) {
        setUnreadCount(0);
        return;
      }
      try {
        const response = await apiFetch('/notifications/unread-count');
        if (!response || response.status === 401) {
          return;
        }
        if (response.ok) {
          const payload = await response.json();
          setUnreadCount(Number(payload?.unread_count || 0));
        }
      } catch (error) {
        console.error('Error loading unread notifications count:', error);
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

  if (isNewUserProfile(user) && !hasOnboarded && pathname !== '/(tabs)/onboarding') {
    return <Redirect href="/(tabs)/onboarding" />;
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
        name="create"
        options={{
          title: t('createPost'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
      {user?.role === 'Super Admin' ? (
        <Tabs.Screen
          name="admin"
          options={{
            title: t('admin'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="shield-checkmark" size={size} color={color} />
            ),
          }}
        />
      ) : null}
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
