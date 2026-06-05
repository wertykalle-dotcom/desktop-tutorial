import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useRouter } from 'expo-router';
import { useApiClient } from '../../src/hooks/useApiClient';
import { API_BASE } from '../../src/utils/api/http';
import { formatRelativeTime } from '../../src/utils/time';
import type { Post } from '../../src/features/feed/dwell';

const BACKEND_BASE = API_BASE.replace(/\/api$/, '');

const resolveMediaUrl = (uri?: string) => {
  if (!uri) return undefined;
  if (/^https?:\/\//i.test(uri)) return uri;
  return `${BACKEND_BASE}${uri.startsWith('/') ? uri : `/${uri}`}`;
};

function NativeVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.nativeVideo} />;
}

export default function MediaScreen() {
  const { apiFetch } = useApiClient();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadMedia = useCallback(async () => {
    try {
      const response = await apiFetch('/posts?following_only=false&limit=60');
      if (!response?.ok) {
        setPosts([]);
        return;
      }
      const payload = await response.json();
      const allPosts = Array.isArray(payload) ? payload as Post[] : [];
      setPosts(allPosts.filter((post) => post.image || post.video));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadMedia();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const columnCount = width < 768 ? 2 : width >= 1280 ? 5 : width >= 1024 ? 4 : 3;
  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    posts.filter((_, index) => index % columnCount === columnIndex)
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.hero}>
        <Text style={styles.kicker}>Kuva & video</Text>
        <Text style={styles.title}>Mediavirta</Text>
        <Text style={styles.body}>Tiivis Pinterest/TikTok-tyylinen ruudukko nostaa yhteisön kuvat, videot ja viraalit hetket pintaan.</Text>
      </View>

      <View style={styles.grid}>
        {columns.map((column, columnIndex) => (
          <View key={`column-${columnIndex}`} style={styles.column}>
            {column.map((post, itemIndex) => {
              const variant = (itemIndex + columnIndex) % 4;
              return (
                <TouchableOpacity key={post.post_id} style={styles.card} onPress={() => router.push(`/posts/${post.post_id}`)}>
                  <View style={[styles.mediaFrame, variant === 0 && styles.mediaTall, variant === 1 && styles.mediaWide, variant === 2 && styles.mediaShort]}>
                    {post.image ? (
                      <Image source={{ uri: resolveMediaUrl(post.image) }} style={styles.image} resizeMode="cover" />
                    ) : post.video ? (
                      Platform.OS === 'web'
                        ? React.createElement('video', {
                            src: resolveMediaUrl(post.video),
                            controls: true,
                            muted: true,
                            playsInline: true,
                            style: {
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              borderRadius: 14,
                              backgroundColor: '#111827',
                            },
                          })
                        : <NativeVideo uri={resolveMediaUrl(post.video) || post.video} />
                    ) : null}
                    <View style={styles.heatBadge}>
                      <Text style={styles.heatBadgeText}>{variant === 0 ? '🚀 Ilmiö' : variant === 1 ? '🔥 Kuuma' : '☄️ +12 kommenttia'}</Text>
                    </View>
                    {post.video ? (
                      <View style={styles.videoBadge}>
                        <Ionicons name="play" size={12} color="#fff" />
                        <Text style={styles.videoBadgeText}>Video</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cardText} numberOfLines={2}>{post.text || `@${post.username}`}</Text>
                  <Text style={styles.meta}>@{post.username} · {formatRelativeTime(post.created_at)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {!posts.length ? (
        <View style={styles.empty}>
          <Ionicons name="images-outline" size={32} color="#64748b" />
          <Text style={styles.emptyTitle}>Ei mediajulkaisuja vielä</Text>
          <Text style={styles.emptyBody}>Kun käyttäjät lisäävät kuvia tai videoita, ne näkyvät täällä.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff7ed' },
  container: { padding: 12, backgroundColor: '#fff7ed', gap: 14 },
  hero: { backgroundColor: '#2e1065', borderWidth: 1, borderColor: '#a78bfa', borderRadius: 18, padding: 18 },
  kicker: { color: '#facc15', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 5 },
  title: { color: '#fff', fontSize: 25, fontWeight: '900', marginBottom: 8 },
  body: { color: '#ddd6fe', fontSize: 14, lineHeight: 20 },
  grid: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  column: { flex: 1, gap: 10 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 14, padding: 8, gap: 8 },
  mediaFrame: { position: 'relative', width: '100%', aspectRatio: 0.78, borderRadius: 14, backgroundColor: '#111827', overflow: 'hidden' },
  mediaTall: { aspectRatio: 0.62 },
  mediaWide: { aspectRatio: 1.08 },
  mediaShort: { aspectRatio: 0.92 },
  image: { width: '100%', height: '100%' },
  nativeVideo: { width: '100%', height: '100%', backgroundColor: '#111827' },
  heatBadge: { position: 'absolute', left: 8, top: 8, borderRadius: 999, backgroundColor: 'rgba(17,24,39,0.82)', paddingHorizontal: 8, paddingVertical: 5 },
  heatBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  videoBadge: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.86)', paddingHorizontal: 8, paddingVertical: 5 },
  videoBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  cardText: { color: '#111827', fontSize: 14, fontWeight: '800', lineHeight: 19 },
  meta: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', padding: 24, gap: 6 },
  emptyTitle: { color: '#111827', fontSize: 16, fontWeight: '900' },
  emptyBody: { color: '#64748b', textAlign: 'center' },
});
