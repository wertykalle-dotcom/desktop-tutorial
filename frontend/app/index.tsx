import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { useI18n } from '../src/contexts/I18nContext';
import { API_BASE } from '../src/utils/api/http';

type HomepageConfig = {
  title: string;
  subtitle: string;
  badge: string;
  hero_image_url?: string | null;
  hero_image_alt?: string;
};

export default function Index() {
  const { user, loading } = useAuth();
  const { isReady } = useI18n();
  const router = useRouter();
  const backendOrigin = API_BASE.replace(/\/api$/, '');
  const [homepage, setHomepage] = useState<HomepageConfig | null>(null);

  useEffect(() => {
    if (!loading && isReady && user) {
      router.replace('/(tabs)/feed');
    }
  }, [user, loading, isReady, router]);

  useEffect(() => {
    if (!isReady || user) return;
    let cancelled = false;
    const loadHomepage = async () => {
      try {
        const response = await fetch(`${API_BASE}/homepage/config`);
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setHomepage(payload);
      } catch {
        if (!cancelled) setHomepage(null);
      }
    };
    void loadHomepage();
    return () => {
      cancelled = true;
    };
  }, [isReady, user]);

  if (loading || !isReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (user) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{homepage?.badge || 'Suomalainen some'}</Text>
        </View>
        <Text style={styles.title}>{homepage?.title || 'Tervetuloa YOSLA SOME LIFE'}</Text>
        <Text style={styles.subtitle}>
          {homepage?.subtitle || 'Suomalainen some, jossa voit julkaista, keskustella ja rakentaa verkoston yhdessä paikassa.'}
        </Text>
      </View>

      {homepage?.hero_image_url ? (
        <Image
          source={{ uri: homepage.hero_image_url.startsWith('http') ? homepage.hero_image_url : `${backendOrigin}${homepage.hero_image_url}` }}
          style={styles.heroImage}
          resizeMode="cover"
          accessibilityLabel={homepage.hero_image_alt || homepage.title || 'YOSLA SOME LIFE'}
        />
      ) : null}

      <View style={styles.featureCard}>
        <Text style={styles.featureTitle}>Mitä voit tehdä täällä</Text>
        <Text style={styles.featureItem}>• Seurata käyttäjiä ja yhteisöjä</Text>
        <Text style={styles.featureItem}>• Julkaista tekstiä, kuvia ja videoita</Text>
        <Text style={styles.featureItem}>• Kommentoida, tykätä ja repostata</Text>
        <Text style={styles.featureItem}>• Käyttää viestejä, hakuja ja ilmoituksia</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={[styles.button, styles.primaryButton]} onPress={() => router.push('/(auth)/login')}>
          <Text style={styles.primaryButtonText}>Kirjaudu sisään</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => router.push('/(auth)/register')}>
          <Text style={styles.secondaryButtonText}>Rekisteröidy</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>
        Jos olet jo kirjautunut, sinut ohjataan automaattisesti syötteeseen.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f9fc',
    padding: 24,
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  hero: {
    marginBottom: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e8f1ff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  badgeText: {
    color: '#0f5bb5',
    fontWeight: '800',
    fontSize: 12,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
    color: '#475569',
  },
  featureCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    padding: 18,
    marginBottom: 24,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 10,
  },
  featureItem: {
    fontSize: 14,
    lineHeight: 22,
    color: '#334155',
    marginBottom: 4,
  },
  actions: {
    gap: 12,
  },
  button: {
    minHeight: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
  },
  secondaryButton: {
    backgroundColor: '#e2e8f0',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  footer: {
    marginTop: 18,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  heroImage: {
    width: '100%',
    height: 220,
    borderRadius: 20,
    marginBottom: 20,
    backgroundColor: '#e2e8f0',
  },
});
