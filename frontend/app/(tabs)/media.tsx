import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useRouter } from 'expo-router';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useAuth } from '../../src/contexts/AuthContext';
import { liveSignalingSocket } from '../../src/realtime/live-signaling';
import { API_BASE } from '../../src/utils/api/http';
import { formatRelativeTime } from '../../src/utils/time';
import type { Post } from '../../src/features/feed/dwell';
import { formatCompactCount, formatReplayDate, formatReplayDuration, isLiveReplayPost } from '../../src/features/video/liveReplay';
import { PostActionsButton, shareActionPost, type ActionablePost } from '../../src/features/postActions/PostActionsButton';

const BACKEND_BASE = API_BASE.replace(/\/api$/, '');

const resolveMediaUrl = (uri?: string) => {
  if (!uri) return undefined;
  if (/^https?:\/\//i.test(uri)) return uri;
  return `${BACKEND_BASE}${uri.startsWith('/') ? uri : `/${uri}`}`;
};

const buildVideoDebugProps = (label: string, postId: string, src?: string) => Platform.OS === 'web'
  ? {
      onLoadedMetadata: (event: Event) => {
        const video = event.currentTarget as HTMLVideoElement;
        console.info('[video-playback] loadedmetadata', {
          label,
          postId,
          src,
          duration: video.duration,
          readyState: video.readyState,
          networkState: video.networkState,
        });
      },
      onError: (event: Event) => {
        const video = event.currentTarget as HTMLVideoElement;
        console.error('[video-playback] error', {
          label,
          postId,
          src,
          currentTime: video.currentTime,
          duration: video.duration,
          readyState: video.readyState,
          networkState: video.networkState,
          errorCode: video.error?.code,
          errorMessage: video.error?.message,
        });
      },
      onEnded: (event: Event) => {
        const video = event.currentTarget as HTMLVideoElement;
        console.info('[video-playback] ended', {
          label,
          postId,
          src,
          currentTime: video.currentTime,
          duration: video.duration,
          readyState: video.readyState,
          networkState: video.networkState,
        });
      },
      onStalled: (event: Event) => {
        const video = event.currentTarget as HTMLVideoElement;
        console.warn('[video-playback] stalled', {
          label,
          postId,
          src,
          currentTime: video.currentTime,
          duration: video.duration,
          readyState: video.readyState,
          networkState: video.networkState,
        });
      },
    }
  : {};

function NativeVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.nativeVideo} />;
}

