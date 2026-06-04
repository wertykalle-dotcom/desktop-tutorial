import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApiClient } from '../../../src/hooks/useApiClient';
import { useI18n } from '../../../src/contexts/I18nContext';
import { formatRelativeTime } from '../../../src/utils/time';

type CommunityPost = {
  post_id: string;
  user_id: string;
  username: string;
  text: string;
  image?: string | null;
  hashtags?: string[];
  mentions?: string[];
  likes_count: number;
  comments_count: number;
  repost_count: number;
  created_at: string;
  is_liked?: boolean;
};

type CommunityDetail = {
  community_name: string;
  is_member: boolean;
  members: number;
  description: string;
  posts: CommunityPost[];
};

export default function CommunityDetailScreen() {
  const { communityName } = useLocalSearchParams<{ communityName: string }>();
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<CommunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!communityName || !mountedRef.current) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/communities/${encodeURIComponent(String(communityName))}`, {}, { requireAuth: true });
      const payload = response && response.ok ? (await response.json()) as CommunityDetail : null;
      if (!mountedRef.current) return;
      setData(payload);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apiFetch, communityName]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const toggleMembership = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/communities/${encodeURIComponent(data.community_name)}/toggle`, { method: 'POST' }, { requireAuth: true });
      if (response?.ok) {
        const payload = await response.json();
        setData((current) => current ? { ...current, is_member: !!payload.is_member, members: Number(payload.members || current.members) } : current);
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#007AFF" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Community not found</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Ionicons name="chevron-back" size={20} color="#111827" />
        <Text style={styles.backText}>{t('back')}</Text>
      </Pressable>

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="people" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, isRTL && styles.textRight]}>{data.community_name}</Text>
          <Text style={[styles.body, isRTL && styles.textRight]}>{data.description}</Text>
          <Text style={styles.meta}>{data.members} jäsentä</Text>
        </View>
        <Pressable style={[styles.joinButton, data.is_member && styles.joinedButton]} onPress={() => void toggleMembership()} disabled={busy}>
          <Text style={[styles.joinText, data.is_member && styles.joinedText]}>{busy ? t('loading') : data.is_member ? t('communityLeave') : t('communityJoin')}</Text>
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, isRTL && styles.textRight]}>Yhteisön julkaisut</Text>
      {data.posts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.body}>Ei vielä julkaisuja tässä yhteisössä.</Text>
        </View>
      ) : (
        data.posts.map((post) => (
          <Pressable key={post.post_id} style={styles.postCard} onPress={() => router.push(`/posts/${post.post_id}`)}>
            <View style={styles.postHeader}>
              <View style={styles.postAvatar}>
                <Ionicons name="person" size={16} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.postAuthor}>@{post.username}</Text>
                <Text style={styles.postMeta}>{formatRelativeTime(post.created_at)}</Text>
              </View>
            </View>
            <Text style={styles.postText} numberOfLines={4}>{post.text}</Text>
            {post.image ? <Image source={{ uri: post.image }} style={styles.postImage} /> : null}
            <View style={styles.postStats}>
              <Text style={styles.postStat}>{post.likes_count} likes</Text>
              <Text style={styles.postStat}>{post.comments_count} comments</Text>
              <Text style={styles.postStat}>{post.repost_count} reposts</Text>
            </View>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backText: { color: '#111827', fontWeight: '700' },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: '#e5e7eb', padding: 14, marginBottom: 16 },
  heroIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '900', color: '#111827' },
  body: { marginTop: 4, color: '#4b5563', lineHeight: 20 },
  meta: { marginTop: 6, color: '#6b7280', fontWeight: '700' },
  joinButton: { backgroundColor: '#eaf3ff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 999 },
  joinedButton: { backgroundColor: '#eef2ff' },
  joinText: { color: '#007AFF', fontWeight: '800' },
  joinedText: { color: '#4338ca' },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: '#111827', marginBottom: 10 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 14 },
  postCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 14, marginBottom: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  postAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center' },
  postAuthor: { fontWeight: '900', color: '#111827' },
  postMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  postText: { color: '#111827', lineHeight: 20 },
  postImage: { height: 180, borderRadius: 14, marginTop: 10, backgroundColor: '#f3f4f6' },
  postStats: { flexDirection: 'row', gap: 12, marginTop: 10 },
  postStat: { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  textRight: { textAlign: 'right' },
});
