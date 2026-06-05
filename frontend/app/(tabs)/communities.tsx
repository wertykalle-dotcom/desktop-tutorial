import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../src/contexts/I18nContext';
import { defaultCommunities, type CommunityItem } from '../../src/features/directories/directory-data';
import { useApiClient } from '../../src/hooks/useApiClient';

type CommunityCategory = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  examples: string;
  color: string;
  background: string;
  keywords: string[];
};

const communityCategories: CommunityCategory[] = [
  {
    id: 'local',
    icon: 'location',
    title: 'Paikallisyhteisöt',
    description: 'Löydä lähialueen ryhmät, kaupunginosat ja arjen verkostot.',
    examples: 'Kylät, kaupunginosat, taloyhtiöt',
    color: '#0f766e',
    background: '#ecfdf5',
    keywords: ['paikallinen', 'kylä', 'kaupunki', 'kaupunginosa', 'taloyhtiö', 'lähialue'],
  },
  {
    id: 'hobby',
    icon: 'football',
    title: 'Harrastus & kiinnostus',
    description: 'Porukat, joita yhdistää yhteinen intohimo ja tekeminen.',
    examples: 'Liikunta, taide, pelit, kulttuuri',
    color: '#b45309',
    background: '#fff7ed',
    keywords: ['harrastus', 'liikunta', 'urheilu', 'taide', 'peli', 'pelit', 'kulttuuri', 'design'],
  },
  {
    id: 'online',
    icon: 'globe',
    title: 'Verkkoyhteisöt',
    description: 'Digitaaliset ryhmät, vertaistuki ja rajat ylittävä keskustelu.',
    examples: 'Foorumit, vertaistuki, digitaaliset heimot',
    color: '#2563eb',
    background: '#eff6ff',
    keywords: ['verkko', 'online', 'digitaalinen', 'foorumi', 'vertaistuki', 'internet'],
  },
  {
    id: 'work',
    icon: 'school',
    title: 'Työ & opiskelu',
    description: 'Tiimit, luokat ja oppimisen ympärille rakentuvat yhteisöt.',
    examples: 'Tiimit, luokat, opiskelijajärjestöt',
    color: '#7c3aed',
    background: '#f5f3ff',
    keywords: ['työ', 'opiskelu', 'koulu', 'tiimi', 'luokka', 'opiskelija', 'kehittäjä', 'builder'],
  },
  {
    id: 'values',
    icon: 'document-text',
    title: 'Aatteelliset & juridiset',
    description: 'Virallisemmat ryhmät, joilla on yhteiset säännöt ja arvot.',
    examples: 'Yhdistykset, säätiöt, osuuskunnat',
    color: '#be123c',
    background: '#fff1f2',
    keywords: ['yhdistys', 'säätiö', 'osuuskunta', 'aatteellinen', 'juridinen', 'vapaaehtoistyö'],
  },
];

const normalize = (value: string) => value.toLocaleLowerCase('fi-FI');
const hiddenCommunityNames = new Set(['Design Lab', 'Builders FI', 'Launch Crew']);

