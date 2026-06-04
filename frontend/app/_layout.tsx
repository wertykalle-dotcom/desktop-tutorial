import '../global.css';
import { Slot } from 'expo-router';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useEffect } from 'react';
import * as Font from 'expo-font';
import { Asset } from 'expo-asset';
import { I18nProvider } from '../src/contexts/I18nContext';

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
    <I18nProvider>
      <AuthProvider>
        <Slot />
      </AuthProvider>
    </I18nProvider>
  );
}
