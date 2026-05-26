import { Stack } from 'expo-router';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useEffect } from 'react';
import * as Font from 'expo-font';
import { Asset } from 'expo-asset';

export default function RootLayout() {
  useEffect(() => {
    // Prewarm icon assets for Expo Go Android
    async function loadResourcesAsync() {
      try {
        await Font.loadAsync({});
        await Asset.loadAsync([
          require('../assets/icon.png'),
          require('../assets/adaptive-icon.png'),
        ]);
      } catch (e) {
        console.warn('Error loading resources:', e);
      }
    }
    
    loadResourcesAsync();
  }, []);

  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/register" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AuthProvider>
  );
}