export default function MediaScreen() {
  const { apiFetch } = useApiClient();
  const { user } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [postActionNotice, setPostActionNotice] = useState('');
  const postActionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPostActionNotice = useCallback((message: string) => {
    setPostActionNotice(message);
    if (postActionNoticeTimerRef.current) clearTimeout(postActionNoticeTimerRef.current);
    postActionNoticeTimerRef.current = setTimeout(() => setPostActionNotice(''), 2600);
  }, []);

  useEffect(() => () => {
    if (postActionNoticeTimerRef.current) clearTimeout(postActionNoticeTimerRef.current);
  }, []);

  const loadMedia = useCallback(async () => {
    try {
      const response = await apiFetch('/media/posts?limit=120');
      if (!response?.ok) {
        setPosts([]);
        return;
      }
      const payload = await response.json();
      const allPosts = Array.isArray(payload) ? payload as Post[] : [];
      setPosts(allPosts);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  useEffect(() => {
    const handleVideoReady = () => {
      void loadMedia();
    };
    liveSignalingSocket.on('VIDEO_READY', handleVideoReady);
    return () => {
      liveSignalingSocket.off('VIDEO_READY', handleVideoReady);
    };
  }, [loadMedia]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadMedia();
  };

  const hidePost = (postId: string) => {
    setPosts((current) => current.filter((post) => post.post_id !== postId));
  };

  const reportPost = async (post: ActionablePost, reason: 'inappropriate' | 'music_copyright' = 'inappropriate') => {
    try {
      const response = await apiFetch('/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: 'post',
          target_id: post.post_id,
          reason,
          details: reason === 'music_copyright'
            ? 'Possible music or copyright issue reported from media feed'
            : 'Reported from media feed',
        }),
      });
      if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
      Alert.alert('YOSLA', reason === 'music_copyright' ? 'Tekijänoikeusilmoitus lähetetty' : 'Ilmoitus lähetetty');
    } catch (error) {
      console.error('[post-actions] report failed', { postId: post.post_id, error });
      Alert.alert('Virhe', error instanceof Error ? error.message : 'Ilmoituksen lähetys epäonnistui');
    }
  };

  const editPost = async (post: ActionablePost) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      Alert.alert('Muokkaus', 'Avaa julkaisu muokkausta varten.');
      return;
    }
    const nextText = window.prompt('Muokkaa julkaisun tekstiä', post.text || post.title || '');
    if (nextText === null) return;
    try {
      const response = await apiFetch(`/posts/${post.post_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nextText.trim() }),
      });
      if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
      const updated = await response.json();
      setPosts((current) => current.map((item) => item.post_id === updated.post_id ? { ...item, ...updated } : item));
      Alert.alert('YOSLA', 'Julkaisu päivitetty');
    } catch (error) {
      console.error('[post-actions] edit failed', { postId: post.post_id, error });
      Alert.alert('Virhe', error instanceof Error ? error.message : 'Julkaisun muokkaus epäonnistui');
    }
  };

  const deletePost = async (post: ActionablePost) => {
    const runDelete = async () => {
      try {
        const response = await apiFetch(`/posts/${post.post_id}`, { method: 'DELETE' });
        if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
        hidePost(post.post_id);
        Alert.alert('YOSLA', 'Julkaisu poistettu');
      } catch (error) {
        console.error('[post-actions] delete failed', { postId: post.post_id, error });
        Alert.alert('Virhe', error instanceof Error ? error.message : 'Julkaisun poisto epäonnistui');
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || window.confirm('Poistetaanko julkaisu?')) void runDelete();
      return;
    }
    Alert.alert('Poista julkaisu', 'Poistetaanko julkaisu pysyvästi?', [
      { text: 'Peruuta', style: 'cancel' },
      { text: 'Poista', style: 'destructive', onPress: () => void runDelete() },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const columnCount = isMobile ? 2 : width >= 1280 ? 5 : width >= 1024 ? 4 : 3;
  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    posts.filter((_, index) => index % columnCount === columnIndex)
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.container, isMobile && styles.mobileContainer]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.hero}>
        <Text style={styles.kicker}>Kuva & video</Text>
        <Text style={styles.title}>Mediavirta</Text>
        <Text style={styles.body}>YOSLA-tyylinen ruudukko nostaa yhteisön kuvat, videot ja viraali hetket pintaan.</Text>
      </View>

      <View style={[styles.grid, isMobile && styles.mobileGrid]}>
        {columns.map((column, columnIndex) => (
          <View key={`column-${columnIndex}`} style={[styles.column, isMobile && styles.mobileColumn]}>
            {column.map((post, itemIndex) => {
              const variant = (itemIndex + columnIndex) % 4;
              const postVideo = post.videoUrl || post.video;
              const isProcessing = post.status === 'processing';
              const isLiveReplay = isLiveReplayPost(post);
              const mediaFrameStyle = [
                styles.mediaFrame,
                isMobile && styles.mobileMediaFrame,
                postVideo ? styles.mediaVideoTall : null,
                !postVideo && variant === 0 && styles.mediaTall,
                !postVideo && variant === 1 && styles.mediaWide,
                !postVideo && variant === 2 && styles.mediaShort,
              ];
              return (
                <TouchableOpacity
                  key={post.post_id}
                  style={[styles.card, isLiveReplay && styles.liveReplayCard, isMobile && styles.mobileCard]}
                  onPress={() => router.push(`/posts/${post.post_id}`)}
                >
                  <View style={[mediaFrameStyle, isLiveReplay && styles.liveReplayFrame]}>
                    <View style={styles.cardActions}>
                      <PostActionsButton
                        post={post}
                        currentUserId={user?.user_id}
                        compact
                        onEdit={editPost}
                        onDelete={deletePost}
                        onHide={(target) => hidePost(target.post_id)}
                        onReport={(target, reason) => void reportPost(target, reason)}
                        onNotice={showPostActionNotice}
                      />
                      <TouchableOpacity
                        style={styles.cardActionButton}
                        onPressIn={(event) => event.stopPropagation?.()}
                        onPress={(event) => {
                          event.stopPropagation?.();
                          void shareActionPost(post, showPostActionNotice);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Jaa julkaisu"
                      >
                        <Ionicons name="share-social-outline" size={16} color="#64748b" />
                      </TouchableOpacity>
                    </View>
                    {isProcessing ? (
                      <View style={styles.processingFrame}>
                        <ActivityIndicator color="#60a5fa" />
                        <Text style={styles.processingText}>Tallenne valmistuu...</Text>
                      </View>
                    ) : postVideo ? (
                      Platform.OS === 'web'
                        ? React.createElement('video', {
                            src: resolveMediaUrl(postVideo),
                            controls: true,
                            muted: true,
                            playsInline: true,
                            poster: resolveMediaUrl(post.image),
                            ...buildVideoDebugProps('media-card', post.post_id, resolveMediaUrl(postVideo)),
                            style: {
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              borderRadius: 14,
                              backgroundColor: '#111827',
                            },
                          })
                        : <NativeVideo uri={resolveMediaUrl(postVideo) || postVideo} />
                    ) : post.image ? (
                      <Image source={{ uri: resolveMediaUrl(post.image) }} style={styles.image} resizeMode="cover" />
                    ) : null}
                    <View style={styles.heatBadge}>
                      <Text style={styles.heatBadgeText}>{variant === 0 ? '🚀 Ilmiö' : variant === 1 ? '🔥 Kuuma' : '☄️ +12 kommenttia'}</Text>
                    </View>
                    {postVideo ? (
                      <View style={styles.videoBadge}>
                        <Ionicons name="play" size={12} color="#fff" />
                        <Text style={styles.videoBadgeText}>{isLiveReplay ? 'LIVE REPLAY' : 'Video'}</Text>
                      </View>
                    ) : isProcessing ? (
                      <View style={styles.videoBadge}>
                        <Ionicons name="time-outline" size={12} color="#fff" />
                        <Text style={styles.videoBadgeText}>Processing</Text>
                      </View>
                    ) : null}
                    {isLiveReplay ? (
                      <View style={[styles.replayMetricsOverlay, isMobile && styles.mobileReplayMetricsOverlay]}>
                        <View style={styles.replayOverlayHeader}>
                          <View style={styles.replayBadge}>
                            <View style={styles.replayLiveDot} />
                            <Text style={styles.replayBadgeText}>LIVE REPLAY</Text>
                          </View>
                          <Text style={styles.replayDateText}>{formatReplayDate(post.created_at)}</Text>
                        </View>
                        <Text style={styles.replayDurationText}>{formatReplayDuration(post.duration)}</Text>
                        <View style={styles.replayMetricPillRow}>
                          <View style={styles.replayMetricPill}>
                            <Ionicons name="eye-outline" size={11} color="#bfdbfe" />
                            <Text style={styles.replayMetricPillText}>{formatCompactCount(post.views)}</Text>
                          </View>
                          <View style={styles.replayMetricPill}>
                            <Ionicons name="heart-outline" size={11} color="#fecaca" />
                            <Text style={styles.replayMetricPillText}>{formatCompactCount(post.likes_count)}</Text>
                          </View>
                          <View style={styles.replayMetricPill}>
                            <Ionicons name="chatbubble-outline" size={11} color="#bae6fd" />
                            <Text style={styles.replayMetricPillText}>{formatCompactCount(post.comments_count)}</Text>
                          </View>
                          <View style={styles.replayMetricPill}>
                            <Ionicons name="repeat-outline" size={11} color="#ddd6fe" />
                            <Text style={styles.replayMetricPillText}>{formatCompactCount(post.replay_count)}</Text>
                          </View>
                        </View>
                      </View>
                    ) : null}
                  </View>
                  {isLiveReplay ? (
                    <View style={styles.liveReplayInfoRow}>
                      <View style={styles.liveReplayCreatorBadge}>
                        <Ionicons name="person-circle-outline" size={14} color="#93c5fd" />
                        <Text style={styles.liveReplayCreatorText}>@{post.username}</Text>
                      </View>
                      <Text style={styles.liveReplayInfoDate}>{formatReplayDate(post.created_at)}</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.cardText, isLiveReplay && styles.liveReplayCardText]} numberOfLines={2}>{post.text || `@${post.username}`}</Text>
                  {post.music_risk && post.music_risk !== 'none' ? (
                    <View style={styles.musicWarningPill}>
                      <Ionicons name="musical-notes-outline" size={12} color="#92400e" />
                      <Text style={styles.musicWarningPillText}>Musiikkivaroitus</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.meta, isLiveReplay && styles.liveReplayMeta]}>@{post.username} · {isLiveReplay ? formatReplayDate(post.created_at) : formatRelativeTime(post.created_at)}</Text>
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
      {postActionNotice ? (
        <View style={styles.postActionNotice} accessibilityRole="alert">
          <Ionicons name="checkmark-circle" size={16} color="#dcfce7" />
          <Text style={styles.postActionNoticeText}>{postActionNotice}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff7ed' },
  container: { padding: 12, backgroundColor: '#fff7ed', gap: 14 },
  mobileContainer: { paddingHorizontal: 8, paddingTop: 10, gap: 10, width: '100%' },
  hero: { backgroundColor: '#2e1065', borderWidth: 1, borderColor: '#a78bfa', borderRadius: 18, padding: 18 },
  kicker: { color: '#facc15', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', marginBottom: 5 },
  title: { color: '#fff', fontSize: 25, fontWeight: '900', marginBottom: 8 },
  body: { color: '#ddd6fe', fontSize: 14, lineHeight: 20 },
  grid: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  mobileGrid: { gap: 8, width: '100%', alignSelf: 'stretch' },
  column: { flex: 1, gap: 10 },
  mobileColumn: { flexBasis: 0, minWidth: 0, gap: 8 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 14, padding: 8, gap: 8 },
  liveReplayCard: {
    backgroundColor: '#07111f',
    borderColor: 'rgba(248,113,113,0.42)',
    shadowColor: '#dc2626',
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  mobileCard: { minWidth: 0, padding: 6, gap: 6, borderRadius: 12 },
  mediaFrame: { position: 'relative', width: '100%', aspectRatio: 0.78, borderRadius: 14, backgroundColor: '#111827', overflow: 'hidden' },
  liveReplayFrame: {
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.52)',
    backgroundColor: '#020617',
  },
  mobileMediaFrame: { borderRadius: 12 },
  mediaTall: { aspectRatio: 0.62 },
  mediaWide: { aspectRatio: 1.08 },
  mediaShort: { aspectRatio: 0.92 },
  mediaVideoTall: { aspectRatio: 0.68 },
  image: { width: '100%', height: '100%' },
  nativeVideo: { width: '100%', height: '100%', backgroundColor: '#111827' },
  processingFrame: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#020617' },
  processingText: { color: '#dbeafe', fontSize: 12, fontWeight: '900' },
  cardActions: { position: 'absolute', right: 8, top: 8, zIndex: 10, flexDirection: 'row', gap: 6 },
  cardActionButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  postActionNotice: {
    position: Platform.OS === 'web' ? 'fixed' as any : 'absolute',
    top: 18,
    right: 18,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
    backgroundColor: 'rgba(15,23,42,0.94)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#020617',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 8,
  },
  postActionNoticeText: { color: '#f8fafc', fontSize: 13, fontWeight: '900' },
  heatBadge: { position: 'absolute', left: 8, top: 8, borderRadius: 999, backgroundColor: 'rgba(17,24,39,0.82)', paddingHorizontal: 8, paddingVertical: 5 },
  heatBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  videoBadge: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.86)', paddingHorizontal: 8, paddingVertical: 5 },
  videoBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  replayMetricsOverlay: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(2,6,23,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.46)',
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 6,
    shadowColor: '#ef4444',
    shadowOpacity: 0.22,
    shadowRadius: 14,
  },
  mobileReplayMetricsOverlay: {
    bottom: 36,
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  replayOverlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  replayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(220,38,38,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  replayLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#ef4444',
  },
  replayBadgeText: { color: '#fecaca', fontSize: 9, fontWeight: '900' },
  replayDateText: { color: '#94a3b8', fontSize: 9, fontWeight: '800' },
  replayDurationText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  replayMetricPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  replayMetricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  replayMetricPillText: { color: '#e2e8f0', fontSize: 9, fontWeight: '900' },
  liveReplayInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  liveReplayCreatorBadge: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(37,99,235,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.24)',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  liveReplayCreatorText: { color: '#bfdbfe', fontSize: 10, fontWeight: '900' },
  liveReplayInfoDate: { color: '#94a3b8', fontSize: 10, fontWeight: '800' },
  cardText: { color: '#111827', fontSize: 14, fontWeight: '800', lineHeight: 19 },
  liveReplayCardText: { color: '#f8fafc' },
  musicWarningPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', paddingHorizontal: 8, paddingVertical: 5 },
  musicWarningPillText: { color: '#92400e', fontSize: 11, fontWeight: '900' },
  meta: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  liveReplayMeta: { color: '#94a3b8' },
  empty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', padding: 24, gap: 6 },
  emptyTitle: { color: '#111827', fontSize: 16, fontWeight: '900' },
  emptyBody: { color: '#64748b', textAlign: 'center' },
});
