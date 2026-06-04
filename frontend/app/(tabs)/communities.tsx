import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useI18n } from '../../src/contexts/I18nContext';
import { defaultCommunities, type CommunityItem } from '../../src/features/directories/directory-data';
import { useApiClient } from '../../src/hooks/useApiClient';

export default function CommunitiesScreen() {
  const { t, isRTL } = useI18n();
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const [communities, setCommunities] = useState<CommunityItem[]>(defaultCommunities);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadCommunities = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const response = await apiFetch('/communities?limit=30', {}, { requireAuth: true });
      const data = response ? await response.json() : null;
      if (!mountedRef.current) return;
      setCommunities(Array.isArray(data?.communities) ? data.communities : defaultCommunities);
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
    setBusyName(communityName);
    try {
      const response = await apiFetch(`/communities/${encodeURIComponent(communityName)}/toggle`, {
        method: 'POST',
      }, { requireAuth: true });
      if (response?.ok) {
        const payload = await response.json();
        setCommunities((current) =>
          current.map((community) =>
            community.name === communityName
              ? { ...community, is_member: !!payload.is_member, members: Number(payload.members || community.members) }
              : community
          )
        );
      }
    } finally {
      setBusyName(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.title, isRTL && styles.textRight]}>Yhteisöt</Text>
      <Text style={[styles.body, isRTL && styles.textRight]}>Perusta teemasivuja, liity ryhmiin ja rakenna oma tila.</Text>
      <TouchableOpacity style={styles.refreshButton} onPress={() => void loadCommunities()}>
        <Text style={styles.refreshText}>{t('retry')}</Text>
      </TouchableOpacity>
      {loading ? <ActivityIndicator color="#007AFF" style={{ marginBottom: 16 }} /> : null}
      {communities.map((community) => (
        <View key={community.name} style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="people" size={18} color="#fff" />
          </View>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => router.push(`/communities/${encodeURIComponent(community.name)}` as never)}>
            <Text style={[styles.cardTitle, isRTL && styles.textRight]}>{community.name}</Text>
            <Text style={[styles.cardSub, isRTL && styles.textRight]}>{community.description} · {community.members} jäsentä</Text>
          </TouchableOpacity>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  title: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
  body: { color: '#4b5563', fontSize: 15, marginBottom: 16, lineHeight: 22 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 16, padding: 14, marginBottom: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  joinButton: { backgroundColor: '#eaf3ff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  joinText: { color: '#007AFF', fontWeight: '800' },
  joinedButton: { backgroundColor: '#eef2ff' },
  joinedText: { color: '#4338ca' },
  refreshButton: { alignSelf: 'flex-start', marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f3f4f6' },
  refreshText: { fontWeight: '800', color: '#374151' },
  textRight: { textAlign: 'right' },
});
