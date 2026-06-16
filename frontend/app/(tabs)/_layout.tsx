import { Tabs, Redirect, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/contexts/AuthContext';
import { View, ActivityIndicator, StyleSheet, useWindowDimensions, Pressable, Text } from 'react-native';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useI18n } from '../../src/contexts/I18nContext';
import { hasCompletedOnboarding, isNewUserProfile } from '../../src/utils/onboarding';
import { canModerate, isSuperAdmin } from '../../src/utils/roles';

type ShellNavItem = {
  label: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
  prominent?: boolean;
};

const desktopNavItems: ShellNavItem[] = [
  { label: 'Syöte', route: '/(tabs)/feed', icon: 'home-outline' },
  { label: 'Tutki', route: '/(tabs)/explore', icon: 'compass-outline' },
  { label: 'Livenä', route: '/(tabs)/live', icon: 'radio-outline' },
  { label: 'Keskustelut', route: '/(tabs)/discussions', icon: 'chatbubbles-outline' },
  { label: 'Media', route: '/(tabs)/media', icon: 'images-outline' },
  { label: 'Viestit', route: '/(tabs)/messages', icon: 'mail-unread-outline' },
  { label: 'Yhteisöt', route: '/(tabs)/communities', icon: 'people-outline' },
  { label: 'Tallennetut', route: '/(tabs)/saved', icon: 'bookmark-outline' },
  { label: 'Ilmoitukset', route: '/(tabs)/notifications', icon: 'notifications-outline' },
  { label: 'Profiili', route: '/(tabs)/profile', icon: 'person-outline' },
  { label: 'Asetukset', route: '/(tabs)/settings', icon: 'settings-outline' },
];

const mobileNavItems: ShellNavItem[] = [
  { label: 'Syöte', route: '/(tabs)/feed', icon: 'home-outline' },
  { label: 'Tutki', route: '/(tabs)/explore', icon: 'compass-outline' },
  { label: '+', route: '/(tabs)/create', icon: 'add', prominent: true },
  { label: 'Livenä', route: '/(tabs)/live', icon: 'radio-outline' },
  { label: 'Ilmoitukset', route: '/(tabs)/notifications', icon: 'notifications-outline' },
  { label: 'Profiili', route: '/(tabs)/profile', icon: 'person-outline' },
];

