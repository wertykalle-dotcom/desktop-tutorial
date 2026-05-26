import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export default function Index() {
  const { user, loading, loginWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Handle Google OAuth redirect on web
    if (Platform.OS === 'web') {
      const handleWebAuth = async () => {
        const hash = window.location.hash;
        const search = window.location.search;
        
        let sessionId: string | null = null;
        
        // Check hash fragment
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          sessionId = params.get('session_id');
        }
        
        // Check query parameters
        if (!sessionId && search) {
          const params = new URLSearchParams(search);
          sessionId = params.get('session_id');
        }
        
        if (sessionId) {
          try {
            await loginWithGoogle(sessionId);
            // Clean URL
            window.history.replaceState(null, '', window.location.pathname);
          } catch (error) {
            console.error('Google auth error:', error);
          }
        }
      };
      
      handleWebAuth();
    }
  }, []);

  useEffect(() => {
    // Handle navigation after loading
    if (!loading) {
      if (user) {
        router.replace('/(tabs)/feed');
      } else {
        router.replace('/(auth)/login');
      }
    }
  }, [user, loading]);

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
