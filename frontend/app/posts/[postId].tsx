import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { useApiClient } from '../../src/hooks/useApiClient';
import { API_BASE } from '../../src/utils/api/http';
import { formatCompactCount, formatReplayDate, formatReplayDuration, isLiveReplayPost } from '../../src/features/video/liveReplay';
import { PostActionsButton, shareActionPost, type ActionablePost } from '../../src/features/postActions/PostActionsButton';

const BACKEND_BASE = API_BASE.replace(/\/api$/, '');

const resolveMediaUrl = (uri?: string | null) => {
  if (!uri) return undefined;
  if (/^https?:\/\//i.test(uri)) return uri;
  return `${BACKEND_BASE}${uri.startsWith('/') ? uri : `/${uri}`}`;
};

const logVideoEvent = (name: string, video: HTMLVideoElement, postId?: string, src?: string) => {
  const payload = {
    label: 'post-detail',
    postId,
    src,
    currentSrc: video.currentSrc,
    currentTime: video.currentTime,
    duration: video.duration,
    paused: video.paused,
    ended: video.ended,
    seeking: video.seeking,
    readyState: video.readyState,
    networkState: video.networkState,
    errorCode: video.error?.code,
    errorMessage: video.error?.message,
  };
  if (name === 'error' || name === 'stalled' || name === 'abort') {
    console.warn(`[video-playback] ${name}`, payload);
  } else {
    console.info(`[video-playback] ${name}`, payload);
  }
};

const StableWebVideo = React.memo(function StableWebVideo({
  postId,
  poster,
  src,
  onAnalytics,
}: {
  postId?: string;
  poster?: string;
  src: string;
  onAnalytics?: (eventName: string, currentTime: number, duration?: number, milestone?: number) => void;
}) {
  const lastLoggedSecondRef = useRef(-1);
  const milestonesRef = useRef(new Set<string>());
  const mark = (key: string) => {
    if (milestonesRef.current.has(key)) return false;
    milestonesRef.current.add(key);
    return true;
  };
  return React.createElement('video', {
    controls: true,
    src,
    poster,
    playsInline: true,
    preload: 'metadata',
    onLoadedMetadata: (event: Event) => logVideoEvent('loadedmetadata', event.currentTarget as HTMLVideoElement, postId, src),
    onPlaying: (event: Event) => {
      const video = event.currentTarget as HTMLVideoElement;
      logVideoEvent('playing', video, postId, src);
      if (mark('start')) onAnalytics?.('start', video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined);
    },
    onPause: (event: Event) => logVideoEvent('pause', event.currentTarget as HTMLVideoElement, postId, src),
    onWaiting: (event: Event) => logVideoEvent('waiting', event.currentTarget as HTMLVideoElement, postId, src),
    onStalled: (event: Event) => logVideoEvent('stalled', event.currentTarget as HTMLVideoElement, postId, src),
    onSuspend: (event: Event) => logVideoEvent('suspend', event.currentTarget as HTMLVideoElement, postId, src),
    onAbort: (event: Event) => logVideoEvent('abort', event.currentTarget as HTMLVideoElement, postId, src),
    onEnded: (event: Event) => {
      const video = event.currentTarget as HTMLVideoElement;
      logVideoEvent('ended', video, postId, src);
      if (mark('replay')) onAnalytics?.('replay', video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined, 100);
    },
    onError: (event: Event) => logVideoEvent('error', event.currentTarget as HTMLVideoElement, postId, src),
    onTimeUpdate: (event: Event) => {
      const video = event.currentTarget as HTMLVideoElement;
      const rounded = Math.floor(video.currentTime);
      if (rounded > 0 && rounded % 5 === 0 && lastLoggedSecondRef.current !== rounded) {
        lastLoggedSecondRef.current = rounded;
        logVideoEvent('timeupdate', video, postId, src);
      }
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const percent = (video.currentTime / video.duration) * 100;
      [25, 50, 75, 100].forEach((milestone) => {
        if (percent >= milestone && mark(String(milestone))) {
          onAnalytics?.(String(milestone), video.currentTime, video.duration, milestone);
        }
      });
    },
    style: {
      width: '100%',
      aspectRatio: '16 / 9',
      borderRadius: 16,
      backgroundColor: '#020617',
      objectFit: 'contain',
      display: 'block',
    },
  });
});

type Post = {
  post_id: string;
  user_id?: string | null;
  username: string;
  profile_picture?: string | null;
  text: string;
  hashtags?: string[];
  mentions?: string[];
  image?: string | null;
  video?: string | null;
  videoUrl?: string | null;
  media_url?: string | null;
  thumbnailUrl?: string | null;
  thumbnail_url?: string | null;
  title?: string | null;
  duration?: number | null;
  type?: string | null;
  status?: string | null;
  likes_count: number;
  comments_count: number;
  views?: number | null;
  watch_time?: number | null;
  completion_rate?: number | null;
  replay_count?: number | null;
  moderation_status?: string | null;
  copyright_status?: string | null;
  music_risk?: string | null;
  music_warning_acknowledged?: boolean | null;
  distribution_limited?: boolean | null;
  created_at: string;
};

type Comment = {
  comment_id: string;
  post_id: string;
  username: string;
  text: string;
  created_at: string;
};

function NativeVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={styles.video} />;
}

