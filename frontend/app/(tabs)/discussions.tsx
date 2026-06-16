import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApiClient } from '../../src/hooks/useApiClient';
import type { Post } from '../../src/features/feed/dwell';

const getPostBadge = (commentsCount = 0) => {
  if (commentsCount >= 500) return { icon: '🚀', label: 'Ilmiö', tone: styles.badgePhenomenon };
  if (commentsCount >= 150) return { icon: '☄️', label: 'Kometti', tone: styles.badgeComet };
  if (commentsCount >= 50) return { icon: '🔥', label: 'Kova Uutinen', tone: styles.badgeHot };
  if (commentsCount >= 5) return { icon: '⭐', label: 'Nouseva keskustelu', tone: styles.badgeRising };
  return null;
};

export default function DiscussionsScreen() {
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPosts = useCallback(async () => {
    try {
      const response = await apiFetch('/posts?following_only=false&limit=80');
      if (!response?.ok) {
        setPosts([]);
        return;
      }
      const payload = await response.json();
      setPosts(Array.isArray(payload) ? payload : []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const hotPosts = useMemo(
    () =>
      posts
        .map((post) => ({ post, badge: getPostBadge(post.comments_count || 0) }))
        .filter((item): item is { post: Post; badge: NonNullable<ReturnType<typeof getPostBadge>> } => !!item.badge)
        .sort((a, b) => (b.post.comments_count || 0) - (a.post.comments_count || 0))
        .slice(0, 8),
    [posts]
  );

  const polls = useMemo(() => posts.filter((post) => post.poll).slice(0, 8), [posts]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadPosts();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.hero}>
        <Text style={styles.kicker}>Keskustelut</Text>
        <Text style={styles.title}>Puhutuimmat, kyselyt ja viikon haaste</Text>
        <Text style={styles.body}>Tänne nousevat ketjut, joissa yhteisö oikeasti keskustelee.</Text>
      </View>

      <View style={styles.challengeCard}>
        <View style={styles.challengeIconWrap}>
          <Ionicons name="sparkles" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.challengeKicker}>Viikon yhteisöhaaste</Text>
          <Text style={styles.challengeTitle}>Tämän viikon teema on #Luonto</Text>
          <Text style={styles.challengeBody}>Jaa paras kuvasi tai videosi ja kerää YOSLA-pisteitä.</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Puhutuimmat juuri nyt</Text>
      {hotPosts.length ? (
        <View style={styles.cardGrid}>
          {hotPosts.map(({ post, badge }) => (
            <TouchableOpacity key={post.post_id} style={[styles.discussionCard, badge.tone]} onPress={() => router.push(`/posts/${post.post_id}`)}>
              <Text style={styles.discussionBadge}>{badge.icon} {badge.label}</Text>
              <Text style={styles.discussionTitle} numberOfLines={3}>{post.text || `@${post.username}`}</Text>
              <Text style={styles.discussionMeta}>@{post.username} · {post.comments_count || 0} kommenttia</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>⭐ Nouseva keskustelu</Text>
          <Text style={styles.emptyBody}>Kun kommentteja kertyy, kuumimmat aiheet nousevat tänne.</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Kyselyt</Text>
      {polls.length ? (
        <View style={styles.cardGrid}>
          {polls.map((post) => (
            <TouchableOpacity key={post.post_id} style={styles.pollCard} onPress={() => router.push(`/posts/${post.post_id}`)}>
              <Text style={styles.pollLabel}>📊 Kysely</Text>
              <Text style={styles.pollTitle} numberOfLines={2}>{post.poll?.question}</Text>
              <Text style={styles.discussionMeta}>{post.poll?.total_votes || 0} ääntä · @{post.username}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Ei kyselyitä vielä</Text>
          <Text style={styles.emptyBody}>Luo julkaisu -näkymästä voi lisätä uuden gallupin.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fb' },
  container: { padding: 16, backgroundColor: '#f5f7fb', gap: 14 },
  hero: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 18, padding: 18 },
  kicker: { color: '#ea580c', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 5 },
  title: { color: '#111827', fontSize: 25, fontWeight: '900', marginBottom: 8 },
  body: { color: '#64748b', fontSize: 14, lineHeight: 20 },
  challengeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, borderColor: '#fed7aa', backgroundColor: '#fff7ed', padding: 14 },
  challengeIconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#ea580c', alignItems: 'center', justifyContent: 'center' },
  challengeKicker: { color: '#9a3412', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  challengeTitle: { color: '#111827', fontSize: 16, fontWeight: '900', marginTop: 2 },
  challengeBody: { color: '#7c2d12', fontSize: 13, marginTop: 2, lineHeight: 18 },
  sectionTitle: { color: '#111827', fontSize: 18, fontWeight: '900', marginTop: 2 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  discussionCard: { flexGrow: 1, width: '46%', minWidth: 230, borderWidth: 1, borderRadius: 16, padding: 14, gap: 7, backgroundColor: '#fff' },
  discussionBadge: { color: '#111827', fontSize: 12, fontWeight: '900' },
  discussionTitle: { color: '#111827', fontSize: 15, fontWeight: '800', lineHeight: 20 },
  discussionMeta: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  badgePhenomenon: { backgroundColor: '#eef2ff', borderColor: '#818cf8' },
  badgeComet: { backgroundColor: '#ecfeff', borderColor: '#22d3ee' },
  badgeHot: { backgroundColor: '#fff1f2', borderColor: '#fb7185' },
  badgeRising: { backgroundColor: '#fefce8', borderColor: '#facc15' },
  pollCard: { flexGrow: 1, width: '46%', minWidth: 230, borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 16, backgroundColor: '#eff6ff', padding: 14, gap: 7 },
  pollLabel: { color: '#0F62FE', fontSize: 12, fontWeight: '900' },
  pollTitle: { color: '#111827', fontSize: 15, fontWeight: '900', lineHeight: 20 },
  emptyCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14, padding: 16 },
  emptyTitle: { color: '#111827', fontWeight: '900', marginBottom: 3 },
  emptyBody: { color: '#64748b', fontSize: 13, lineHeight: 18 },
});
