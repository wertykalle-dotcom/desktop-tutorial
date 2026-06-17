import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
  Animated,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApiClient } from '../../src/hooks/useApiClient';
import { formatRelativeTime, formatLocalDate } from '../../src/utils/time';
import { useI18n } from '../../src/contexts/I18nContext';
import { buildDwellEvents, getVisiblePostIds, type FeedItem as DwellFeedItem, type Post, type Comment } from '../../src/features/feed/dwell';
import { API_BASE } from '../../src/utils/api/http';
import { liveSignalingSocket } from '../../src/realtime/live-signaling';
import { formatCompactCount, formatReplayDate, formatReplayDuration, isLiveReplayPost } from '../../src/features/video/liveReplay';
import { PostActionsButton, shareActionPost, type ActionablePost } from '../../src/features/postActions/PostActionsButton';
import type { BreakingLivePayload, DailyTrendsPayload, LocalYoslaPayload } from '../../src/features/growth/growthTypes';

const BACKEND_BASE = API_BASE.replace(/\/api$/, '');

// Re-export types for local use
type LocalPost = Post;

type AdConfig = {
  placements: {
    in_feed: boolean;
    sidebar: boolean;
    interstitial: boolean;
  };
  frequency: number;
  network_enabled: boolean;
  network_tag: string;
};

type FeedItem = DwellFeedItem | { type: 'ad'; id: string; label: string };

type ActiveLiveStream = {
  roomId: string;
  topic: string;
  username: string;
  profilePicture?: string | null;
  count: number;
  startedAt?: string;
  breakingScore?: number;
};

type HotPostBadge = {
  icon: string;
  label: string;
  tone: 'phenomenon' | 'comet' | 'hot' | 'rising';
};

type CommentNode = Comment & { replies: CommentNode[] };

const reactionOptions = [
  { key: 'fire', emoji: '🔥', label: 'Kova' },
  { key: 'idea', emoji: '💡', label: 'Idea' },
  { key: 'rocket', emoji: '🚀', label: 'Nosto' },
];

const liveHosts = [
  { id: 'live_1', name: 'YOSLA', topic: '#Luonto', viewers: 128, avatar: 'YO' },
  { id: 'live_2', name: 'Studio FI', topic: '#build', viewers: 84, avatar: 'SF' },
  { id: 'live_3', name: 'Creator Lab', topic: '#design', viewers: 42, avatar: 'CL' },
  { id: 'live_4', name: 'Musiikki', topic: '#musiikki', viewers: 203, avatar: 'MU' },
  { id: 'live_5', name: 'Kuvaajat', topic: '#valokuvaus', viewers: 61, avatar: 'KV' },
];

const matrixTrendingCards = [
  {
    rank: '#1',
    tone: 'crimson',
    label: 'KOVA UUTINEN',
    title: 'Suomen talous 2026 - mitä tapahtuu?',
    meta: '184 kommenttia',
    signal: '🔥 Nousussa',
    icon: 'flame' as const,
  },
  {
    rank: '#2',
    tone: 'indigo',
    label: 'KOMETTI',
    title: 'YOSLA julkaisi uuden ominaisuuden!',
    meta: '91 kommenttia',
    signal: '+200% viime 2h',
    icon: 'sparkles' as const,
  },
  {
    rank: '#3',
    tone: 'blue',
    label: 'ILMIÖ',
    title: 'Kesän paras biisi - äänestä suosikkisi',
    meta: '612 kommenttia',
    signal: '🚀 Trendaa 3 yhteisössä',
    icon: 'rocket' as const,
  },
  {
    rank: '#4',
    tone: 'green',
    label: 'NOUSEVA KESKUSTELU',
    title: 'Mikä on sinun tämän kesän kohokohta?',
    meta: '72 kommenttia',
    signal: '⭐ Uusia kommentteja',
    icon: 'chatbubble-ellipses' as const,
  },
] as const;

type MatrixTone = typeof matrixTrendingCards[number]['tone'];

const getMatrixToneStyle = (tone: MatrixTone) => {
  switch (tone) {
    case 'crimson':
      return styles.matrix_crimson;
    case 'indigo':
      return styles.matrix_indigo;
    case 'blue':
      return styles.matrix_blue;
    case 'green':
    default:
      return styles.matrix_green;
  }
};

const upcomingBroadcasts = [
  { time: '14:00-16:00', title: 'Kehittäjiltä', host: 'Studio FI' },
  { time: '19:00-20:00', title: 'Musiikkistudio', host: 'Live' },
  { time: '21:30-22:00', title: 'Creator Q&A', host: 'YOSLA Lab' },
];

const popularCommunities = [
  { tag: '#suomi', members: '18,2k' },
  { tag: '#valokuvaus', members: '9,8k' },
  { tag: '#teknologia', members: '7,4k' },
  { tag: '#musiikki', members: '12,1k' },
];

const globalAchievements = [
  { icon: 'ribbon-outline' as const, title: 'Perustajajäsen', value: 'Joined 2024' },
  { icon: 'chatbubbles-outline' as const, title: 'Viikon keskustelija', value: 'Top 10%' },
  { icon: 'heart-outline' as const, title: 'Suosittu kirjoittaja', value: '100+ tykkäystä' },
  { icon: 'trophy-outline' as const, title: 'Kommenttimestari', value: '500+ kommenttia' },
];

const getPostBadge = (commentsCount = 0): HotPostBadge | null => {
  if (commentsCount >= 500) return { icon: '🚀', label: 'Ilmiö', tone: 'phenomenon' };
  if (commentsCount >= 150) return { icon: '☄️', label: 'Kometti', tone: 'comet' };
  if (commentsCount >= 50) return { icon: '🔥', label: 'Kova Uutinen', tone: 'hot' };
  if (commentsCount >= 5) return { icon: '⭐', label: 'Nouseva keskustelu', tone: 'rising' };
  return null;
};

const buildCommentTree = (comments: Comment[]): CommentNode[] => {
  const nodes = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];
  comments.forEach((comment) => {
    nodes.set(comment.comment_id, { ...comment, replies: [] });
  });
  comments.forEach((comment) => {
    const node = nodes.get(comment.comment_id);
    if (!node) return;
    const parentId = String(
      (comment as { parent_comment_id?: string; reply_to_comment_id?: string }).parent_comment_id ||
      (comment as { parent_comment_id?: string; reply_to_comment_id?: string }).reply_to_comment_id ||
      ''
    );
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent) {
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

function NativeFeedVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = true;
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={styles.nativePostVideo}
    />
  );
}

const moveHighlightedPostFirst = (items: LocalPost[], highlightedId?: string) => {
  if (!highlightedId) return items;
  const index = items.findIndex((post) => post.post_id === highlightedId);
  if (index <= 0) return items;
  const next = [...items];
  const [highlighted] = next.splice(index, 1);
  next.unshift(highlighted);
  return next;
};

function FeedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ highlightPostId?: string | string[] }>();
  const highlightPostId = Array.isArray(params.highlightPostId)
    ? params.highlightPostId[0]
    : params.highlightPostId;
  const [posts, setPosts] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [editingCommentIdByPost, setEditingCommentIdByPost] = useState<Record<string, string | null>>({});
  const [editingCommentTextById, setEditingCommentTextById] = useState<Record<string, string>>({});
  const [likeLoadingByPost, setLikeLoadingByPost] = useState<Record<string, boolean>>({});
  const [repostLoadingByPost, setRepostLoadingByPost] = useState<Record<string, boolean>>({});
  const [commentLoadingByPost, setCommentLoadingByPost] = useState<Record<string, boolean>>({});
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(new Set());
  const [followingByUserId, setFollowingByUserId] = useState<Record<string, boolean>>({});
  const [followLoadingByUserId, setFollowLoadingByUserId] = useState<Record<string, boolean>>({});
  const [imageAspectByPostId, setImageAspectByPostId] = useState<Record<string, number>>({});
  const [reactionByPost, setReactionByPost] = useState<Record<string, string>>({});
  const [reactionCountsByPost, setReactionCountsByPost] = useState<Record<string, Record<string, number>>>({});
  const [savedByPost, setSavedByPost] = useState<Record<string, boolean>>({});
  const [joinedCommunityTags, setJoinedCommunityTags] = useState<Record<string, boolean>>({});
  const [dailyVote, setDailyVote] = useState<'yes' | 'no' | null>(null);
  const [liveViewerCounts, setLiveViewerCounts] = useState<Record<string, number>>({});
  const [activeLiveStreams, setActiveLiveStreams] = useState<ActiveLiveStream[]>([]);
  const [dailyTrends, setDailyTrends] = useState<DailyTrendsPayload | null>(null);
  const [breakingLive, setBreakingLive] = useState<BreakingLivePayload | null>(null);
  const [localYosla, setLocalYosla] = useState<LocalYoslaPayload | null>(null);
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  const [adConfig, setAdConfig] = useState<AdConfig>({
    placements: { in_feed: false, sidebar: false, interstitial: false },
    frequency: 5,
    network_enabled: false,
    network_tag: '',
  });
  const [interstitialVisible, setInterstitialVisible] = useState(false);
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const { width } = useWindowDimensions();
  const highlightPulse = useRef(new Animated.Value(0)).current;
  const highlightGlow = useRef(new Animated.Value(0)).current;
  const activePostStartRef = useRef<Record<string, number>>({});
  const visiblePostIdsRef = useRef<Set<string>>(new Set());
  const dwellFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendDwellEventRef = useRef<(postId: string, dwellMs: number) => Promise<void>>(async () => {});
  const flushVisibleDwellRef = useRef<() => Promise<void>>(async () => {});
  const videoMilestonesByPostRef = useRef<Record<string, Set<string>>>({});
  const isNewUser = (user?.posts_count ?? 0) < 3 && (user?.followers_count ?? 0) === 0 && (user?.following_count ?? 0) <= 2;
  const isDesktop = width >= 768;

  const resolveMediaUrl = (uri?: string) => {
    if (!uri) return undefined;
    if (/^https?:\/\//i.test(uri)) return uri;
    return `${BACKEND_BASE}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const isVideoUrl = (uri?: string) => !!uri && /\.(mp4|mov|webm)(?:$|\?)/i.test(uri);

  const sendVideoAnalytics = useCallback(async (postId: string, eventName: string, currentTime = 0, duration?: number, milestone?: number) => {
    try {
      await apiFetch(`/posts/${postId}/video-analytics`, {
        method: 'POST',
        body: JSON.stringify({
          event: eventName,
          current_time: currentTime,
          duration,
          milestone,
        }),
      });
    } catch (error) {
      console.warn('[video-analytics] feed tracking failed', { postId, eventName, error });
    }
  }, [apiFetch]);

  const markVideoMilestone = (postId: string, key: string) => {
    const current = videoMilestonesByPostRef.current[postId] || new Set<string>();
    if (current.has(key)) return false;
    current.add(key);
    videoMilestonesByPostRef.current[postId] = current;
    return true;
  };

  const buildVideoDebugProps = (postId: string, src?: string) => Platform.OS === 'web'
    ? {
        onLoadedMetadata: (event: Event) => {
          const video = event.currentTarget as HTMLVideoElement;
          console.info('[video-playback] loadedmetadata', {
            label: 'feed',
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
            label: 'feed',
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
        onPlaying: (event: Event) => {
          const video = event.currentTarget as HTMLVideoElement;
          if (markVideoMilestone(postId, 'start')) {
            void sendVideoAnalytics(postId, 'start', video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined);
          }
        },
        onTimeUpdate: (event: Event) => {
          const video = event.currentTarget as HTMLVideoElement;
          if (!Number.isFinite(video.duration) || video.duration <= 0) return;
          const percent = (video.currentTime / video.duration) * 100;
          [25, 50, 75, 100].forEach((milestone) => {
            if (percent >= milestone && markVideoMilestone(postId, String(milestone))) {
              void sendVideoAnalytics(postId, String(milestone), video.currentTime, video.duration, milestone);
            }
          });
        },
        onEnded: (event: Event) => {
          const video = event.currentTarget as HTMLVideoElement;
          console.info('[video-playback] ended', {
            label: 'feed',
            postId,
            src,
            currentTime: video.currentTime,
            duration: video.duration,
            readyState: video.readyState,
            networkState: video.networkState,
          });
          if (markVideoMilestone(postId, 'replay')) {
            void sendVideoAnalytics(postId, 'replay', video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined, 100);
          }
        },
      }
    : {};

  const deletePostFromFeed = (postId: string) => {
    setHiddenPostIds((current) => new Set(current).add(postId));
    setPosts((current) => current.filter((post) => post.post_id !== postId));
    setExpandedComments((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    setCommentInputs((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    setSavedByPost((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    setReactionByPost((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
    setReactionCountsByPost((current) => {
      const next = { ...current };
      delete next[postId];
      return next;
    });
  };

  const updatePostInFeed = (updatedPost: Partial<LocalPost> & { post_id: string }) => {
    setPosts((current) => current.map((post) => post.post_id === updatedPost.post_id ? { ...post, ...updatedPost } : post));
  };

  const editPostFromMenu = async (post: ActionablePost) => {
    const currentText = post.text || post.title || '';
    const submitEdit = async (value: string) => {
      if (value.trim() === currentText.trim()) return;
      try {
        const response = await apiFetch(`/posts/${post.post_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: value.trim() }),
        });
        if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
        const updated = await response.json();
        updatePostInFeed(updated);
        Alert.alert('YOSLA', 'Julkaisu päivitetty');
      } catch (error) {
        console.error('[post-actions] edit failed', { postId: post.post_id, error });
        Alert.alert(t('error'), error instanceof Error ? error.message : 'Julkaisun muokkaus epäonnistui');
      }
    };
    let nextText: string | null = null;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      nextText = window.prompt('Muokkaa julkaisun tekstiä', currentText);
    } else if (typeof (Alert as unknown as { prompt?: unknown }).prompt === 'function') {
      (Alert as unknown as { prompt: (title: string, message?: string, callbackOrButtons?: unknown, type?: string, defaultValue?: string) => void }).prompt(
        'Muokkaa julkaisua',
        'Päivitä julkaisun teksti',
        async (value: string) => {
          await submitEdit(value);
        },
        'plain-text',
        currentText
      );
      return;
    } else {
      Alert.alert('Muokkaus', 'Tämä laite ei tue tekstikenttää tässä pikavalikossa. Avaa julkaisu muokkausta varten.');
      return;
    }
    if (nextText === null || nextText.trim() === currentText.trim()) return;
    await submitEdit(nextText);
  };

  const deletePostFromMenu = async (post: ActionablePost) => {
    const runDelete = async () => {
      try {
        const response = await apiFetch(`/posts/${post.post_id}`, { method: 'DELETE' });
        if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
        deletePostFromFeed(post.post_id);
        Alert.alert('YOSLA', 'Julkaisu poistettu');
      } catch (error) {
        console.error('[post-actions] delete failed', { postId: post.post_id, error });
        Alert.alert(t('error'), error instanceof Error ? error.message : 'Julkaisun poisto epäonnistui');
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || window.confirm('Poistetaanko julkaisu?')) void runDelete();
      return;
    }
    Alert.alert('Poista julkaisu', 'Poistetaanko julkaisu pysyvästi?', [
      { text: t('cancel'), style: 'cancel' },
      { text: 'Poista', style: 'destructive', onPress: () => void runDelete() },
    ]);
  };

  const toggleSavePost = async (post: LocalPost) => {
    const postId = post.post_id;
    const previousSaved = savedByPost[postId] ?? !!post.is_bookmarked;
    const optimisticSaved = !previousSaved;
    setSavedByPost((prev) => ({ ...prev, [postId]: optimisticSaved }));
    setPosts((prev) => prev.map((item) => item.post_id === postId ? { ...item, is_bookmarked: optimisticSaved } : item));
    try {
      const response = await apiFetch('/bookmarks/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId }),
      });
      if (!response || !response.ok) {
        throw new Error(`Bookmark failed (${response?.status || 'network'})`);
      }
      const payload = await response.json();
      setSavedByPost((prev) => ({ ...prev, [postId]: !!payload.is_bookmarked }));
      setPosts((prev) => prev.map((item) => item.post_id === postId ? { ...item, is_bookmarked: !!payload.is_bookmarked } : item));
      Alert.alert('Tallennetut', payload.is_bookmarked ? 'Julkaisu lisättiin kirjanmerkkeihin.' : 'Julkaisu poistettiin kirjanmerkeistä.');
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      setSavedByPost((prev) => ({ ...prev, [postId]: previousSaved }));
      setPosts((prev) => prev.map((item) => item.post_id === postId ? { ...item, is_bookmarked: previousSaved } : item));
      Alert.alert(t('error'), 'Kirjanmerkin tallennus ei onnistunut.');
    }
  };

  const handleReaction = async (post: LocalPost, reactionKey: string) => {
    if (likeLoadingByPost[post.post_id]) return;
    const previousReaction = reactionByPost[post.post_id] || post.user_reaction || null;
    const previousCounts = reactionCountsByPost[post.post_id] || post.reaction_counts || {};
    setLikeLoadingByPost((prev) => ({ ...prev, [post.post_id]: true }));
    setReactionByPost((prev) => {
      setReactionCountsByPost((counts) => {
        const current = counts[post.post_id] || {};
        const next = {
          ...current,
          [reactionKey]: Math.max(0, (current[reactionKey] || 0) + (previousReaction === reactionKey ? 0 : 1)),
        };
        if (previousReaction && previousReaction !== reactionKey) {
          next[previousReaction] = Math.max(0, (next[previousReaction] || 0) - 1);
        }
        return { ...counts, [post.post_id]: next };
      });
      return { ...prev, [post.post_id]: reactionKey };
    });
    try {
      const response = await apiFetch(`/posts/${post.post_id}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction_type: reactionKey }),
      });
      if (!response || !response.ok) {
        throw new Error(`Reaction failed (${response?.status || 'network'})`);
      }
      const payload = await response.json();
      setReactionByPost((prev) => ({ ...prev, [post.post_id]: payload.reaction_type }));
      setReactionCountsByPost((prev) => ({ ...prev, [post.post_id]: payload.reaction_counts || {} }));
      setPosts((prevPosts) =>
        prevPosts.map((item) =>
          item.post_id === post.post_id
            ? { ...item, user_reaction: payload.reaction_type, reaction_counts: payload.reaction_counts || {} }
            : item
        )
      );
    } catch (error) {
      console.error('Error reacting to post:', error);
      setReactionByPost((prev) => ({ ...prev, [post.post_id]: previousReaction || '' }));
      setReactionCountsByPost((prev) => ({ ...prev, [post.post_id]: previousCounts }));
      Alert.alert(t('error'), 'Reaktion tallennus ei onnistunut.');
    } finally {
      setLikeLoadingByPost((prev) => ({ ...prev, [post.post_id]: false }));
    }
  };

  const votePollOption = async (post: LocalPost, optionId: string) => {
    if (!post.poll) return;
    const previousPoll = post.poll;
    const previousPosts = posts;
    const nextOptions = post.poll.options.map((option) => {
      let votesCount = option.votes_count || 0;
      if (post.poll?.user_vote && option.option_id === post.poll.user_vote && post.poll.user_vote !== optionId) {
        votesCount = Math.max(0, votesCount - 1);
      }
      if (option.option_id === optionId && post.poll?.user_vote !== optionId) {
        votesCount += 1;
      }
      return { ...option, votes_count: votesCount };
    });
    const optimisticPoll = {
      ...post.poll,
      options: nextOptions,
      total_votes: nextOptions.reduce((sum, option) => sum + (option.votes_count || 0), 0),
      user_vote: optionId,
    };
    setPosts((current) => current.map((item) => item.post_id === post.post_id ? { ...item, poll: optimisticPoll } : item));
    try {
      const response = await apiFetch(`/posts/${post.post_id}/poll/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: optionId }),
      });
      if (!response || !response.ok) {
        throw new Error(`Poll vote failed (${response?.status || 'network'})`);
      }
      const poll = await response.json();
      setPosts((current) => current.map((item) => item.post_id === post.post_id ? { ...item, poll } : item));
    } catch (error) {
      console.error('Error voting poll:', error);
      setPosts(previousPosts.map((item) => item.post_id === post.post_id ? { ...item, poll: previousPoll } : item));
      Alert.alert(t('error'), 'Äänen tallennus ei onnistunut.');
    }
  };

  useEffect(() => {
    const handleViewerCount = (payload: { roomId?: unknown; count?: unknown }) => {
      const roomId = String(payload.roomId || '');
      const count = Number(payload.count);
      if (!roomId || !Number.isFinite(count)) return;
      setLiveViewerCounts((current) => ({ ...current, [roomId]: count }));
      setActiveLiveStreams((current) =>
        current.map((stream) => stream.roomId === roomId ? { ...stream, count } : stream)
      );
    };
    const handleActiveStreams = (payload: { streams?: unknown }) => {
      const streams = Array.isArray(payload.streams) ? payload.streams : [];
      const nextStreams: ActiveLiveStream[] = [];
      streams.forEach((stream) => {
        if (!stream || typeof stream !== 'object') return;
        const item = stream as Record<string, unknown>;
        const roomId = String(item.roomId || '');
        if (!roomId) return;
        nextStreams.push({
          roomId,
          topic: String(item.topic || '#YOSLA'),
          username: String(item.username || 'Live'),
          profilePicture: typeof item.profilePicture === 'string' ? item.profilePicture : null,
          count: Number(item.count || 0),
          startedAt: typeof item.startedAt === 'string' ? item.startedAt : undefined,
          breakingScore: Number(item.breakingScore || 0),
        });
      });
      setActiveLiveStreams(nextStreams);
      setBreakingLive((current) => current ? { ...current, streams: nextStreams, top: nextStreams[0] || null } : current);
    };
    liveSignalingSocket.on('live:viewer-count-update', handleViewerCount);
    liveSignalingSocket.on('live:active-streams', handleActiveStreams);
    liveSignalingSocket.emit('live:list-active', {});
    return () => {
      liveSignalingSocket.off('live:viewer-count-update', handleViewerCount);
      liveSignalingSocket.off('live:active-streams', handleActiveStreams);
    };
  }, []);

  const handleRepost = async (post: LocalPost) => {
    if (repostLoadingByPost[post.post_id]) return;
    setRepostLoadingByPost((prev) => ({ ...prev, [post.post_id]: true }));
    try {
      const response = await apiFetch(`/posts/${post.post_id}/repost`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Repost failed (${response.status}): ${raw}`);
      }
      await fetchFeed();
    } catch (error) {
      console.error('Error reposting post:', error);
      Alert.alert(t('error'), t('feedRepostFailed'));
    } finally {
      setRepostLoadingByPost((prev) => ({ ...prev, [post.post_id]: false }));
    }
  };

  const fetchFeed = useCallback(async () => {
    if (!token) {
      setPosts([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const response = await apiFetch(`/posts?following_only=${followingOnly ? 'true' : 'false'}`);
      const adResp = await apiFetch('/ads/config', {}, { requireAuth: false });
      const trendsResp = await apiFetch('/growth/daily-trends?limit=8');
      const breakingResp = await apiFetch('/live/breaking');
      const localResp = await apiFetch('/discovery/local-yosla?limit=6');
      if (!response || response.status === 401) {
        setFeedError(true);
        setPosts([]);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        const normalizedPosts = Array.isArray(data)
          ? (data as LocalPost[]).filter((post) => !hiddenPostIds.has(post.post_id))
          : [];
        const orderedPosts = moveHighlightedPostFirst(normalizedPosts, highlightPostId);
        setFeedError(false);
        setPosts(orderedPosts);
        if (highlightPostId && orderedPosts.some((post) => post.post_id === highlightPostId)) {
          setExpandedComments((prev) => ({ ...prev, [highlightPostId]: true }));
        }
        const authorIds = Array.from(
          new Set(
            orderedPosts
              .map((p) => p.user_id)
              .filter((id) => !!id && id !== user?.user_id)
          )
        );
        if (authorIds.length > 0) {
          const followStatePairs = await Promise.all(
            authorIds.map(async (authorId) => {
              try {
                const followResp = await apiFetch(`/users/${authorId}/is-following`);
                if (!followResp || followResp.status === 401) return [authorId, false] as const;
                if (!followResp.ok) return [authorId, false] as const;
                const payload = await followResp.json();
                return [authorId, !!payload?.is_following] as const;
              } catch {
                return [authorId, false] as const;
              }
            })
          );
          const nextMap: Record<string, boolean> = {};
          for (const [authorId, isFollowing] of followStatePairs) {
            nextMap[authorId] = isFollowing;
          }
          setFollowingByUserId((prev) => ({ ...prev, ...nextMap }));
        }
        if (adResp?.ok) {
          const adPayload = await adResp.json();
          setAdConfig({
            placements: {
              in_feed: !!adPayload?.placements?.in_feed,
              sidebar: !!adPayload?.placements?.sidebar,
              interstitial: !!adPayload?.placements?.interstitial,
            },
            frequency: Math.max(1, Number(adPayload?.frequency || 5)),
            network_enabled: !!adPayload?.network_enabled,
            network_tag: String(adPayload?.network_tag || ''),
          });
          if (adPayload?.placements?.interstitial && adPayload?.network_enabled) {
            setInterstitialVisible(true);
          }
        }
        if (trendsResp?.ok) {
          const trendsPayload = await trendsResp.json();
          setDailyTrends(trendsPayload);
        }
        if (breakingResp?.ok) {
          setBreakingLive(await breakingResp.json());
        }
        if (localResp?.ok) {
          setLocalYosla(await localResp.json());
        }
      } else {
        const raw = await response.text();
        console.error('Feed fetch failed:', response.status, raw);
        setFeedError(true);
        setPosts([]);
      }
    } catch (error) {
      console.error('Error fetching feed:', error);
      setFeedError(true);
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [followingOnly, hiddenPostIds, highlightPostId, token, user?.user_id, apiFetch]);

  useEffect(() => {
    if (!adConfig.placements.interstitial || !adConfig.network_enabled) {
      setInterstitialVisible(false);
    }
  }, [adConfig.placements.interstitial, adConfig.network_enabled]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  useEffect(() => {
    if (!token) return undefined;
    const intervalId = setInterval(() => {
      void fetchFeed();
    }, 15000);
    return () => clearInterval(intervalId);
  }, [fetchFeed, token]);

  useEffect(() => {
    if (highlightPostId && followingOnly) {
      setFollowingOnly(false);
    }
  }, [highlightPostId, followingOnly, setFollowingOnly]);

  useEffect(() => {
    if (!highlightPostId || !posts.some((post) => post.post_id === highlightPostId)) return;
    highlightPulse.setValue(0);
    highlightGlow.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(highlightPulse, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(highlightGlow, { toValue: 1, duration: 220, useNativeDriver: false }),
      ]),
      Animated.parallel([
        Animated.timing(highlightPulse, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(highlightGlow, { toValue: 0, duration: 220, useNativeDriver: false }),
      ]),
      Animated.parallel([
        Animated.timing(highlightPulse, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(highlightGlow, { toValue: 1, duration: 220, useNativeDriver: false }),
      ]),
    ]).start();
  }, [highlightPostId, posts, highlightPulse, highlightGlow]);

  const sendDwellEvent = useCallback(async (postId: string, dwellMs: number) => {
    if (!token || dwellMs < 3000) return;
    try {
      await apiFetch('/interactions/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_id: postId,
          dwell_ms: dwellMs,
        }),
      });
    } catch (error) {
      console.error('Error tracking dwell time:', error);
    }
  }, [apiFetch, token]);

  useEffect(() => {
    sendDwellEventRef.current = sendDwellEvent;
  }, [sendDwellEvent]);

  const flushVisibleDwell = useCallback(async () => {
    const now = Date.now();
    const payloads = buildDwellEvents(
      visiblePostIdsRef.current,
      new Set<string>(),
      activePostStartRef.current,
      now,
    ).events;
    visiblePostIdsRef.current.clear();
    for (const item of payloads) {
      await sendDwellEvent(item.postId, item.dwellMs);
      delete activePostStartRef.current[item.postId];
    }
  }, [sendDwellEvent]);

  useEffect(() => {
    flushVisibleDwellRef.current = flushVisibleDwell;
  }, [flushVisibleDwell]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { item: FeedItem; isViewable: boolean }[] }) => {
    const now = Date.now();
    const nextVisibleIds = getVisiblePostIds(viewableItems);
    const { events, nextActiveStarts } = buildDwellEvents(
      visiblePostIdsRef.current,
      nextVisibleIds,
      activePostStartRef.current,
      now,
    );
    visiblePostIdsRef.current = nextVisibleIds;
    activePostStartRef.current = nextActiveStarts;
    for (const event of events) {
      void sendDwellEventRef.current(event.postId, event.dwellMs);
    }
    if (dwellFlushTimerRef.current) {
      clearTimeout(dwellFlushTimerRef.current);
    }
    dwellFlushTimerRef.current = setTimeout(() => {
      void flushVisibleDwellRef.current();
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (dwellFlushTimerRef.current) {
        clearTimeout(dwellFlushTimerRef.current);
      }
      void flushVisibleDwellRef.current();
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFeed();
  }, [fetchFeed]);

  const feedItems: FeedItem[] = [];
  posts.forEach((post, index) => {
    feedItems.push({ type: 'post', post });
    const shouldInsertAd =
      adConfig.placements.in_feed &&
      adConfig.network_enabled &&
      (index + 1) % adConfig.frequency === 0;
    if (shouldInsertAd) {
      feedItems.push({
        type: 'ad',
        id: `ad_${post.post_id}_${index}`,
        label: adConfig.network_tag ? `${t('feedAdNetwork')} · ${adConfig.network_tag}` : t('feedAdNetwork'),
      });
    }
  });

  const toggleFollow = async (targetUserId: string) => {
    if (!targetUserId || targetUserId === user?.user_id) return;
    if (followLoadingByUserId[targetUserId]) return;
    setFollowLoadingByUserId((prev) => ({ ...prev, [targetUserId]: true }));
    try {
      const response = await apiFetch(`/users/${targetUserId}/follow`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Follow toggle failed (${response.status}): ${raw}`);
      }
      const payload = await response.json();
      if (typeof payload?.is_following === 'boolean') {
        setFollowingByUserId((prev) => ({ ...prev, [targetUserId]: payload.is_following }));
      }
      if (followingOnly && payload?.is_following === false) {
        setPosts((prev) => prev.filter((p) => p.user_id !== targetUserId));
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
      Alert.alert(t('error'), t('feedFollowingUpdateFailed'));
    } finally {
      setFollowLoadingByUserId((prev) => ({ ...prev, [targetUserId]: false }));
    }
  };

  const reportPost = async (postId: string, reason: 'inappropriate' | 'music_copyright' = 'inappropriate') => {
    try {
      const response = await apiFetch('/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_type: 'post',
          target_id: postId,
          reason,
          details: reason === 'music_copyright' ? 'Copyright/music report from feed' : 'Reported from feed',
        }),
      });
      if (!response || response.status === 401) return;
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Report failed (${response.status}): ${raw}`);
      }
      Alert.alert('YOSLA', reason === 'music_copyright' ? 'Tekijänoikeusilmoitus lähetetty.' : t('feedReportSent'));
    } catch (error) {
      console.error('Error reporting post:', error);
      Alert.alert(t('error'), t('feedReportFailed'));
    }
  };

  const toggleComments = (postId: string) => {
    setExpandedComments((prev) => ({ ...prev, [postId]: !prev[postId] }));
  };

  const submitComment = async (postId: string) => {
    const text = (commentInputs[postId] || '').trim();
    if (!text) return;
    if (commentLoadingByPost[postId]) return;

    setCommentLoadingByPost((prev) => ({ ...prev, [postId]: true }));
    try {
      const response = await apiFetch(`/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      if (!response || response.status === 401) return;

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Comment failed (${response.status}): ${raw}`);
      }

      const newComment: Comment = await response.json();

      setPosts((prevPosts) =>
        prevPosts.map((p) =>
          p.post_id === postId
            ? {
                ...p,
                comments: [...(p.comments || []), newComment],
                comments_count: (p.comments_count || 0) + 1,
              }
            : p
        )
      );

      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
      setExpandedComments((prev) => ({ ...prev, [postId]: true }));
    } catch (error) {
      console.error('Error creating comment:', error);
      Alert.alert(t('error'), t('feedCommentFailed'));
    } finally {
      setCommentLoadingByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const startEditComment = (postId: string, comment: Comment) => {
    setEditingCommentIdByPost((prev) => ({ ...prev, [postId]: comment.comment_id }));
    setEditingCommentTextById((prev) => ({ ...prev, [comment.comment_id]: comment.text }));
  };

  const cancelEditComment = (postId: string) => {
    setEditingCommentIdByPost((prev) => ({ ...prev, [postId]: null }));
  };

  const saveEditedComment = async (postId: string, commentId: string) => {
    const text = (editingCommentTextById[commentId] || '').trim();
    if (!text) return;
    if (commentLoadingByPost[postId]) return;

    setCommentLoadingByPost((prev) => ({ ...prev, [postId]: true }));
    try {
      const response = await apiFetch(`/posts/${postId}/comments/${commentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      if (!response || response.status === 401) return;

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Update comment failed (${response.status}): ${raw}`);
      }

      const updated: Comment = await response.json();
      setPosts((prevPosts) =>
        prevPosts.map((p) =>
          p.post_id === postId
            ? {
                ...p,
                comments: (p.comments || []).map((c) => (c.comment_id === commentId ? updated : c)),
              }
            : p
        )
      );
      setEditingCommentIdByPost((prev) => ({ ...prev, [postId]: null }));
    } catch (error) {
      console.error('Error updating comment:', error);
      Alert.alert(t('error'), t('feedCommentLoadFailed'));
    } finally {
      setCommentLoadingByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const deleteComment = async (postId: string, commentId: string) => {
    if (commentLoadingByPost[postId]) return;
    setCommentLoadingByPost((prev) => ({ ...prev, [postId]: true }));
    try {
      const response = await apiFetch(`/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE',
      });
      if (!response || response.status === 401) return;

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Delete comment failed (${response.status}): ${raw}`);
      }

      setPosts((prevPosts) =>
        prevPosts.map((p) =>
          p.post_id === postId
            ? {
                ...p,
                comments: (p.comments || []).filter((c) => c.comment_id !== commentId),
                comments_count: Math.max(0, (p.comments_count || 0) - 1),
              }
            : p
        )
      );
      setEditingCommentIdByPost((prev) => ({ ...prev, [postId]: null }));
    } catch (error) {
      console.error('Error deleting comment:', error);
      Alert.alert(t('error'), t('feedCommentDeleteFailed'));
    } finally {
      setCommentLoadingByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const confirmDeleteComment = (postId: string, commentId: string) => {
    Alert.alert(
      t('feedCommentDeleteTitle'),
      t('feedCommentDeleteBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('feedCommentDelete'),
          style: 'destructive',
          onPress: () => deleteComment(postId, commentId),
        },
      ]
    );
  };

  const openLiveHost = (host: typeof liveHosts[number]) => {
    router.push({
      pathname: '/live',
      params: { roomId: host.id, topic: host.topic },
    });
  };

  const openActiveLiveStream = (stream: ActiveLiveStream) => {
    router.push({
      pathname: '/live',
      params: { roomId: stream.roomId, topic: stream.topic },
    });
  };

  const openTrendingTopic = (title: string) => {
    router.push({
      pathname: '/search',
      params: { q: title },
    });
  };

  const openDiscoveryTarget = (target?: string) => {
    if (!target) return;
    router.push(target as never);
  };

  const handleSurpriseMe = async () => {
    if (surpriseLoading) return;
    setSurpriseLoading(true);
    try {
      const response = await apiFetch('/discovery/surprise-me');
      if (!response?.ok) throw new Error(response ? await response.text() : 'No response');
      const payload = await response.json();
      openDiscoveryTarget(payload?.target);
    } catch (error) {
      console.error('[phase2] surprise-me failed', error);
      Alert.alert(t('error'), 'Yllätysnostoa ei voitu avata juuri nyt.');
    } finally {
      setSurpriseLoading(false);
    }
  };

  const joinCommunity = (tag: string) => {
    setJoinedCommunityTags((current) => ({ ...current, [tag]: true }));
    Alert.alert('Yhteisö', `Liityit yhteisöön ${tag}`);
  };

  const renderLiveNowSection = () => (
    <View style={styles.liveNowSection}>
      <View style={[styles.sectionHeaderRow, isRTL && styles.rowReverse]}>
        <Text style={[styles.feedSectionTitle, styles.lightSectionTitle, isRTL && styles.textRight]}>LIVENÄ NYT</Text>
        <Text style={styles.livePulseText}>LIVE</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.liveScroller}>
        {liveHosts.map((host) => (
          <TouchableOpacity key={host.id} style={styles.liveHostCard} onPress={() => openLiveHost(host)}>
            <LinearGradient colors={['#FF0000', '#FF0055']} style={styles.liveAvatarGradient}>
              <View style={styles.liveAvatarRing}>
                <Text style={styles.liveAvatarInitial}>{host.avatar}</Text>
                <View style={styles.liveBadge}>
                  <Text style={styles.liveBadgeText}>LIVE</Text>
                </View>
              </View>
            </LinearGradient>
            <Text style={styles.liveHostName} numberOfLines={1}>{host.name}</Text>
            <Text style={styles.liveViewerCount}>{liveViewerCounts[host.id] ?? host.viewers} kats.</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderActiveLiveCard = () => {
    const stream = activeLiveStreams[0];
    if (!stream) return null;
    const profilePictureUri = stream.profilePicture?.startsWith('/uploads')
      ? `${BACKEND_BASE}${stream.profilePicture}`
      : stream.profilePicture || '';
    return (
      <TouchableOpacity
        style={styles.activeLiveCard}
        onPress={() => openActiveLiveStream(stream)}
        accessibilityRole="button"
        accessibilityLabel={`Avaa live-lähetys ${stream.username}`}
      >
        <LinearGradient colors={['#111827', '#020617']} style={styles.activeLiveGradient}>
          <View style={styles.activeLiveTopRow}>
            <View style={styles.activeLiveProfileRow}>
              {profilePictureUri ? (
                <Image source={{ uri: profilePictureUri }} style={styles.activeLiveAvatar} />
              ) : (
                <View style={styles.activeLiveAvatarFallback}>
                  <Text style={styles.activeLiveAvatarText}>{stream.username.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.activeLiveUsername} numberOfLines={1}>{stream.username}</Text>
                <Text style={styles.activeLiveTopic} numberOfLines={1}>{stream.topic}</Text>
              </View>
            </View>
            <View style={styles.activeLiveBadge}>
              <View style={styles.activeLivePulseDot} />
              <Text style={styles.activeLiveBadgeText}>🔴 LIVE</Text>
            </View>
          </View>
          <View style={styles.activeLiveBottomRow}>
            <Text style={styles.activeLiveTitle}>Live käynnissä nyt</Text>
            <Text style={styles.activeLiveCount}>{stream.count} katsojaa</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderPhase2Discovery = () => {
    const breaking = breakingLive?.top || activeLiveStreams.slice().sort((a, b) => (b.breakingScore || 0) - (a.breakingScore || 0))[0];
    const localTopic = localYosla?.topics?.[0] || '#suomi';
    const localCommunity = localYosla?.communities?.[0];
    return (
      <View style={[styles.phase2Grid, !isDesktop && styles.phase2GridMobile]}>
        <TouchableOpacity
          style={[styles.phase2Card, styles.breakingLiveCard]}
          onPress={() => breaking ? openActiveLiveStream(breaking) : liveSignalingSocket.emit('live:list-active', {})}
          accessibilityRole="button"
          accessibilityLabel="Avaa Breaking Live"
        >
          <View style={styles.phase2IconRow}>
            <View style={styles.phase2LiveDot} />
            <Text style={styles.phase2Kicker}>Breaking Live</Text>
          </View>
          <Text style={styles.phase2Title} numberOfLines={2}>
            {breaking ? `${breaking.topic} @${breaking.username}` : 'Ei aktiivista liveä juuri nyt'}
          </Text>
          <Text style={styles.phase2Meta}>
            {breaking ? `${breaking.count} katsojaa · score ${Math.round(breaking.breakingScore || 0)}` : 'Päivitetään reaaliajassa'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.phase2Card, styles.surpriseCard]}
          onPress={() => void handleSurpriseMe()}
          disabled={surpriseLoading}
          accessibilityRole="button"
          accessibilityLabel="Surprise Me"
        >
          <View style={styles.phase2IconRow}>
            <Ionicons name="shuffle" size={16} color="#0f172a" />
            <Text style={[styles.phase2Kicker, styles.phase2KickerDark]}>Surprise Me</Text>
          </View>
          <Text style={[styles.phase2Title, styles.phase2TitleDark]}>Vie minut johonkin kiinnostavaan</Text>
          <Text style={[styles.phase2Meta, styles.phase2MetaDark]}>{surpriseLoading ? 'Haetaan...' : 'Live, replay, trendi tai yhteisö'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.phase2Card, styles.localCard]}
          onPress={() => router.push({ pathname: '/search', params: { q: localTopic } })}
          accessibilityRole="button"
          accessibilityLabel="Avaa Local YOSLA"
        >
          <View style={styles.phase2IconRow}>
            <Ionicons name="location" size={16} color="#dcfce7" />
            <Text style={styles.phase2Kicker}>Local YOSLA</Text>
          </View>
          <Text style={styles.phase2Title}>{localCommunity?.tag || localTopic}</Text>
          <Text style={styles.phase2Meta}>{localCommunity ? `${localCommunity.members} paikallista signaalia` : 'Suomi ja lähiyhteisöt'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderDailyQuestion = (embedded = false) => {
    return (
      <View style={[styles.dailyQuestionCard, embedded && styles.embeddedMatrixCard]}>
        <View style={[styles.sectionHeaderRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.feedSectionTitle, styles.lightSectionTitle, isRTL && styles.textRight]}>Päivän kysymys</Text>
          <Ionicons name="flash" size={18} color="#facc15" />
        </View>
        <Text style={[styles.dailyQuestionText, isRTL && styles.textRight]}>Poistaisitko TikTokin jos saisit 1000 €?</Text>
        <View style={[styles.dailyVoteRow, isRTL && styles.rowReverse]}>
          <TouchableOpacity
            style={[styles.dailyVoteButton, dailyVote === 'yes' && styles.dailyVoteButtonActive]}
            onPress={() => setDailyVote('yes')}
          >
            <Text style={styles.dailyVoteText}>Kyllä</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dailyVoteButton, dailyVote === 'no' && styles.dailyVoteButtonActive]}
            onPress={() => setDailyVote('no')}
          >
            <Text style={styles.dailyVoteText}>En</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.pollFooterRow}>
          <Text style={styles.dailyVoteMeta}>1 234 ääntä</Text>
          <Text style={styles.pollResultsLink}>Äänestä ja näe tulokset</Text>
        </View>
      </View>
    );
  };

  const renderWeeklyChallenge = (embedded = false) => (
    <View style={[styles.challengeCard, embedded && styles.embeddedMatrixCard]}>
      <View style={styles.challengeTopRow}>
        <View style={styles.challengeIconWrap}>
          <Ionicons name="leaf" size={20} color="#fff" />
        </View>
        <Text style={[styles.challengeKicker, isRTL && styles.textRight]}>Viikon yhteisöhaaste</Text>
      </View>
      <Text style={[styles.challengeTitle, isRTL && styles.textRight]}>Tämän viikon teema on #Luonto - jaa paras kuvasi tai videosi!</Text>
      <View style={styles.challengeBottomRow}>
        <View style={styles.participantStack}>
          {['MI', 'SA', 'TO'].map((initials, index) => (
            <View key={initials} style={[styles.participantAvatar, { marginLeft: index === 0 ? 0 : -10 }]}>
              <Text style={styles.participantAvatarText}>{initials}</Text>
            </View>
          ))}
          <View style={[styles.participantAvatar, styles.participantMore, { marginLeft: -10 }]}>
            <Text style={styles.participantAvatarText}>+128</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.challengeActionButton}>
          <Text style={styles.challengeActionText}>Osallistu haasteeseen</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTrendingNow = () => (
    <View style={styles.trendingSection}>
      <View style={[styles.sectionHeaderRow, isRTL && styles.rowReverse]}>
        <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>DAILY TRENDS</Text>
        <Ionicons name="trending-up" size={18} color="#ef4444" />
      </View>
      <View style={[styles.trendingGrid, !isDesktop && styles.mobileTrendingGrid]}>
        {(dailyTrends?.posts?.length ? dailyTrends.posts.slice(0, 4).map((trend, index) => ({
          rank: `#${index + 1}`,
          tone: index === 0 ? 'crimson' : index === 1 ? 'indigo' : index === 2 ? 'blue' : 'green',
          label: trend.type === 'live_recording' || trend.type === 'live_replay' ? 'LIVE REPLAY' : 'TRENDING',
          title: trend.title,
          meta: `${trend.comments_count} kommenttia`,
          signal: `Score ${trend.score}`,
          icon: (index === 0 ? 'flame' : index === 1 ? 'sparkles' : index === 2 ? 'rocket' : 'chatbubble-ellipses') as keyof typeof Ionicons.glyphMap,
          postId: trend.post_id,
        })) : matrixTrendingCards).map((card) => (
          <TouchableOpacity
            key={card.rank}
            style={[styles.trendingCard, !isDesktop && styles.mobileTrendingCard, getMatrixToneStyle(card.tone as MatrixTone)]}
            onPress={() => 'postId' in card ? router.push(`/posts/${card.postId}`) : openTrendingTopic(card.title)}
          >
            <View style={styles.trendingCardTop}>
              <Text style={styles.trendingRank}>{card.rank}</Text>
              <Ionicons name={card.icon} size={17} color="#fff" />
            </View>
            <Text style={styles.trendingBadge}>{card.label}</Text>
            <Text style={styles.trendingTitle}>{card.title}</Text>
            <Text style={styles.trendingMeta}>{card.meta} / {card.signal}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderEngagementWidgets = () => (
    <View style={[styles.engagementGrid, !isDesktop && styles.mobileEngagementGrid]}>
      {renderDailyQuestion(true)}
      {renderWeeklyChallenge(true)}
    </View>
  );

  const renderUpcomingStreams = () => (
    <View style={styles.upcomingPanel}>
      <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>TULEVAT LÄHETYKSET</Text>
      {upcomingBroadcasts.map((item) => (
        <View key={`${item.time}-${item.title}`} style={styles.streamRow}>
          <Text style={styles.streamTime}>{item.time}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.streamTitle}>{item.title}</Text>
            <Text style={styles.streamHost}>{item.host}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderPopularCommunities = () => (
    <View style={styles.sidebarPanel}>
      <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>SUOSITUT YHTEISÖT</Text>
      {popularCommunities.map((community) => {
        const isJoined = !!joinedCommunityTags[community.tag];
        return (
          <TouchableOpacity
            key={community.tag}
            style={styles.communityRow}
            onPress={() => openTrendingTopic(community.tag)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.communityTag}>{community.tag}</Text>
              <Text style={styles.communityMembers}>{community.members} jäsentä</Text>
            </View>
            <TouchableOpacity
              style={[styles.joinButton, isJoined && styles.joinButtonJoined]}
              onPress={(event) => {
                event.stopPropagation();
                if (!isJoined) joinCommunity(community.tag);
              }}
            >
              <Text style={[styles.joinButtonText, isJoined && styles.joinButtonTextJoined]}>
                {isJoined ? 'Liitytty' : 'Liity'}
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderAchievementsPanel = () => (
    <View style={styles.sidebarPanel}>
      <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>SAAVUTUKSET</Text>
      {globalAchievements.map((badge) => (
        <View key={badge.title} style={styles.globalBadgeRow}>
          <View style={styles.globalBadgeIcon}>
            <Ionicons name={badge.icon} size={16} color="#0066FF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.globalBadgeTitle}>{badge.title}</Text>
            <Text style={styles.globalBadgeValue}>{badge.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderCommentNode = (comment: CommentNode, postId: string, depth = 0): React.ReactNode => {
    const isOwnComment = user?.user_id === comment.user_id;
    const isEditing = editingCommentIdByPost[postId] === comment.comment_id;
    const isOnline = Boolean((comment as { is_online?: boolean }).is_online);
    return (
      <View key={comment.comment_id} style={[styles.commentRow, depth > 0 && styles.commentReplyRow, { marginLeft: Math.min(depth, 3) * 16 }]}>
        <View style={[styles.commentTopRow, isRTL && styles.rowReverse]}>
          <View style={styles.commentAuthorWrap}>
            <Text style={[styles.commentAuthor, isRTL && styles.textRight]}>{comment.username}</Text>
            {isOnline ? <View style={styles.commentPresenceDot} /> : null}
          </View>
          {isOwnComment && !isEditing && (
            <View style={[styles.commentActionRow, isRTL && styles.rowReverse]}>
              <TouchableOpacity onPress={() => startEditComment(postId, comment)}>
                <Text style={styles.commentActionText}>{t('feedCommentEdit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDeleteComment(postId, comment.comment_id)}>
                <Text style={[styles.commentActionText, styles.commentDeleteText]}>{t('feedCommentDelete')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {isEditing ? (
          <View style={[styles.commentEditRow, isRTL && styles.rowReverse]}>
            <TextInput
              style={styles.commentEditInput}
              value={editingCommentTextById[comment.comment_id] || ''}
              onChangeText={(value) =>
                setEditingCommentTextById((prev) => ({ ...prev, [comment.comment_id]: value }))
              }
              editable={!commentLoadingByPost[postId]}
            />
            <TouchableOpacity onPress={() => saveEditedComment(postId, comment.comment_id)}>
              <Text style={styles.commentSaveText}>{t('feedCommentSave')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => cancelEditComment(postId)}>
              <Text style={styles.commentCancelText}>{t('feedCommentCancel')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.commentText, isRTL && styles.textRight]}>{comment.text}</Text>
        )}
        {comment.replies.map((reply) => renderCommentNode(reply, postId, depth + 1))}
      </View>
    );
  };

  const renderPost = ({ item }: { item: LocalPost }) => {
    const isHighlighted = highlightPostId === item.post_id;
    const postBadge = getPostBadge(item.comments_count || 0);
    const currentReaction = reactionByPost[item.post_id] || item.user_reaction;
    const reactionCounts = reactionCountsByPost[item.post_id] || item.reaction_counts || {};
    const isSaved = savedByPost[item.post_id] ?? !!item.is_bookmarked;
    const poll = item.poll;
    const isLiveReplay = isLiveReplayPost(item);
    return (
    <Animated.View
      style={[
        styles.postCard,
        isHighlighted && styles.highlightedPostCard,
        isHighlighted && {
          shadowColor: '#007AFF',
          shadowOpacity: highlightGlow.interpolate({
            inputRange: [0, 1],
            outputRange: [0.15, 0.4],
          }),
          shadowRadius: highlightGlow.interpolate({
            inputRange: [0, 1],
            outputRange: [4, 14],
          }),
          shadowOffset: { width: 0, height: 0 },
          elevation: highlightGlow.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 6],
          }),
        },
      ]}
    >
      <View style={[styles.postHeader, isRTL && styles.rowReverse]}>
        <View style={[styles.userInfo, isRTL && styles.rowReverse]}>
          <View style={styles.avatarWrap}>
            {item.profile_picture ? (
              <Image
                source={{ uri: resolveMediaUrl(item.profile_picture) }}
                style={[styles.avatar, (item as { is_online?: boolean }).is_online ? styles.avatarOnline : null]}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder, (item as { is_online?: boolean }).is_online ? styles.avatarOnline : null]}>
                <Ionicons name="person" size={24} color="#fff" />
              </View>
            )}
            {(item as { is_online?: boolean }).is_online ? <View style={styles.avatarHalo} /> : null}
          </View>
          <View>
            <Text style={styles.username}>{item.username}</Text>
            <Text style={styles.timestamp}>
              {formatRelativeTime(item.created_at) || formatLocalDate(item.created_at)}
            </Text>
          </View>
        </View>
        {highlightPostId === item.post_id && (
          <Animated.View
            style={[
              styles.notificationBadge,
              {
                opacity: highlightPulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.75, 1],
                }),
                transform: [
                  {
                    scale: highlightPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.06],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.notificationBadgeText}>{t('feedNotified')}</Text>
          </Animated.View>
        )}
        <View style={[styles.headerActions, isRTL && styles.rowReverse]}>
          <PostActionsButton
            post={item}
            currentUserId={user?.user_id}
            compact
            onEdit={editPostFromMenu}
            onDelete={deletePostFromMenu}
            onHide={(post) => deletePostFromFeed(post.post_id)}
            onReport={(post, reason) => void reportPost(post.post_id, reason)}
          />
          {item.user_id !== user?.user_id && (
            <TouchableOpacity
              style={[
                styles.followButton,
                followingByUserId[item.user_id] && styles.followingButton,
              ]}
              onPress={() => toggleFollow(item.user_id)}
              disabled={followLoadingByUserId[item.user_id]}
            >
              {followLoadingByUserId[item.user_id] ? (
                <ActivityIndicator size="small" color="#007AFF" />
              ) : (
                <Text
                  style={[
                    styles.followButtonText,
                    followingByUserId[item.user_id] && styles.followingButtonText,
                  ]}
                >
                  {followingByUserId[item.user_id] ? t('feedFollowingNow') : t('feedFollow')}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={[styles.postText, isRTL && styles.textRight]}>{item.text}</Text>
      {item.moderation_status ? (
        <View style={styles.moderationBadge}>
          <Text style={styles.moderationBadgeText}>
            {item.moderation_status === 'queued' ? t('moderationQueued') : item.moderation_status}
          </Text>
        </View>
      ) : null}
      {postBadge ? (
        <View style={[styles.hotPostBadge, styles[`hotBadge_${postBadge.tone}`]]}>
          <Text style={styles.hotPostBadgeText}>{postBadge.icon} {postBadge.label}</Text>
        </View>
      ) : null}
      {item.music_risk && item.music_risk !== 'none' ? (
        <View style={styles.musicWarningStrip}>
          <Ionicons name="musical-notes-outline" size={14} color="#92400e" />
          <Text style={styles.musicWarningText}>
            Musiikkivaroitus: sisältö voi sisältää tekijänoikeuksilla suojattua ääntä.
          </Text>
        </View>
      ) : null}
      {isLiveReplay ? (
        <View style={styles.liveReplayStrip}>
          <Text style={styles.liveReplayBadge}>🔴 LIVE REPLAY</Text>
          <Text style={styles.liveReplayMeta}>{formatReplayDuration(item.duration)} · {formatReplayDate(item.created_at)}</Text>
          <Text style={styles.liveReplayMeta}>👁 {formatCompactCount(item.views)} · ❤️ {formatCompactCount(item.likes_count)} · 💬 {formatCompactCount(item.comments_count)} · 🔁 {formatCompactCount(item.replay_count)}</Text>
        </View>
      ) : null}
      {poll ? (
        <View style={styles.pollCard}>
          <Text style={styles.pollTitle}>{poll.question}</Text>
          {poll.options.map((option) => {
            const percentage = poll.total_votes > 0 ? Math.round(((option.votes_count || 0) / poll.total_votes) * 100) : 0;
            const selected = poll.user_vote === option.option_id;
            return (
            <TouchableOpacity
              key={option.option_id}
              style={[styles.pollOption, selected && styles.pollOptionSelected]}
              onPress={() => void votePollOption(item, option.option_id)}
            >
              <View style={[styles.pollFill, { width: `${percentage}%` }]} />
              <Text style={styles.pollOptionText}>{option.text}</Text>
              <Text style={styles.pollPercent}>{percentage}%</Text>
            </TouchableOpacity>
            );
          })}
          <Text style={styles.pollVotesText}>{poll.total_votes} ääntä</Text>
        </View>
      ) : null}

      {item.video && isVideoUrl(item.video) ? (
        <View style={styles.postVideoWrap}>
          {Platform.OS === 'web' ? (
            React.createElement('video', {
              src: resolveMediaUrl(item.video),
              controls: true,
              muted: true,
              playsInline: true,
              poster: resolveMediaUrl(item.image),
              ...buildVideoDebugProps(item.post_id, resolveMediaUrl(item.video)),
              style: {
                width: 'auto',
                maxWidth: '100%',
                height: 'auto',
                maxHeight: 400,
                display: 'block',
                objectFit: 'contain',
                backgroundColor: 'transparent',
                borderRadius: 8,
              },
            })
          ) : (
            <NativeFeedVideo uri={resolveMediaUrl(item.video) || item.video} />
          )}
        </View>
      ) : item.image ? (
        <View style={styles.postImageWrap}>
          <Image
            source={{ uri: resolveMediaUrl(item.image) }}
            style={[
              styles.postImage,
              imageAspectByPostId[item.post_id]
                ? { aspectRatio: imageAspectByPostId[item.post_id] }
                : styles.postImageFallback,
            ]}
            onLoad={(event) => {
              const sourceSize = event.nativeEvent?.source;
              const target = (event.nativeEvent as unknown as { target?: { naturalWidth?: number; naturalHeight?: number } })?.target;
              const width = sourceSize?.width || target?.naturalWidth;
              const height = sourceSize?.height || target?.naturalHeight;
              if (!width || !height) return;
              const aspectRatio = width / height;
              setImageAspectByPostId((prev) =>
                prev[item.post_id] === aspectRatio
                  ? prev
                  : { ...prev, [item.post_id]: aspectRatio }
              );
            }}
            resizeMode="contain"
          />
        </View>
      ) : null}

      <View style={[styles.postActions, isRTL && styles.rowReverse]}>
        <View style={[styles.reactionGroup, isRTL && styles.rowReverse]}>
          {reactionOptions.map((reaction) => (
            <TouchableOpacity
              key={reaction.key}
              style={[
                styles.reactionButton,
                currentReaction === reaction.key && styles.reactionButtonActive,
              ]}
              onPress={() => handleReaction(item, reaction.key)}
              disabled={likeLoadingByPost[item.post_id]}
            >
              <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
              <Text style={styles.reactionLabel}>{reaction.label}</Text>
              <Text style={styles.reactionCount}>{reactionCounts[reaction.key] || 0}</Text>
            </TouchableOpacity>
          ))}
          <Text style={[styles.actionText, isRTL && styles.actionTextRTL]}>{item.likes_count}</Text>
        </View>

        <TouchableOpacity
          style={[styles.actionButton, isRTL && styles.actionButtonRTL]}
          onPress={() => toggleComments(item.post_id)}
        >
          <Ionicons name="chatbubble-outline" size={22} color="#666" />
          <Text style={[styles.actionText, isRTL && styles.actionTextRTL]}>{item.comments_count || 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, isRTL && styles.actionButtonRTL]}
          onPress={() => handleRepost(item)}
          disabled={repostLoadingByPost[item.post_id]}
        >
          {repostLoadingByPost[item.post_id] ? (
            <ActivityIndicator size="small" color="#666" />
          ) : (
            <Ionicons name="repeat" size={22} color={item.repost_post_id ? '#0F62FE' : '#666'} />
          )}
          <Text style={[styles.actionText, isRTL && styles.actionTextRTL]}>{item.repost_count || 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, isRTL && styles.actionButtonRTL]}
          onPress={() => void toggleSavePost(item)}
        >
          <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={21} color={isSaved ? '#0F62FE' : '#666'} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, isRTL && styles.actionButtonRTL]}
          onPress={() => void shareActionPost(item)}
        >
          <Ionicons name="share-social-outline" size={21} color="#666" />
        </TouchableOpacity>
      </View>

      {expandedComments[item.post_id] && (
        <View style={styles.commentsContainer}>
          {(item.comments || []).length > 0 ? (
            buildCommentTree(item.comments || []).map((comment) => renderCommentNode(comment, item.post_id))
          ) : (
            <Text style={styles.noCommentsText}>{t('feedNoComments')}</Text>
          )}

          <View style={[styles.commentInputRow, isRTL && styles.rowReverse]}>
            <TextInput
              style={styles.commentInput}
              placeholder={t('feedWriteComment')}
              value={commentInputs[item.post_id] || ''}
              onChangeText={(value) =>
                setCommentInputs((prev) => ({ ...prev, [item.post_id]: value }))
              }
              editable={!commentLoadingByPost[item.post_id]}
            />
            <TouchableOpacity
              style={[styles.sendButton, isRTL && styles.sendButtonRTL]}
              onPress={() => submitComment(item.post_id)}
              disabled={commentLoadingByPost[item.post_id]}
            >
              {commentLoadingByPost[item.post_id] ? (
                <ActivityIndicator size="small" color="#007AFF" />
              ) : (
                <Ionicons name="send" size={20} color="#007AFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Animated.View>
  );
  };

  const renderFeedItem = ({ item }: { item: FeedItem }) => {
    if (item.type === 'ad') {
      return (
        <View style={styles.adCard}>
          <Text style={[styles.adLabel, isRTL && styles.textRight]}>{item.label}</Text>
          <Text style={[styles.adText, isRTL && styles.textRight]}>{t('feedSponsoredContent')}</Text>
        </View>
      );
    }
    return renderPost({ item: item.post });
  };

  const renderMobileTopHeader = () => (
    <View style={styles.mobileTopHeader}>
      <Text style={styles.mobileBrandText}>YOSLA</Text>
      <View style={[styles.mobileHeaderActions, isRTL && styles.rowReverse]}>
        <TouchableOpacity style={styles.mobileHeaderIcon} accessibilityRole="button" accessibilityLabel={t('search')}>
          <Ionicons name="search" size={20} color="#0F172A" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mobileHeaderIcon} accessibilityRole="button" accessibilityLabel={t('messages')}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#0F172A" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderIntroStack = () => (
    <>
      <View style={styles.feedFilterRow}>
        <TouchableOpacity
          style={[styles.feedFilterButton, !followingOnly && styles.feedFilterButtonActive]}
          onPress={() => setFollowingOnly(false)}
        >
          <Text style={[styles.feedFilterText, !followingOnly && styles.feedFilterTextActive]}>{t('feedAll')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.feedFilterButton, followingOnly && styles.feedFilterButtonActive]}
          onPress={() => setFollowingOnly(true)}
        >
          <Text style={[styles.feedFilterText, followingOnly && styles.feedFilterTextActive]}>{t('feedFollowing')}</Text>
        </TouchableOpacity>
      </View>
      {adConfig.placements.sidebar && isDesktop ? (
        <View style={styles.sidebarAd}>
          <Text style={[styles.adLabel, isRTL && styles.textRight]}>{t('feedAdNetwork')}</Text>
          <Text style={[styles.adText, isRTL && styles.textRight]}>{t('feedInterstitialActive')}</Text>
        </View>
      ) : null}
      <View style={[styles.personaBanner, isNewUser ? styles.personaBannerExplore : styles.personaBannerPersonal]}>
        <Text style={[styles.personaEyebrow, isRTL && styles.textRight]}>
          {isNewUser ? t('feedExploreModeLabel') : t('feedPersonalModeLabel')}
        </Text>
        <Text style={[styles.personaTitle, isRTL && styles.textRight]}>
          {isNewUser ? t('feedExploreModeTitle') : t('feedPersonalModeTitle')}
        </Text>
        <Text style={[styles.personaBody, isRTL && styles.textRight]}>
          {isNewUser ? t('feedExploreModeBody') : t('feedPersonalModeBody')}
        </Text>
      </View>
      {isNewUser ? (
        <View style={styles.onboardingCard}>
          <Text style={styles.onboardingEyebrow}>{t('onboardingLabel')}</Text>
          <Text style={styles.onboardingTitle}>{t('onboardingTitle')}</Text>
          <View style={styles.onboardingList}>
            <View style={[styles.onboardingRow, isRTL && styles.rowReverse]}>
              <Ionicons name="people-outline" size={16} color="#007AFF" />
              <Text style={[styles.onboardingItem, isRTL && styles.textRight]}>{t('onboardingStepFollow')}</Text>
            </View>
            <View style={[styles.onboardingRow, isRTL && styles.rowReverse]}>
              <Ionicons name="create-outline" size={16} color="#007AFF" />
              <Text style={[styles.onboardingItem, isRTL && styles.textRight]}>{t('onboardingStepPost')}</Text>
            </View>
            <View style={[styles.onboardingRow, isRTL && styles.rowReverse]}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color="#007AFF" />
              <Text style={[styles.onboardingItem, isRTL && styles.textRight]}>{t('onboardingStepReact')}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {interstitialVisible ? (
        <View style={styles.interstitialOverlay}>
          <View style={styles.interstitialCard}>
            <Text style={[styles.interstitialLabel, isRTL && styles.textRight]}>{t('feedInterstitial')}</Text>
            <Text style={styles.interstitialTitle}>
              {adConfig.network_tag ? `${t('feedAdNetwork')} · ${adConfig.network_tag}` : t('feedAdNetwork')}
            </Text>
            <Text style={[styles.interstitialText, isRTL && styles.textRight]}>{t('feedInterstitialActive')}</Text>
            <TouchableOpacity style={styles.interstitialCloseButton} onPress={() => setInterstitialVisible(false)}>
              <Text style={styles.interstitialCloseText}>{t('feedCloseAd')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {isDesktop ? (
        <View style={styles.desktopDashboard}>
          <FlatList
            style={styles.centerFeed}
            data={feedItems}
            renderItem={renderFeedItem}
            keyExtractor={(item) => item.type === 'post' ? item.post.post_id : item.id}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 300 }}
            onViewableItemsChanged={onViewableItemsChanged}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={
              <>
                {renderActiveLiveCard()}
                {renderPhase2Discovery()}
                {renderLiveNowSection()}
                {renderTrendingNow()}
                {renderEngagementWidgets()}
                {renderIntroStack()}
              </>
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name={feedError ? 'cloud-offline-outline' : 'paper-plane-outline'} size={64} color="#fb7185" />
                <Text style={styles.emptyText}>{feedError ? t('feedLoadFailed') : t('feedNoPosts')}</Text>
                <Text style={styles.emptySubtext}>{feedError ? t('feedLoadFailedBody') : t('feedCreateFirstPost')}</Text>
              </View>
            }
          />
          <ScrollView style={styles.rightRail} contentContainerStyle={styles.railContent}>
            {renderUpcomingStreams()}
            {renderPopularCommunities()}
            {renderAchievementsPanel()}
          </ScrollView>
        </View>
      ) : (
        <FlatList
          data={feedItems}
          renderItem={renderFeedItem}
          keyExtractor={(item) => item.type === 'post' ? item.post.post_id : item.id}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 300 }}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <>
              {renderMobileTopHeader()}
              {renderActiveLiveCard()}
              {renderPhase2Discovery()}
              {renderLiveNowSection()}
              {renderTrendingNow()}
              {renderDailyQuestion()}
              {renderWeeklyChallenge()}
              {renderIntroStack()}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name={feedError ? 'cloud-offline-outline' : 'paper-plane-outline'} size={64} color="#fb7185" />
              <Text style={styles.emptyText}>{feedError ? t('feedLoadFailed') : t('feedNoPosts')}</Text>
              <Text style={styles.emptySubtext}>{feedError ? t('feedLoadFailedBody') : t('feedCreateFirstPost')}</Text>
              {feedError ? (
                <TouchableOpacity style={styles.emptyRetryButton} onPress={() => void fetchFeed()}>
                  <Text style={styles.emptyRetryText}>{t('retry')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          contentContainerStyle={posts.length === 0 ? styles.emptyList : styles.mobileFeedContent}
        />
      )}
    </View>
  );
}

export default FeedScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FB',
  },
  desktopDashboard: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
    padding: 18,
    backgroundColor: '#F5F7FB',
    justifyContent: 'center',
  },
  rightRail: {
    width: 300,
    flexShrink: 0,
  },
  centerFeed: {
    flex: 1,
    minWidth: 0,
    maxWidth: 700,
  },
  railContent: {
    gap: 12,
    paddingBottom: 24,
  },
  mobileFeedContent: {
    paddingBottom: 18,
  },
  mobileTopHeader: {
    minHeight: 58,
    marginHorizontal: 12,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileBrandText: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
  },
  mobileHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mobileHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5EAF2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveNowSection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5EAF2',
    borderRadius: 8,
    paddingTop: 14,
    paddingBottom: 12,
    marginHorizontal: 12,
    marginTop: 12,
    shadowColor: '#FF0055',
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
  activeLiveCard: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#dc2626',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 4,
  },
  activeLiveGradient: {
    padding: 14,
    gap: 16,
  },
  activeLiveTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  activeLiveProfileRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activeLiveAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1e293b',
  },
  activeLiveAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1d4ed8',
  },
  activeLiveAvatarText: {
    color: '#fff',
    fontWeight: '900',
  },
  activeLiveUsername: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  activeLiveTopic: {
    marginTop: 2,
    color: '#93c5fd',
    fontSize: 13,
    fontWeight: '800',
  },
  activeLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(220, 38, 38, 0.18)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  activeLivePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  activeLiveBadgeText: {
    color: '#fecaca',
    fontSize: 11,
    fontWeight: '900',
  },
  activeLiveBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  activeLiveTitle: {
    color: '#e2e8f0',
    fontSize: 20,
    fontWeight: '900',
  },
  activeLiveCount: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '900',
  },
  phase2Grid: {
    marginHorizontal: 12,
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  phase2GridMobile: {
    flexDirection: 'column',
  },
  phase2Card: {
    flex: 1,
    minHeight: 116,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    justifyContent: 'space-between',
    gap: 10,
  },
  breakingLiveCard: {
    backgroundColor: '#111827',
    borderColor: '#ef4444',
  },
  surpriseCard: {
    backgroundColor: '#facc15',
    borderColor: '#eab308',
  },
  localCard: {
    backgroundColor: '#064e3b',
    borderColor: '#10b981',
  },
  phase2IconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phase2LiveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  phase2Kicker: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  phase2KickerDark: {
    color: '#0f172a',
  },
  phase2Title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
  },
  phase2TitleDark: {
    color: '#0f172a',
  },
  phase2Meta: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
  },
  phase2MetaDark: {
    color: '#334155',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 10,
  },
  feedSectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#111827',
  },
  lightSectionTitle: {
    color: '#0F172A',
  },
  livePulseText: {
    color: '#fff',
    backgroundColor: '#FF0055',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '900',
  },
  liveScroller: {
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 16,
  },
  liveHostCard: {
    width: 82,
    alignItems: 'center',
    gap: 6,
  },
  liveAvatarGradient: {
    width: 66,
    height: 66,
    borderRadius: 33,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF0055',
    shadowOpacity: 0.38,
    shadowRadius: 14,
  },
  liveAvatarRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F5F7FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveAvatarInitial: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
  },
  liveBadge: {
    position: 'absolute',
    bottom: -7,
    alignSelf: 'center',
    borderRadius: 3,
    backgroundColor: '#FF0000',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },
  liveHostName: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 78,
  },
  liveViewerCount: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '900',
  },
  dailyQuestionCard: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8B4FE',
    backgroundColor: '#8A2BE2',
    paddingVertical: 16,
    flex: 1,
  },
  dailyQuestionText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 26,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  dailyVoteRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  dailyVoteButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  dailyVoteButtonActive: {
    borderColor: '#facc15',
    backgroundColor: 'rgba(250,204,21,0.16)',
  },
  dailyVoteText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  dailyVoteMeta: {
    color: '#ddd6fe',
    fontSize: 12,
    fontWeight: '800',
  },
  pollFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  pollResultsLink: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  challengeCard: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6600',
    backgroundColor: '#FF6600',
    padding: 16,
    gap: 12,
    flex: 1,
  },
  challengeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  challengeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FF6600',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeKicker: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  challengeTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  challengeBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  participantStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  participantAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantMore: {
    width: 46,
    backgroundColor: '#FF6600',
  },
  participantAvatarText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  challengeActionButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeActionText: {
    color: '#FF6600',
    fontSize: 13,
    fontWeight: '900',
  },
  trendingSection: {
    marginTop: 12,
    marginHorizontal: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
  },
  trendingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 12,
  },
  mobileTrendingGrid: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
  },
  trendingCard: {
    flex: 1,
    flexBasis: 180,
    minWidth: 170,
    minHeight: 150,
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  mobileTrendingCard: {
    flexBasis: undefined,
    minWidth: 0,
    width: '100%',
  },
  trendingCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trendingRank: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  trendingBadge: {
    fontSize: 12,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.88)',
  },
  trendingTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
  },
  trendingMeta: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 'auto',
  },
  matrix_crimson: { backgroundColor: '#FF0055' },
  matrix_indigo: { backgroundColor: '#8A2BE2' },
  matrix_blue: { backgroundColor: '#0066FF' },
  matrix_green: { backgroundColor: '#047857' },
  engagementGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
    marginHorizontal: 12,
    marginTop: 12,
  },
  mobileEngagementGrid: {
    flexDirection: 'column',
  },
  embeddedMatrixCard: {
    marginHorizontal: 0,
    marginTop: 0,
  },
  hotBadge_phenomenon: {
    backgroundColor: '#ecfccb',
    borderColor: '#a3e635',
  },
  hotBadge_comet: {
    backgroundColor: '#eef2ff',
    borderColor: '#8b5cf6',
  },
  hotBadge_hot: {
    backgroundColor: '#ffedd5',
    borderColor: '#f97316',
  },
  hotBadge_rising: {
    backgroundColor: '#fefce8',
    borderColor: '#facc15',
  },
  gamificationPanel: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#eff6ff',
    paddingVertical: 12,
  },
  phenomenaPanel: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#bef264',
    backgroundColor: '#f7fee7',
    padding: 14,
    gap: 10,
  },
  phenomenonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d9f99d',
    padding: 10,
  },
  phenomenonRank: {
    color: '#3f6212',
    fontSize: 12,
    fontWeight: '900',
  },
  phenomenonTag: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
  },
  phenomenonMeta: {
    color: '#4d7c0f',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 1,
  },
  upcomingPanel: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E2F0',
    backgroundColor: '#fff',
    padding: 14,
    gap: 12,
  },
  streamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 11,
  },
  streamTime: {
    color: '#fff',
    backgroundColor: '#0F62FE',
    borderRadius: 6,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '900',
    minWidth: 78,
    textAlign: 'center',
    paddingVertical: 5,
  },
  streamTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '900',
  },
  streamHost: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  sidebarPanel: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8E2F0',
    backgroundColor: '#fff',
    padding: 14,
    gap: 12,
  },
  communityRow: {
    alignItems: 'stretch',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
    paddingBottom: 10,
  },
  communityTag: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '900',
  },
  communityMembers: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  joinButton: {
    borderRadius: 8,
    backgroundColor: '#0066FF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonJoined: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#7DD3FC',
  },
  joinButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  joinButtonTextJoined: {
    color: '#075985',
  },
  globalBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
  },
  globalBadgeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  globalBadgeTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '900',
  },
  globalBadgeValue: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pointsBadgeText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '900',
  },
  streakRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  streakPill: {
    minWidth: 86,
    borderRadius: 14,
    backgroundColor: '#111827',
    padding: 10,
    alignItems: 'center',
  },
  streakValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  streakLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
  },
  achievementBadge: {
    flexGrow: 1,
    minWidth: 145,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    padding: 10,
  },
  achievementTitle: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '900',
  },
  achievementValue: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  liveModal: {
    flex: 1,
    backgroundColor: '#050816',
    padding: 16,
    gap: 14,
  },
  liveVideoShell: {
    flex: 1,
    minHeight: 340,
    borderRadius: 22,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  liveModalBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    color: '#fff',
    backgroundColor: '#ef4444',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '900',
  },
  liveModalTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 12,
  },
  liveModalTopic: {
    color: '#cbd5e1',
    fontSize: 14,
    marginTop: 4,
  },
  floatingReactionOne: {
    position: 'absolute',
    right: 26,
    bottom: 70,
  },
  floatingReactionTwo: {
    position: 'absolute',
    right: 72,
    bottom: 130,
  },
  floatingReactionText: {
    fontSize: 34,
  },
  liveOverlayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  liveChatPanel: {
    flex: 1,
    minWidth: 230,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    gap: 8,
  },
  liveSidePanel: {
    flex: 1,
    minWidth: 230,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    gap: 8,
  },
  livePanelTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  liveChatLine: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  guestModeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    padding: 10,
    marginTop: 4,
  },
  guestModeText: {
    color: '#fff',
    fontWeight: '900',
  },
  liveExitButton: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  liveExitText: {
    color: '#111827',
    fontWeight: '900',
    fontSize: 15,
  },
  feedFilterRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 16,
    marginHorizontal: 12,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  feedFilterButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d7d7d7',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  feedFilterButtonActive: {
    borderColor: '#007AFF',
    backgroundColor: '#EAF3FF',
  },
  feedFilterText: {
    color: '#666',
    fontWeight: '600',
    fontSize: 14,
  },
  feedFilterTextActive: {
    color: '#007AFF',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff7ed',
  },
  postCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ffe4c7',
  },
  adCard: {
    backgroundColor: '#FFF7E6',
    borderColor: '#F4B400',
    borderWidth: 1,
    marginBottom: 8,
    padding: 16,
  },
  adLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A15C00',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  textRight: {
    textAlign: 'right',
  },
  adText: {
    fontSize: 14,
    color: '#5C3B00',
    fontWeight: '600',
  },
  personaBanner: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  personaBannerExplore: {
    backgroundColor: '#F7FBFF',
    borderColor: '#CFE4FF',
  },
  personaBannerPersonal: {
    backgroundColor: '#F5F9F4',
    borderColor: '#D6E8D1',
  },
  personaEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#60708A',
    marginBottom: 4,
  },
  personaTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#16233A',
    marginBottom: 4,
  },
  personaBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#3F4B63',
  },
  onboardingCard: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CFE4FF',
    backgroundColor: '#F7FBFF',
    padding: 16,
  },
  onboardingEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#60708A',
    marginBottom: 4,
  },
  onboardingTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#16233A',
    marginBottom: 10,
  },
  onboardingList: {
    gap: 8,
  },
  onboardingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  onboardingItem: {
    flex: 1,
    fontSize: 13,
    color: '#31415E',
    fontWeight: '600',
  },
  sidebarAd: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ececec',
  },
  interstitialAd: {
    backgroundColor: '#111827',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
  },
  interstitialOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: 'rgba(17, 24, 39, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  interstitialCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  interstitialLabel: {
    color: '#FCD34D',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  interstitialTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  interstitialText: {
    color: '#D1D5DB',
    fontSize: 14,
    textAlign: 'center',
  },
  interstitialCloseButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  interstitialCloseText: {
    color: '#111827',
    fontWeight: '800',
  },
  highlightedPostCard: {
    borderWidth: 2,
    borderColor: '#007AFF',
    backgroundColor: '#F2F8FF',
  },
  notificationBadge: {
    backgroundColor: '#EAF3FF',
    borderColor: '#B8D8FF',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
  },
  notificationBadgeText: {
    color: '#0061CC',
    fontSize: 11,
    fontWeight: '700',
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarOnline: {
    borderWidth: 2,
    borderColor: '#10b981',
  },
  avatarHalo: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.28)',
  },
  avatarPlaceholder: {
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  timestamp: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  followButton: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  followingButton: {
    borderColor: '#c5c5c5',
    backgroundColor: '#f4f4f4',
  },
  followButtonText: {
    color: '#007AFF',
    fontSize: 12,
    fontWeight: '700',
  },
  followingButtonText: {
    color: '#666',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moreButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f3f3f3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postText: {
    fontSize: 15,
    color: '#000',
    lineHeight: 20,
    marginBottom: 12,
  },
  postImageWrap: {
    width: '100%',
    maxWidth: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postVideoWrap: {
    width: '100%',
    maxWidth: '100%',
    maxHeight: 400,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  postImage: {
    width: '100%',
    maxWidth: '100%',
    maxHeight: 400,
    backgroundColor: '#f2f2f2',
    objectFit: 'contain' as any,
  },
  postImageFallback: {
    height: Platform.OS === 'web' ? 320 : 300,
  },
  nativePostVideo: {
    width: '100%',
    maxWidth: '100%',
    height: 320,
    maxHeight: 400,
    backgroundColor: '#111827',
  },
  postActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  reactionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 10,
  },
  reactionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  reactionButtonActive: {
    borderColor: '#f97316',
    backgroundColor: '#fff7ed',
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionLabel: {
    color: '#374151',
    fontSize: 11,
    fontWeight: '800',
  },
  reactionCount: {
    color: '#111827',
    fontSize: 11,
    fontWeight: '900',
    minWidth: 12,
    textAlign: 'center',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  actionButtonRTL: {
    marginRight: 0,
    marginLeft: 24,
  },
  actionText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
  },
  actionTextRTL: {
    marginLeft: 0,
    marginRight: 6,
  },
  commentsContainer: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 10,
  },
  commentRow: {
    marginBottom: 8,
    borderRadius: 10,
    paddingVertical: 4,
  },
  commentReplyRow: {
    borderLeftWidth: 2,
    borderLeftColor: '#dbeafe',
    backgroundColor: '#f8fbff',
    paddingLeft: 10,
  },
  commentTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: '#222',
  },
  commentAuthorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentPresenceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  commentActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  commentActionText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
  },
  commentDeleteText: {
    color: '#D14343',
  },
  moderationBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fef3c7',
  },
  moderationBadgeText: {
    color: '#92400e',
    fontWeight: '800',
    fontSize: 12,
  },
  hotPostBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  hotPostBadgeText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '900',
  },
  musicWarningStrip: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 12,
    backgroundColor: '#fffbeb',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  musicWarningText: {
    flex: 1,
    color: '#92400e',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  liveReplayStrip: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.22)',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 3,
    marginBottom: 10,
  },
  liveReplayBadge: {
    color: '#fecaca',
    fontSize: 11,
    fontWeight: '900',
  },
  liveReplayMeta: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
  },
  pollCard: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#f8fbff',
    borderRadius: 14,
    padding: 12,
    gap: 8,
    marginBottom: 14,
  },
  pollTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  pollOption: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  pollOptionSelected: {
    borderColor: '#0F62FE',
    backgroundColor: '#eff6ff',
  },
  pollFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#dbeafe',
  },
  pollOptionText: {
    color: '#1e3a8a',
    fontSize: 13,
    fontWeight: '800',
  },
  pollPercent: {
    position: 'absolute',
    right: 10,
    color: '#1e40af',
    fontSize: 12,
    fontWeight: '900',
  },
  pollVotesText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  commentText: {
    fontSize: 14,
    color: '#333',
    marginTop: 2,
  },
  commentEditRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentEditInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: '#111',
    backgroundColor: '#fff',
  },
  commentSaveText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '700',
  },
  commentCancelText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '700',
  },
  noCommentsText: {
    fontSize: 13,
    color: '#777',
    marginBottom: 8,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    fontSize: 14,
    color: '#111',
  },
  sendButton: {
    marginLeft: 10,
    padding: 8,
  },
  sendButtonRTL: {
    marginLeft: 0,
    marginRight: 10,
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  emptyRetryButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#007AFF',
  },
  emptyRetryText: {
    color: '#fff',
    fontWeight: '800',
  },
});