function YoslaTabBar({
  isMobile,
  bottomInset,
  notificationUnreadCount,
  messageUnreadCount,
}: {
  isMobile: boolean;
  bottomInset: number;
  notificationUnreadCount: number;
  messageUnreadCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const navItems = (isMobile ? mobileNavItems : desktopNavItems).map((item) => {
    if (item.route.includes('messages')) return { ...item, badge: messageUnreadCount };
    if (item.route.includes('notifications')) return { ...item, badge: notificationUnreadCount };
    return item;
  });

  const isActive = (route: string) => {
    if (route.includes('notifications')) return pathname.includes('/notifications');
    if (route.includes('messages')) return pathname.includes('/messages');
    const routeName = route.split('/').pop() || '';
    return pathname.endsWith(`/${routeName}`) || pathname === routeName;
  };

  const navigateTo = (route: string) => {
    router.replace(route as never);
  };

  if (isMobile) {
    return (
      <View style={[styles.mobileTabBar, { paddingBottom: Math.max(bottomInset, 8) }]}>
        {navItems.map((item) => {
          const active = isActive(item.route);
          return (
            <Pressable
              key={item.label}
              style={[styles.mobileNavItem, item.prominent && styles.mobileCreateItem]}
              onPress={() => navigateTo(item.route)}
              accessibilityRole="button"
              accessibilityLabel={item.label === '+' ? 'Luo' : item.label}
            >
              <View style={[styles.mobileIconShell, active && styles.mobileIconShellActive, item.prominent && styles.mobileCreateIcon]}>
                <Ionicons name={item.icon} size={item.prominent ? 24 : 20} color={item.prominent || active ? '#fff' : '#64748B'} />
                {item.badge ? <View style={styles.navBadge}><Text style={styles.navBadgeText}>{item.badge}</Text></View> : null}
              </View>
              <Text style={[styles.mobileNavLabel, active && styles.mobileNavLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.desktopSidebar}>
      <View style={styles.brandBlock}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>Y</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandTitle}>YOSLA</Text>
          <Text style={styles.brandSubtitle}>SOME LIFE</Text>
        </View>
      </View>

      <View style={styles.desktopNavList}>
        {navItems.map((item) => {
          const active = isActive(item.route);
          return (
            <Pressable
              key={`${item.label}-${item.route}`}
              style={[styles.desktopNavItem, active && styles.desktopNavItemActive]}
              onPress={() => navigateTo(item.route)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <View style={[styles.desktopIconShell, active && styles.desktopIconShellActive]}>
                <Ionicons name={item.icon} size={18} color={active ? '#fff' : '#0066FF'} />
              </View>
              <Text style={[styles.desktopNavText, active && styles.desktopNavTextActive]}>{item.label}</Text>
              {item.badge ? <View style={styles.navBadge}><Text style={styles.navBadgeText}>{item.badge}</Text></View> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.pointsWidget}>
        <Text style={styles.pointsKicker}>YOSLA-PISTEET</Text>
        <View style={styles.pointsBalanceRow}>
          <Ionicons name="diamond" size={20} color="#FF0055" />
          <Text style={styles.pointsBalance}>12 450</Text>
        </View>
        <View style={styles.streakRow}>
          <Text style={styles.streakLabel}>Streak 7 päivää 🔥</Text>
          <Text style={styles.streakPercent}>74%</Text>
        </View>
        <View style={styles.streakTrack}>
          <View style={styles.streakFill} />
        </View>
        <View style={styles.badgePill}>
          <Ionicons name="shield-checkmark" size={16} color="#8A2BE2" />
          <Text style={styles.badgePillText}>Seuraava merkki: Keskustelija</Text>
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { token, user, loading } = useAuth();
  const { t, isRTL, isReady } = useI18n();
  const { apiFetch } = useApiClient();
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(true);
  const canSeeAdminTabs = isSuperAdmin(user?.role);
  const canSeeModerationTab = canModerate(user?.role);
  const isMobile = width < 768;

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
      tabBar={() => (
        <YoslaTabBar
          isMobile={isMobile}
          bottomInset={insets.bottom}
          notificationUnreadCount={notificationUnreadCount}
          messageUnreadCount={messageUnreadCount}
        />
      )}
      initialRouteName="feed"
      screenOptions={{
        tabBarPosition: isMobile ? 'bottom' : 'left',
        tabBarActiveTintColor: isMobile ? '#fff' : '#ef4444',
        tabBarInactiveTintColor: isMobile ? '#B8C0D8' : '#64748B',
        tabBarScrollEnabled: !isMobile,
        tabBarItemStyle: {
          width: isMobile ? undefined : 112,
        },
        tabBarStyle: {
          backgroundColor: isMobile ? '#08111f' : '#fff',
          borderBottomWidth: isMobile ? 0 : 1,
          borderBottomColor: '#FFE1E1',
          borderTopWidth: isMobile ? 1 : 0,
          borderTopColor: 'rgba(255,255,255,0.12)',
          height: isMobile ? 66 + insets.bottom : 60 + insets.top,
          paddingTop: isMobile ? 6 : insets.top + 6,
          paddingBottom: isMobile ? Math.max(insets.bottom, 8) : 6,
          shadowColor: '#ef4444',
          shadowOpacity: isMobile ? 0.22 : 0,
          shadowRadius: isMobile ? 18 : 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '900' },
        headerStyle: {
          backgroundColor: '#ef4444',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        headerShown: false,
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
          title: isMobile ? 'Syöte' : t('feed'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="media"
        options={{
          title: 'Media',
          href: isMobile ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="images" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="discussions"
        options={{
          title: 'Keskustelut',
          href: isMobile ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: isMobile ? 'Tutki' : t('explore'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t('search'),
          href: isMobile ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: isMobile ? 'Luo' : t('createPost'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: isMobile ? 'Live' : 'Livenä',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="radio" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages/index"
        options={{
          title: t('messages'),
          tabBarLabel: t('messages'),
          href: isMobile ? null : undefined,
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
          href: isMobile ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-circle" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="communities"
        options={{
          title: t('communities'),
          href: isMobile ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="moderation"
        options={{
          title: t('moderation'),
          href: !isMobile && canSeeModerationTab ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="shield-checkmark" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: t('projects'),
          href: !isMobile && canSeeAdminTabs ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: t('admin'),
          href: !isMobile && canSeeAdminTabs ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Ilmoitukset',
          href: isMobile ? null : undefined,
          tabBarBadge: notificationUnreadCount > 0 ? notificationUnreadCount : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Tallennetut',
          href: isMobile ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bookmark" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Asetukset',
          href: isMobile ? null : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: isMobile ? 'Profiili' : t('profile'),
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
  screenLayout: { flex: 1, backgroundColor: '#F5F7FB' },
  screenLayoutRTL: { writingDirection: 'rtl' as any },
  desktopSidebar: {
    width: 280,
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#E5EAF2',
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 18,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#E5EAF2',
    marginBottom: 14,
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#0066FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0066FF',
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  brandMarkText: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
  },
  brandTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  brandSubtitle: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
  },
  desktopNavList: {
    gap: 6,
  },
  desktopNavItem: {
    minHeight: 44,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
  },
  desktopNavItemActive: {
    backgroundColor: '#0066FF',
  },
  desktopIconShell: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F7FA',
    borderWidth: 1,
    borderColor: '#E5EAF2',
  },
  desktopIconShellActive: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.28)',
  },
  desktopNavText: {
    flex: 1,
    color: '#334155',
    fontSize: 14,
    fontWeight: '800',
  },
  desktopNavTextActive: {
    color: '#fff',
  },
  navBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FF0055',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  navBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  pointsWidget: {
    marginTop: 'auto',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E7FF',
    backgroundColor: '#F5F7FA',
    padding: 14,
    gap: 9,
    shadowColor: '#0066FF',
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  pointsKicker: {
    color: '#0066FF',
    fontSize: 11,
    fontWeight: '900',
  },
  pointsBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pointsBalance: {
    color: '#0F172A',
    fontSize: 30,
    fontWeight: '900',
  },
  streakRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  streakLabel: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
  },
  streakPercent: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '900',
  },
  streakTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  streakFill: {
    width: '74%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#0066FF',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9D5FF',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  badgePillText: {
    flex: 1,
    color: '#334155',
    fontSize: 11,
    fontWeight: '800',
  },
  mobileTabBar: {
    minHeight: 70,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5EAF2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  mobileNavItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  mobileCreateItem: {
    transform: [{ translateY: -7 }],
  },
  mobileIconShell: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileIconShellActive: {
    backgroundColor: '#0066FF',
  },
  mobileCreateIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0066FF',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  mobileNavLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '900',
  },
  mobileNavLabelActive: {
    color: '#0066FF',
  },
});