export default function CommunitiesScreen() {
  const { t, isRTL } = useI18n();
  const { apiFetch } = useApiClient();
  const { width } = useWindowDimensions();
  const [communities, setCommunities] = useState<CommunityItem[]>(defaultCommunities);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const isWide = width >= 760;

  const loadCommunities = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const response = await apiFetch('/communities?limit=30', {}, { requireAuth: true });
      const data = response ? await response.json() : null;
      if (!mountedRef.current) return;
      const visibleCommunities = Array.isArray(data?.communities)
        ? data.communities.filter((community: CommunityItem) => !hiddenCommunityNames.has(community.name))
        : defaultCommunities;
      setCommunities(visibleCommunities);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    mountedRef.current = true;
    void loadCommunities();
    return () => {
      mountedRef.current = false;
    };
  }, [loadCommunities]);

  const toggleMembership = async (communityName: string) => {
    if (busyName) return;
    const previousCommunities = communities;
    const currentCommunity = communities.find((community) => community.name === communityName);
    const nextIsMember = !currentCommunity?.is_member;
    setBusyName(communityName);
    setCommunities((current) =>
      current.map((community) =>
        community.name === communityName
          ? {
              ...community,
              is_member: nextIsMember,
              members: Math.max(0, community.members + (nextIsMember ? 1 : -1)),
            }
          : community
      )
    );
    try {
      const response = await apiFetch(`/communities/${encodeURIComponent(communityName)}/toggle`, {
        method: 'POST',
      }, { requireAuth: true });
      if (!response?.ok) {
        throw new Error(`Community toggle failed (${response?.status || 'network'})`);
      }
      const payload = await response.json();
      setCommunities((current) =>
        current.map((community) =>
          community.name === communityName
            ? {
                ...community,
                is_member: !!payload.is_member,
                members: Number.isFinite(Number(payload.members))
                  ? Math.max(Number(payload.members), community.members)
                  : community.members,
              }
            : community
        )
      );
    } catch (error) {
      console.error('Error toggling community membership:', error);
      setCommunities(previousCommunities);
      Alert.alert(t('error'), t('networkError'));
    } finally {
      setBusyName(null);
    }
  };

  const activeCategory = communityCategories.find((category) => category.id === activeCategoryId);
  const normalizedSearch = normalize(searchQuery.trim());
  const filteredCommunities = communities.filter((community) => {
    const searchable = normalize(`${community.name} ${community.description}`);
    const matchesSearch = !normalizedSearch || searchable.includes(normalizedSearch);
    const matchesCategory = !activeCategory || activeCategory.keywords.some((keyword) => searchable.includes(normalize(keyword)));
    return matchesSearch && matchesCategory;
  });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={[styles.hero, isWide && styles.heroWide]}>
        <View style={styles.heroText}>
          <Text style={[styles.eyebrow, isRTL && styles.textRight]}>Yhteisöt</Text>
          <Text style={[styles.title, isRTL && styles.textRight]}>Löydä omasi</Text>
          <Text style={[styles.body, isRTL && styles.textRight]}>
            Yhteisö kokoaa ihmiset yhteisen päämäärän, arvojen, sijainnin, elämäntilanteen tai kiinnostuksen kohteen ympärille.
          </Text>
        </View>
        <View style={styles.searchPanel}>
          <View style={[styles.searchBox, isRTL && styles.rowReverse]}>
            <Ionicons name="search" size={20} color="#64748b" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Etsi liikuntaa, kulttuuria tai vertaistukea"
              placeholderTextColor="#94a3b8"
              style={[styles.searchInput, isRTL && styles.textRight]}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                <Ionicons name="close" size={18} color="#64748b" />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={() => void loadCommunities()}>
            <Ionicons name="refresh" size={16} color="#374151" />
            <Text style={styles.refreshText}>{t('retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.categoryGrid, isWide && styles.categoryGridWide]}>
        {communityCategories.map((category) => {
          const selected = activeCategoryId === category.id;
          return (
            <TouchableOpacity
              key={category.id}
              style={[
                styles.categoryCard,
                isWide && styles.categoryCardWide,
                { backgroundColor: category.background, borderColor: selected ? category.color : '#e2e8f0' },
                selected && styles.categoryCardSelected,
              ]}
              onPress={() => setActiveCategoryId(selected ? null : category.id)}
            >
              <View style={[styles.categoryIcon, { backgroundColor: category.color }]}>
                <Ionicons name={category.icon} size={22} color="#fff" />
              </View>
              <Text style={[styles.categoryTitle, isRTL && styles.textRight]}>{category.title}</Text>
              <Text style={[styles.categoryBody, isRTL && styles.textRight]}>{category.description}</Text>
              <Text style={[styles.categoryExamples, isRTL && styles.textRight]}>{category.examples}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeCategory ? (
        <TouchableOpacity style={styles.activeFilter} onPress={() => setActiveCategoryId(null)}>
          <Text style={styles.activeFilterText}>{activeCategory.title}</Text>
          <Ionicons name="close" size={16} color="#334155" />
        </TouchableOpacity>
      ) : null}

      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}
      {filteredCommunities.map((community) => (
        <View key={community.name} style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="people" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, isRTL && styles.textRight]}>{community.name}</Text>
            <Text style={[styles.cardSub, isRTL && styles.textRight]}>{community.description} · {community.members} jäsentä</Text>
          </View>
          <TouchableOpacity
            style={[styles.joinButton, community.is_member && styles.joinedButton]}
            onPress={() => void toggleMembership(community.name)}
            disabled={busyName === community.name}
          >
            <Text style={[styles.joinText, community.is_member && styles.joinedText]}>
              {busyName === community.name ? t('loading') : community.is_member ? t('communityLeave') : t('communityJoin')}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
      {!loading && filteredCommunities.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="compass-outline" size={28} color="#64748b" />
          <Text style={styles.emptyTitle}>Ei osumia</Text>
          <Text style={styles.emptyBody}>Kokeile toista hakusanaa tai poista valittu kategoria.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb', gap: 14 },
  hero: {
    gap: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 18,
    padding: 18,
  },
  heroWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroText: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#2563eb', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', marginBottom: 4 },
  title: { fontSize: 30, fontWeight: '900', color: '#111827', marginBottom: 8 },
  body: { color: '#4b5563', fontSize: 15, lineHeight: 22 },
  searchPanel: { gap: 10, minWidth: 280 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    color: '#0f172a',
    fontSize: 15,
    paddingVertical: 10,
    outlineStyle: 'none' as any,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  categoryGrid: { gap: 12 },
  categoryGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  categoryCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    minHeight: 164,
  },
  categoryCardWide: {
    width: '31.8%',
    minWidth: 220,
    flexGrow: 1,
  },
  categoryCardSelected: {
    borderWidth: 2,
  },
  categoryIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  categoryTitle: { color: '#0f172a', fontSize: 16, fontWeight: '900', marginBottom: 6 },
  categoryBody: { color: '#475569', fontSize: 13, lineHeight: 19, marginBottom: 10 },
  categoryExamples: { color: '#334155', fontSize: 12, fontWeight: '800' },
  activeFilter: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  activeFilterText: { color: '#334155', fontWeight: '900' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14, padding: 14 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  joinButton: { backgroundColor: '#eaf3ff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  joinText: { color: '#007AFF', fontWeight: '800' },
  joinedButton: { backgroundColor: '#eef2ff' },
  joinedText: { color: '#4338ca' },
  refreshButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f3f4f6' },
  refreshText: { fontWeight: '800', color: '#374151' },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 24,
    gap: 6,
  },
  emptyTitle: { color: '#0f172a', fontSize: 16, fontWeight: '900' },
  emptyBody: { color: '#64748b', textAlign: 'center' },
  rowReverse: { flexDirection: 'row-reverse' },
  textRight: { textAlign: 'right' },
});
