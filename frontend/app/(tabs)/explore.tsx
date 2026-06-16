import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useI18n } from '../../src/contexts/I18nContext';
import { useAuth } from '../../src/contexts/AuthContext';
import { useApiClient } from '../../src/hooks/useApiClient';
import { type CreatorSuggestion, type ExploreTopic } from '../../src/features/directories/directory-data';
import type { LocalYoslaPayload } from '../../src/features/growth/growthTypes';

const fallbackTopicLabels = ['#community', '#design', '#build', '#launch', '#fi', '#explore'];

const topicMeta: Record<string, { area: string; tone: string; icon: keyof typeof Ionicons.glyphMap }> = {
  '#community': { area: 'Yleinen keskustelu', tone: '#2563eb', icon: 'people' },
  '#design': { area: 'Muotoilu & UI/UX', tone: '#7c3aed', icon: 'color-palette' },
  '#build': { area: 'Kehitys & koodaus', tone: '#0f766e', icon: 'construct' },
  '#launch': { area: 'Julkaisut & projektit', tone: '#ea580c', icon: 'rocket' },
  '#fi': { area: 'Suomiyhteisö', tone: '#0284c7', icon: 'flag' },
  '#explore': { area: 'Löydä uutta', tone: '#be123c', icon: 'compass' },
};

export default function ExploreScreen() {
  const { t, isRTL } = useI18n();
  const { token } = useAuth();
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const [topics, setTopics] = useState<ExploreTopic[]>([]);
  const [creators, setCreators] = useState<CreatorSuggestion[]>([]);
  const [localYosla, setLocalYosla] = useState<LocalYoslaPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      setLoading(true);
      const payload = await apiFetch('/explore?limit=50', {}, { requireAuth: true });
      const localPayload = await apiFetch('/discovery/local-yosla?limit=6', {}, { requireAuth: true });
      const data = payload ? await payload.json() : null;
      const localData = localPayload?.ok ? await localPayload.json() : null;
      if (!mounted) return;
      setTopics(Array.isArray(data?.topics) ? data.topics : []);
      setCreators(Array.isArray(data?.creators) ? data.creators : []);
      setLocalYosla(localData);
      setLoading(false);
    };
    load();
    return () => {
      mounted = false;
    };
  }, [apiFetch, token]);

  const topicLabels = useMemo(
    () => (topics.length > 0 ? topics.map((topic) => topic.label) : fallbackTopicLabels),
    [topics]
  );
  const creatorLabels = useMemo(
    () => (creators.length > 0 ? creators : [{ username: '@teamflow', postCount: 4, userId: 'demo' }]),
    [creators]
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <Text style={[styles.kicker, isRTL && styles.textRight]}>{t('explore')}</Text>
        <Text style={[styles.title, isRTL && styles.textRight]}>Trendaavat aiheet ja tekijät</Text>
        <Text style={[styles.body, isRTL && styles.textRight]}>Nostetaan esiin sisältöä, jota kannattaa tutkia ennen kuin syöte lukkiutuu.</Text>
      </View>

      <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>Hashtagit</Text>
      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}
      <View style={styles.localPanel}>
        <View style={styles.localHeader}>
          <View>
            <Text style={styles.localKicker}>Local YOSLA</Text>
            <Text style={styles.localTitle}>{localYosla?.region || 'Suomi'}</Text>
          </View>
          <Ionicons name="location" size={22} color="#dcfce7" />
        </View>
        <View style={styles.localTopicRow}>
          {(localYosla?.topics || ['#suomi', '#fi', '#helsinki']).slice(0, 6).map((tag) => (
            <Pressable key={tag} style={styles.localTopicPill} onPress={() => router.push({ pathname: '/search', params: { q: tag } })}>
              <Text style={styles.localTopicText}>{tag}</Text>
            </Pressable>
          ))}
        </View>
        {(localYosla?.posts || []).slice(0, 3).map((post) => (
          <Pressable key={post.post_id} style={styles.localPostRow} onPress={() => router.push(`/posts/${post.post_id}`)}>
            <Text style={styles.localPostTitle} numberOfLines={1}>{post.title}</Text>
            <Text style={styles.localPostMeta}>@{post.username || 'yosla'} · {post.topic}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chipGrid}>
        {topicLabels.map((topic) => {
          const meta = topicMeta[topic] || { area: 'Aihe syötteessä', tone: '#2563eb', icon: 'pricetag' as const };
          return (
            <Pressable
              key={topic}
              style={[styles.topicBadge, { borderColor: meta.tone }]}
              onPress={() => router.push({ pathname: '/search', params: { q: topic, tab: 'hashtags' } })}
            >
              <View style={[styles.topicIcon, { backgroundColor: meta.tone }]}>
                <Ionicons name={meta.icon} size={16} color="#fff" />
              </View>
              <View style={styles.topicTextWrap}>
                <Text style={styles.topicLabel}>{topic}</Text>
                <Text style={styles.topicArea}>{meta.area}</Text>
              </View>
              <Ionicons name="arrow-forward" size={15} color={meta.tone} />
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>Ehdotetut tekijät</Text>
      {creatorLabels.map((creator) => (
        <View key={creator.userId} style={styles.row}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, isRTL && styles.textRight]}>@{creator.username}</Text>
            <Text style={[styles.rowSubtitle, isRTL && styles.textRight]}>{creator.postCount} julkaisua syötteessä</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  hero: { backgroundColor: '#fff', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 16 },
  kicker: { color: '#007AFF', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827', marginTop: 6, marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#4b5563' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 10, marginTop: 4 },
  localPanel: { backgroundColor: '#064e3b', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#10b981', marginBottom: 16, gap: 10 },
  localHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  localKicker: { color: '#bbf7d0', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6 },
  localTitle: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 3 },
  localTopicRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  localTopicPill: { borderRadius: 999, backgroundColor: 'rgba(220,252,231,0.14)', borderWidth: 1, borderColor: 'rgba(220,252,231,0.25)', paddingHorizontal: 10, paddingVertical: 7 },
  localTopicText: { color: '#dcfce7', fontSize: 12, fontWeight: '900' },
  localPostRow: { borderRadius: 12, backgroundColor: 'rgba(15,23,42,0.28)', padding: 10 },
  localPostTitle: { color: '#fff', fontSize: 13, fontWeight: '900' },
  localPostMeta: { color: '#bbf7d0', fontSize: 11, fontWeight: '800', marginTop: 2 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  topicBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  topicIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topicTextWrap: { minWidth: 88 },
  topicLabel: { color: '#111827', fontSize: 13, fontWeight: '900' },
  topicArea: { color: '#64748B', fontSize: 10, fontWeight: '700', marginTop: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  rowSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  textRight: { textAlign: 'right' },
});