export default function PostDetailScreen() {
  const router = useRouter();
  const { postId, commentId } = useLocalSearchParams<{ postId: string; commentId?: string }>();
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);
  const commentLayouts = useRef<Record<string, number>>({});
  const highlightedCommentId = typeof commentId === 'string' ? commentId : null;

  useEffect(() => {
    let mounted = true;
    const loadPost = async () => {
      if (!postId) return;
      setLoading(true);
      const postResp = await apiFetch(`/posts/${postId}`, {}, { requireAuth: true });
      const data = postResp && postResp.ok ? await postResp.json() : null;
      if (!mounted) return;
      setPost(data);
      setLoading(false);
    };
    const loadComments = async () => {
      if (!postId) return;
      const commentsResp = await apiFetch(`/posts/${postId}/comments`, {}, { requireAuth: true });
      const commentData = commentsResp && commentsResp.ok ? await commentsResp.json() : [];
      if (!mounted) return;
      setComments(Array.isArray(commentData) ? commentData : []);
    };
    const load = async () => {
      await Promise.all([loadPost(), loadComments()]);
      setLoading(false);
    };
    void load();
    const intervalId = setInterval(() => {
      void loadComments();
    }, 10000);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [apiFetch, postId, token]);

  useEffect(() => {
    if (!highlightedCommentId) return;
    const y = commentLayouts.current[highlightedCommentId];
    if (typeof y === 'number' && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
      });
    }
  }, [comments, highlightedCommentId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#007AFF" />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Post not found</Text>
      </View>
    );
  }

  const videoUri = resolveMediaUrl(post.videoUrl || post.video || post.media_url);
  const posterUri = resolveMediaUrl(post.thumbnailUrl || post.thumbnail_url || post.image);
  const isProcessing = post.status === 'processing';
  const isLiveReplay = isLiveReplayPost(post);
  const sendVideoAnalytics = async (eventName: string, currentTime: number, duration?: number, milestone?: number) => {
    try {
      await apiFetch(`/posts/${post.post_id}/video-analytics`, {
        method: 'POST',
        body: JSON.stringify({
          event: eventName,
          current_time: currentTime,
          duration,
          milestone,
        }),
      }, { requireAuth: true });
    } catch (error) {
      console.warn('[video-analytics] post detail tracking failed', { postId: post.post_id, eventName, error });
    }
  };

  const reportPost = async (target: ActionablePost, reason: 'inappropriate' | 'music_copyright' = 'inappropriate') => {
    try {
      const response = await apiFetch('/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: 'post',
          target_id: target.post_id,
          reason,
          details: reason === 'music_copyright'
            ? 'Possible music or copyright issue reported from post detail'
            : 'Reported from post detail',
        }),
      });
      if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
      Alert.alert('YOSLA', reason === 'music_copyright' ? 'Tekijänoikeusilmoitus lähetetty' : 'Ilmoitus lähetetty');
    } catch (error) {
      console.error('[post-actions] report failed', { postId: target.post_id, error });
      Alert.alert('Virhe', error instanceof Error ? error.message : 'Ilmoituksen lähetys epäonnistui');
    }
  };

  const editPost = async (target: ActionablePost) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      Alert.alert('Muokkaus', 'Avaa muokkaus webissä tai käytä profiilin Recordings-välilehteä tallenteille.');
      return;
    }
    const nextText = window.prompt('Muokkaa julkaisun tekstiä', target.text || target.title || '');
    if (nextText === null) return;
    try {
      const response = await apiFetch(`/posts/${target.post_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nextText.trim() }),
      });
      if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
      const updated = await response.json();
      setPost((current) => current ? { ...current, ...updated } : updated);
      Alert.alert('YOSLA', 'Julkaisu päivitetty');
    } catch (error) {
      console.error('[post-actions] edit failed', { postId: target.post_id, error });
      Alert.alert('Virhe', error instanceof Error ? error.message : 'Julkaisun muokkaus epäonnistui');
    }
  };

  const deletePost = async (target: ActionablePost) => {
    const runDelete = async () => {
      try {
        const response = await apiFetch(`/posts/${target.post_id}`, { method: 'DELETE' });
        if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
        Alert.alert('YOSLA', 'Julkaisu poistettu');
        router.back();
      } catch (error) {
        console.error('[post-actions] delete failed', { postId: target.post_id, error });
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

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.page}>
      <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>@{post.username}</Text>
          <Text style={styles.meta}>{post.created_at}</Text>
        </View>
        <View style={styles.headerActions}>
          <PostActionsButton
            post={post}
            currentUserId={user?.user_id}
            onEdit={editPost}
            onDelete={deletePost}
            onHide={() => router.back()}
            onReport={(target, reason) => void reportPost(target, reason)}
          />
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => void shareActionPost(post)}
            accessibilityRole="button"
            accessibilityLabel="Jaa julkaisu"
          >
            <Text style={styles.shareButtonIcon}>↗</Text>
          </TouchableOpacity>
        </View>
      </View>
      {isLiveReplay ? (
        <View style={styles.liveReplayHero}>
          <View style={styles.liveReplayHeader}>
            {post.profile_picture ? <Image source={{ uri: resolveMediaUrl(post.profile_picture) }} style={styles.replayAvatar} /> : <View style={styles.replayAvatarFallback}><Text style={styles.replayAvatarText}>{post.username.slice(0, 2).toUpperCase()}</Text></View>}
            <View style={{ flex: 1 }}>
              <View style={styles.liveReplayBadge}>
                <View style={styles.liveReplayDot} />
                <Text style={styles.liveReplayBadgeText}>LIVE REPLAY</Text>
              </View>
              <Text style={styles.liveReplayTitle}>{post.title || post.text || 'YOSLA Live'}</Text>
              <View style={styles.liveReplayCreatorRow}>
                <View style={styles.liveReplayCreatorBadge}>
                  <Ionicons name="person-circle-outline" size={14} color="#93c5fd" />
                  <Text style={styles.liveReplayCreatorText}>@{post.username}</Text>
                </View>
                <Text style={styles.liveReplayMeta}>{formatReplayDate(post.created_at)}</Text>
              </View>
            </View>
          </View>
          <View style={styles.liveReplayStats}>
            <View style={styles.liveReplayStat}>
              <Ionicons name="time-outline" size={13} color="#bbf7d0" />
              <Text style={styles.liveReplayStatText}>{formatReplayDuration(post.duration)}</Text>
            </View>
            <View style={styles.liveReplayStat}>
              <Ionicons name="eye-outline" size={13} color="#bfdbfe" />
              <Text style={styles.liveReplayStatText}>{formatCompactCount(post.views)} Views</Text>
            </View>
            <View style={styles.liveReplayStat}>
              <Ionicons name="heart-outline" size={13} color="#fecaca" />
              <Text style={styles.liveReplayStatText}>{formatCompactCount(post.likes_count)} Likes</Text>
            </View>
            <View style={styles.liveReplayStat}>
              <Ionicons name="chatbubble-outline" size={13} color="#bae6fd" />
              <Text style={styles.liveReplayStatText}>{formatCompactCount(post.comments_count)} Comments</Text>
            </View>
            <View style={styles.liveReplayStat}>
              <Ionicons name="repeat-outline" size={13} color="#ddd6fe" />
              <Text style={styles.liveReplayStatText}>{formatCompactCount(post.replay_count)} Replays</Text>
            </View>
          </View>
        </View>
      ) : null}
      {isProcessing ? (
        <View style={[styles.mediaCard, isLiveReplay && styles.liveReplayMediaCard]}>
          <View style={styles.processingFrame}>
            <ActivityIndicator color="#60a5fa" />
            <Text style={styles.processingText}>Tallenne valmistuu...</Text>
          </View>
        </View>
      ) : videoUri ? (
        <View style={[styles.mediaCard, isLiveReplay && styles.liveReplayMediaCard]}>
          {Platform.OS === 'web'
            ? <StableWebVideo postId={post.post_id} poster={posterUri} src={videoUri} onAnalytics={sendVideoAnalytics} />
            : <NativeVideo uri={videoUri} />}
        </View>
      ) : posterUri ? (
        <View style={[styles.mediaCard, isLiveReplay && styles.liveReplayMediaCard]}>
          <Image source={{ uri: posterUri }} style={styles.image} resizeMode="cover" />
        </View>
      ) : null}
      <Text style={styles.body}>{post.text}</Text>
      {post.moderation_status ? (
        <View style={styles.moderationBadge}>
          <Text style={styles.moderationBadgeText}>
            {post.moderation_status === 'queued' ? 'Queued for review' : post.moderation_status}
          </Text>
        </View>
      ) : null}
      {post.music_risk && post.music_risk !== 'none' ? (
        <View style={styles.musicWarningStrip}>
          <Text style={styles.musicWarningIcon}>♪</Text>
          <Text style={styles.musicWarningText}>
            Musiikkivaroitus: tämä julkaisu voi sisältää tekijänoikeuksilla suojattua ääntä. Toistuvat vahvistetut rikkomukset laskevat Trust Scorea.
          </Text>
        </View>
      ) : null}
      {(post.hashtags?.length || post.mentions?.length) ? (
        <View style={styles.tagSection}>
          {post.hashtags?.length ? (
            <View style={styles.tagRow}>
              {post.hashtags.map((tag) => (
                <View key={tag} style={[styles.tagPill, styles.hashtagPill]}>
                  <Text style={styles.hashtagText}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {post.mentions?.length ? (
            <View style={styles.tagRow}>
              {post.mentions.map((mention) => (
                <View key={mention} style={[styles.tagPill, styles.mentionPill]}>
                  <Text style={styles.mentionText}>@{mention}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{post.likes_count}</Text>
          <Text style={styles.statLabel}>Likes</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{post.comments_count}</Text>
          <Text style={styles.statLabel}>Comments</Text>
        </View>
      </View>

      <Text style={styles.commentsTitle}>Comments</Text>
      {comments.map((comment) => {
        const isHighlighted = highlightedCommentId === comment.comment_id;
        return (
          <View
            key={comment.comment_id}
            style={[styles.commentCard, isHighlighted && styles.commentCardHighlighted]}
            onLayout={(event) => {
              commentLayouts.current[comment.comment_id] = event.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.commentMeta}>@{comment.username} · {comment.created_at}</Text>
            <Text style={styles.commentBody}>{comment.text}</Text>
          </View>
        );
      })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  page: { padding: 16, backgroundColor: '#f5f7fb', alignItems: 'center' },
  container: { width: '100%', maxWidth: 1200 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shareButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  shareButtonIcon: { color: '#64748b', fontSize: 18, fontWeight: '900' },
  title: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
  meta: { color: '#6b7280', marginBottom: 16 },
  liveReplayHero: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
    backgroundColor: '#07111f',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.42)',
    padding: 16,
    marginBottom: 14,
    gap: 14,
    shadowColor: '#dc2626',
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  liveReplayHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  replayAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#1f2937', borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)' },
  replayAvatarFallback: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1d4ed8', borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)' },
  replayAvatarText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  liveReplayBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
    backgroundColor: 'rgba(220,38,38,0.18)',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  liveReplayDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#ef4444' },
  liveReplayBadgeText: { color: '#fecaca', fontSize: 11, fontWeight: '900' },
  liveReplayTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 8, lineHeight: 28 },
  liveReplayCreatorRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  liveReplayCreatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.24)',
    backgroundColor: 'rgba(37,99,235,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  liveReplayCreatorText: { color: '#bfdbfe', fontSize: 11, fontWeight: '900' },
  liveReplayMeta: { color: '#94a3b8', fontSize: 11, fontWeight: '800' },
  liveReplayStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  liveReplayStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  liveReplayStatText: { color: '#e2e8f0', fontSize: 12, fontWeight: '900' },
  mediaCard: { width: '100%', maxWidth: 1100, alignSelf: 'center', backgroundColor: '#020617', borderRadius: 18, borderWidth: 1, borderColor: '#1f2937', padding: 8, marginBottom: 16, overflow: 'hidden' },
  liveReplayMediaCard: {
    borderColor: 'rgba(248,113,113,0.42)',
    shadowColor: '#dc2626',
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#020617', borderRadius: 16 },
  image: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: '#020617' },
  processingFrame: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#020617' },
  processingText: { color: '#dbeafe', fontSize: 14, fontWeight: '900' },
  body: { fontSize: 16, color: '#111827', lineHeight: 24, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  moderationBadge: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fef3c7' },
  moderationBadgeText: { color: '#92400e', fontWeight: '800', fontSize: 12 },
  musicWarningStrip: { width: '100%', maxWidth: 1100, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, borderWidth: 1, borderColor: '#fde68a', borderRadius: 14, backgroundColor: '#fffbeb', paddingHorizontal: 12, paddingVertical: 10 },
  musicWarningIcon: { color: '#92400e', fontSize: 16, fontWeight: '900' },
  musicWarningText: { flex: 1, color: '#92400e', fontSize: 13, fontWeight: '800', lineHeight: 18 },
  tagSection: { marginTop: 14, gap: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  hashtagPill: { backgroundColor: '#EFF6FF' },
  mentionPill: { backgroundColor: '#ECFDF5' },
  hashtagText: { color: '#0F62FE', fontWeight: '800', fontSize: 12 },
  mentionText: { color: '#0F766E', fontWeight: '800', fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e5e7eb', padding: 14, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '900', color: '#007AFF' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 4, fontWeight: '700' },
  commentsTitle: { marginTop: 20, marginBottom: 10, fontSize: 18, fontWeight: '800', color: '#111827' },
  commentCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, marginBottom: 10 },
  commentCardHighlighted: { borderColor: '#007AFF', backgroundColor: '#eef6ff' },
  commentMeta: { color: '#6b7280', fontSize: 12, marginBottom: 6, fontWeight: '700' },
  commentBody: { color: '#111827', fontSize: 14, lineHeight: 20 },
});
