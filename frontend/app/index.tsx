import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Asset } from 'expo-asset';
import { useAuth } from '../src/contexts/AuthContext';
import { useI18n } from '../src/contexts/I18nContext';
import { API_BASE } from '../src/utils/api/http';

const yoslaHeroImage = require('../assets/brand/yosla-hero.png');
const yoslaHeroMobileImage = require('../assets/brand/yosla-hero-mobile.png');

function YoslaHeroImage({ isWide, label }: { isWide: boolean; label: string }) {
  const imageModule = isWide ? yoslaHeroImage : yoslaHeroMobileImage;

  if (Platform.OS === 'web') {
    const source = Asset.fromModule(imageModule);
    return React.createElement('img', {
      src: source.uri,
      alt: label,
      style: {
        width: '100%',
        aspectRatio: isWide ? '16 / 9' : '1080 / 1460',
        height: 'auto',
        objectFit: 'contain',
        display: 'block',
        borderRadius: isWide ? 20 : 16,
        marginBottom: 20,
        backgroundColor: '#020617',
        border: '1px solid rgba(250,204,21,0.22)',
        boxShadow: '0 24px 70px rgba(14, 165, 233, 0.22), 0 0 0 1px rgba(250, 204, 21, 0.08)',
        boxSizing: 'border-box',
      },
    });
  }

  return (
    <Image
      source={imageModule}
      style={[styles.heroImage, !isWide && styles.heroImageMobile]}
      resizeMode="contain"
      accessibilityLabel={label}
    />
  );
}

type HomepageConfig = {
  title: string;
  subtitle: string;
  badge: string;
  hero_image_url?: string | null;
  hero_image_alt?: string;
};

const welcomeFeatureCards = [
  {
    id: 'discover',
    tone: 'blue',
    title: '⚡ Löydä & Seuraa',
    body: 'Seuraa kiinnostavia tekijöitä ja liity mukaan aktiivisiin yhteisöihin (kuten #suomi tai #valokuvaus) yhdellä klikkauksella.',
  },
  {
    id: 'create',
    tone: 'red',
    title: '🔥 Luo & Osallistu',
    body: 'Julkaise tekstiä, kuvia tai videoita. Haasta itsesi ja ota osaa viikoittaisiin yhteisöhaasteisiin suoraan syötteestäsi.',
  },
  {
    id: 'react',
    tone: 'purple',
    title: '🚀 Reagoi & Keskustele',
    body: 'Kommentoi ketjutetusti, jaa sisältöä eteenpäin ja anna palaa uusilla, yhteisöllisillä emojireaktioilla (🔥, 💡, 🚀).',
  },
  {
    id: 'earn',
    tone: 'orange',
    title: '🏆 Pysy linjoilla & Ansaitse',
    body: 'Vastaa Päivän Kysymyksiin, kerrytä Streak-päiviäsi ja kasvata YOSLA-pisteitäsi nousemalla uusiin tasoluokkiin!',
  },
] as const;

export default function Index() {
  const { user, loading } = useAuth();
  const { isReady } = useI18n();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [homepage, setHomepage] = useState<HomepageConfig | null>(null);
  const isWide = width >= 760;

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.shell}>
        <View style={styles.hero}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{homepage?.badge || 'Suomalainen some'}</Text>
          </View>
          <Text style={styles.title}>Tervetuloa YOSLA SOME LIFEEN</Text>
          <Text style={styles.subtitle}>
            Ensimmäinen suomalainen some-ekosysteemi, joka palkitsee aktiivisuudesta ja tuo ihmiset aidosti yhteen – ilman kasvottomia algoritmeja.
          </Text>
        </View>

        <YoslaHeroImage isWide={isWide} label={homepage?.hero_image_alt || homepage?.title || 'YOSLA SOME LIFE'} />

        <View style={styles.featureCard}>
          <View style={styles.featureHeaderRow}>
            <Text style={styles.featureTitle}>YOSLA-ekosysteemi</Text>
            <Text style={styles.featureSignal}>LIVE</Text>
          </View>
          <View style={[styles.featureGrid, !isWide && styles.featureGridMobile]}>
            {welcomeFeatureCards.map((feature) => (
              <View
                key={feature.id}
                style={[
                  styles.featureGridItem,
                  !isWide && styles.featureGridItemMobile,
                  styles[`featureTone_${feature.tone}`],
                ]}
              >
                <Text style={styles.featureGridTitle}>{feature.title}</Text>
                <Text style={styles.featureGridBody}>{feature.body}</Text>
              </View>
            ))}
          </View>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07111f',
  },
  content: {
    flexGrow: 1,
    padding: 18,
    justifyContent: 'center',
  },
  shell: {
    width: '100%',
    maxWidth: 1240,
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  hero: {
    marginBottom: 18,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(250,204,21,0.12)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.36)',
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginBottom: 12,
  },
  badgeText: {
    color: '#facc15',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '900',
    color: '#f8fafc',
  },
  subtitle: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 25,
    color: '#cbd5e1',
    maxWidth: 820,
    fontWeight: '600',
  },
  featureCard: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    shadowColor: '#38bdf8',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 3,
  },
  featureHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#f8fafc',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  featureSignal: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(220,38,38,0.18)',
    color: '#fecaca',
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  featureGridMobile: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
  },
  featureGridItem: {
    flex: 1,
    flexBasis: 280,
    minWidth: 260,
    minHeight: 146,
    borderRadius: 8,
    padding: 14,
    gap: 8,
    justifyContent: 'space-between',
  },
  featureGridItemMobile: {
    flexBasis: undefined,
    minWidth: 0,
    width: '100%',
  },
  featureGridTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
  },
  featureGridBody: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  featureTone_blue: {
    backgroundColor: '#0066FF',
  },
  featureTone_red: {
    backgroundColor: '#FF0055',
  },
  featureTone_purple: {
    backgroundColor: '#8A2BE2',
  },
  featureTone_orange: {
    backgroundColor: '#FF6600',
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
    backgroundColor: 'rgba(226,232,240,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.22)',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButtonText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  footer: {
    marginTop: 18,
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  heroImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 20,
    marginBottom: 20,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.22)',
    objectFit: 'contain' as any,
    shadowColor: '#38bdf8',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 24 },
    shadowRadius: 34,
    elevation: 7,
  },
  heroImageMobile: {
    aspectRatio: 1080 / 1460,
    borderRadius: 16,
  },
});
