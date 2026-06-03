import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { useI18n } from '../src/contexts/I18nContext';

export default function Index() {
  const { user, loading } = useAuth();
  const { isReady } = useI18n();
  const router = useRouter();

  useEffect(() => {
    if (!loading && isReady) {
      if (user) {
        router.replace('/(tabs)/feed');
      } else {
        router.replace('/(auth)/login');
      }
    }
  }, [user, loading, isReady, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
