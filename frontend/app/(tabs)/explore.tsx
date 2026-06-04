import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../src/contexts/I18nContext';
import { useAuth } from '../../src/contexts/AuthContext';
import { Badge } from '../../src/components/Badge';
import { useApiClient } from '../../src/hooks/useApiClient';
import { type CreatorSuggestion, type ExploreTopic } from '../../src/features/directories/directory-data';

export default function ExploreScreen() {
  const { t, isRTL } = useI18n();
  const { token } = useAuth();
  const { apiFetch } = useApiClient();
  const [topics, setTopics] = useState<ExploreTopic[]>([]);
  const [creators, setCreators] = useState<CreatorSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      setLoading(true);
      const payload = await apiFetch('/explore?limit=50', {}, { requireAuth: true });
      const data = payload ? await payload.json() : null;
      if (!mounted) return;
      setTopics(Array.isArray(data?.topics) ? data.topics : []);
      setCreators(Array.isArray(data?.creators) ? data.creators : []);
      setLoading(false);
    };
    load();
    return () => {
      mounted = false;
    };
  }, [apiFetch, token]);

  const topicLabels = useMemo(
    () => (topics.length > 0 ? topics.map((topic) => topic.label) : ['#community', '#design', '#build', '#launch', '#fi', '#explore']),
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
      <View style={styles.chipGrid}>
        {topicLabels.map((topic) => (
          <Badge key={topic} tone="brand" icon={<Ionicons name="pricetag" size={14} color="#0F62FE" />} label={topic} />
        ))}
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
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  rowSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  textRight: { textAlign: 'right' },
});
