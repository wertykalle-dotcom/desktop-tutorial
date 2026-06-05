import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Modal,
  Share,
} from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useLocalSearchParams } from 'expo-router';
import { useApiClient } from '../../src/hooks/useApiClient';
import { formatRelativeTime, formatLocalDate } from '../../src/utils/time';
import { useI18n } from '../../src/contexts/I18nContext';
import { buildDwellEvents, getVisiblePostIds, type FeedItem as DwellFeedItem, type Post, type Comment } from '../../src/features/feed/dwell';
import { API_BASE } from '../../src/utils/api/http';

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

const liveChatSeed = [
  '@mira: Mahtava aihe!',
  '@arto: Kysymys hostille...',
  '@sanna: Tämä näyttää hyvältä.',
  '@toni: Voiko tästä tehdä Q&A:n?',
  '@leena: 🔥🔥🔥',
];

const liveHosts = [
  { id: 'live_1', name: 'YOSLA', topic: '#Luonto' },
  { id: 'live_2', name: 'Studio FI', topic: '#build' },
  { id: 'live_3', name: 'Creator Lab', topic: '#design' },
];

const achievementBadges = [
  { icon: 'ribbon', title: 'Perustajajäsen', value: 'Aktiivinen' },
  { icon: 'chatbubbles', title: 'Viikon keskustelija', value: '12 vastausta' },
  { icon: 'star', title: 'Suosittu kirjoittaja', value: '340 pistettä' },
] as const;

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
  const [followingByUserId, setFollowingByUserId] = useState<Record<string, boolean>>({});
  const [followLoadingByUserId, setFollowLoadingByUserId] = useState<Record<string, boolean>>({});
  const [mutedByUserId, setMutedByUserId] = useState<Record<string, boolean>>({});
  const [blockedByUserId, setBlockedByUserId] = useState<Record<string, boolean>>({});
  const [imageAspectByPostId, setImageAspectByPostId] = useState<Record<string, number>>({});
  const [reactionByPost, setReactionByPost] = useState<Record<string, string>>({});
  const [reactionCountsByPost, setReactionCountsByPost] = useState<Record<string, Record<string, number>>>({});
  const [savedByPost, setSavedByPost] = useState<Record<string, boolean>>({});
  const [dailyVote, setDailyVote] = useState<'yes' | 'no' | null>(null);
  const [activeLiveHost, setActiveLiveHost] = useState<typeof liveHosts[number] | null>(null);
  const [liveChatMessages, setLiveChatMessages] = useState<string[]>(liveChatSeed.slice(0, 2));
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
  const isNewUser = (user?.posts_count ?? 0) < 3 && (user?.followers_count ?? 0) === 0 && (user?.following_count ?? 0) <= 2;
  const isDesktop = width >= 768;

  const resolveMediaUrl = (uri?: string) => {
    if (!uri) return undefined;
    if (/^https?:\/\//i.test(uri)) return uri;
    return `${BACKEND_BASE}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const isVideoUrl = (uri?: string) => !!uri && /\.(mp4|mov|webm)(?:$|\?)/i.test(uri);

  const hotPosts = useMemo(
    () =>
      posts
        .map((post) => ({ post, badge: getPostBadge(post.comments_count || 0) }))
        .filter((item): item is { post: LocalPost; badge: HotPostBadge } => !!item.badge)
        .sort((a, b) => (b.post.comments_count || 0) - (a.post.comments_count || 0))
        .slice(0, 4),
    [posts]
  );

  const sharePost = async (post: LocalPost) => {
    const path = `/posts/${post.post_id}`;
    const url = Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}${path}`
      : path;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        Alert.alert('Jaettu', 'Linkki kopioitu leikepöydälle.');
        return;
      }
      await Share.share({ message: `${post.text}\n${url}` });
    } catch (error) {
      console.error('Error sharing post:', error);
      Alert.alert(t('error'), 'Jakaminen ei onnistunut.');
    }
  };

  const toggleSavePost = async (post: LocalPost) => {
    const postId = post.post_id;
    const previousSaved = savedByPost[postId] ?? !!post.is_bookmarked;
    const optimisticSaved = !previousSaved;
    setSavedByPost((prev) => ({ ...prev, [postId]: optimisticSaved }));
    setPosts((prev) => prev.map((item) => item.post_id === postId ? { ...item, is_bookmarked: optimisticSaved } : item));
    try {
      const response = await apiFetch(`/posts/${postId}/bookmark`, { method: 'POST' });
      if (!response || !response.ok) {
        throw new Error(`Bookmark failed (${response?.status || 'network'})`);
      }
      const payload = await response.json();
      setSavedByPost((prev) => ({ ...prev, [postId]: !!payload.is_bookmarked }));
      setPosts((prev) => prev.map((item) => item.post_id === postId ? { ...item, is_bookmarked: !!payload.is_bookmarked } : item));
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      setSavedByPost((prev) => ({ ...prev, [postId]: previousSaved }));
      setPosts((prev) => prev.map((item) => item.post_id === postId ? { ...item, is_bookmarked: previousSaved } : item));
      Alert.alert(t('error'), 'Kirjanmerkin tallennus ei onnistunut.');
    }
  };

  const handleReaction = async (post: LocalPost, reactionKey: string) => {
    const previousReaction = reactionByPost[post.post_id] || post.user_reaction || null;
    const previousCounts = reactionCountsByPost[post.post_id] || post.reaction_counts || {};
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
    if (!activeLiveHost) {
      setLiveChatMessages(liveChatSeed.slice(0, 2));
      return undefined;
    }
    let index = 2;
    const intervalId = setInterval(() => {
      setLiveChatMessages((current) => [...current.slice(-4), liveChatSeed[index % liveChatSeed.length]]);
      index += 1;
    }, 1800);
    return () => clearInterval(intervalId);
  }, [activeLiveHost]);

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
      if (!response || response.status === 401) {
        setFeedError(true);
        setPosts([]);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        const normalizedPosts = Array.isArray(data) ? (data as LocalPost[]) : [];
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
  }, [followingOnly, highlightPostId, token, user?.user_id, apiFetch]);

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

  const reportPost = async (postId: string) => {
    try {
      const response = await apiFetch('/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target_type: 'post',
          target_id: postId,
          reason: 'inappropriate',
          details: 'Reported from feed',
        }),
      });
      if (!response || response.status === 401) return;
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Report failed (${response.status}): ${raw}`);
      }
      Alert.alert(t('error'), t('feedReportSent'));
    } catch (error) {
      console.error('Error reporting post:', error);
      Alert.alert(t('error'), t('feedReportFailed'));
    }
  };

  const toggleMute = async (targetUserId: string) => {
    try {
      const response = await apiFetch(`/users/${targetUserId}/mute`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Mute toggle failed (${response.status}): ${raw}`);
      }
      const payload = await response.json();
      const isMuted = !!payload?.is_muted;
      setMutedByUserId((prev) => ({ ...prev, [targetUserId]: isMuted }));
      if (isMuted) {
        setPosts((prev) => prev.filter((p) => p.user_id !== targetUserId));
      }
      Alert.alert(t('error'), isMuted ? t('feedUserMuted') : t('feedUserUnmuted'));
    } catch (error) {
      console.error('Error toggling mute:', error);
      Alert.alert(t('error'), t('feedMuteUpdateFailed'));
    }
  };

  const toggleBlock = async (targetUserId: string) => {
    try {
      const response = await apiFetch(`/users/${targetUserId}/block`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Block toggle failed (${response.status}): ${raw}`);
      }
      const payload = await response.json();
      const isBlocked = !!payload?.is_blocked;
      setBlockedByUserId((prev) => ({ ...prev, [targetUserId]: isBlocked }));
      if (isBlocked) {
        setPosts((prev) => prev.filter((p) => p.user_id !== targetUserId));
      }
      Alert.alert(t('error'), isBlocked ? t('feedUserBlocked') : t('feedUserUnblocked'));
    } catch (error) {
      console.error('Error toggling block:', error);
      Alert.alert(t('error'), t('feedBlockUpdateFailed'));
    }
  };

  const openSafetyActions = (post: Post) => {
    if (post.user_id === user?.user_id) return;
    const isMuted = !!mutedByUserId[post.user_id];
    const isBlocked = !!blockedByUserId[post.user_id];
    Alert.alert(
      t('feedOpenActions'),
      `@${post.username}`,
      [
        { text: t('feedReportPost'), onPress: () => reportPost(post.post_id) },
        { text: isMuted ? t('feedUnmuteUser') : t('feedMuteUser'), onPress: () => toggleMute(post.user_id) },
        { text: isBlocked ? t('feedUnblockUser') : t('feedBlockUser'), style: 'destructive', onPress: () => toggleBlock(post.user_id) },
        { text: t('cancel'), style: 'cancel' },
      ]
    );
  };

  const handleLike = async (post: Post) => {
    const postId = post.post_id;
    if (likeLoadingByPost[postId]) return;

    setLikeLoadingByPost((prev) => ({ ...prev, [postId]: true }));

    // Optimistic UI update
    const optimisticIsLiked = !post.is_liked;
    const optimisticLikesCount = post.is_liked
      ? Math.max(0, post.likes_count - 1)
      : post.likes_count + 1;

    setPosts((prevPosts) =>
      prevPosts.map((p) =>
        p.post_id === postId
          ? {
              ...p,
              is_liked: optimisticIsLiked,
              likes_count: optimisticLikesCount,
            }
          : p
      )
    );

    try {
      const response = await apiFetch(`/posts/${postId}/like`, {
        method: 'POST',
      });
      if (!response || response.status === 401) return;

      if (!response.ok) {
        throw new Error(`Like failed with status ${response.status}`);
      }

      const result = await response.json();
      if (typeof result.is_liked === 'boolean' && typeof result.likes_count === 'number') {
        setPosts((prevPosts) =>
          prevPosts.map((p) =>
            p.post_id === postId
              ? {
                  ...p,
                  is_liked: result.is_liked,
                  likes_count: result.likes_count,
                }
              : p
          )
        );
      }
    } catch (error) {
      // Revert optimistic update
      setPosts((prevPosts) =>
        prevPosts.map((p) =>
          p.post_id === postId
            ? {
                ...p,
                is_liked: post.is_liked,
                likes_count: post.likes_count,
              }
            : p
        )
      );
      console.error('Error toggling like:', error);
      Alert.alert(t('error'), t('feedLikeFailed'));
    } finally {
      setLikeLoadingByPost((prev) => ({ ...prev, [postId]: false }));
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

  const renderLiveNowSection = () => (
    <View style={styles.liveNowSection}>
      <View style={[styles.sectionHeaderRow, isRTL && styles.rowReverse]}>
        <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>Livenä nyt</Text>
        <Text style={styles.livePulseText}>LIVE</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.liveScroller}>
        {liveHosts.map((host) => (
          <TouchableOpacity key={host.id} style={styles.liveHostCard} onPress={() => setActiveLiveHost(host)}>
            <View style={styles.liveAvatarRing}>
              <Text style={styles.liveAvatarInitial}>{host.name.slice(0, 1)}</Text>
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            </View>
            <Text style={styles.liveHostName} numberOfLines={1}>{host.name}</Text>
            <Text style={styles.liveTopic} numberOfLines={1}>{host.topic}</Text>
            <Text style={styles.liveViewerCount}>{host.id === 'live_1' ? 128 : host.id === 'live_2' ? 84 : 42} katsojaa</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  const renderDailyQuestion = () => {
    const yesVotes = 63 + (dailyVote === 'yes' ? 1 : 0);
    const noVotes = 37 + (dailyVote === 'no' ? 1 : 0);
    const total = yesVotes + noVotes;
    const yesPercent = Math.round((yesVotes / total) * 100);
    const noPercent = 100 - yesPercent;
    return (
      <View style={styles.dailyQuestionCard}>
        <View style={[styles.sectionHeaderRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.feedSectionTitle, styles.lightSectionTitle, isRTL && styles.textRight]}>Päivän kysymys</Text>
          <Ionicons name="flash" size={18} color="#facc15" />
        </View>
        <Text style={[styles.dailyQuestionText, isRTL && styles.textRight]}>Poistaisitko TikTokin jos sait 150 €?</Text>
        <View style={[styles.dailyVoteRow, isRTL && styles.rowReverse]}>
          <TouchableOpacity
            style={[styles.dailyVoteButton, dailyVote === 'yes' && styles.dailyVoteButtonActive]}
            onPress={() => setDailyVote('yes')}
          >
            <View style={[styles.dailyVoteFill, { width: `${yesPercent}%` }]} />
            <Text style={styles.dailyVoteText}>Kyllä</Text>
            <Text style={styles.dailyVotePercent}>{yesPercent}%</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dailyVoteButton, dailyVote === 'no' && styles.dailyVoteButtonActive]}
            onPress={() => setDailyVote('no')}
          >
            <View style={[styles.dailyVoteFill, styles.dailyVoteFillNo, { width: `${noPercent}%` }]} />
            <Text style={styles.dailyVoteText}>En</Text>
            <Text style={styles.dailyVotePercent}>{noPercent}%</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.dailyVoteMeta}>{total} paikallista ääntä tässä sessiossa</Text>
      </View>
    );
  };

  const renderWeeklyChallenge = () => (
    <View style={styles.challengeCard}>
      <View style={styles.challengeIconWrap}>
        <Ionicons name="sparkles" size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.challengeKicker, isRTL && styles.textRight]}>Viikon yhteisöhaaste</Text>
        <Text style={[styles.challengeTitle, isRTL && styles.textRight]}>Tämän viikon teema on #Luonto</Text>
        <Text style={[styles.challengeBody, isRTL && styles.textRight]}>Jaa paras kuvasi tai videosi ja kerää YOSLA-pisteitä.</Text>
      </View>
    </View>
  );

  const renderTrendingNow = () => (
    <View style={styles.trendingSection}>
      <View style={[styles.sectionHeaderRow, isRTL && styles.rowReverse]}>
        <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>Puhutuimmat juuri nyt</Text>
        <Ionicons name="trending-up" size={18} color="#ef4444" />
      </View>
      {hotPosts.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendingScroller}>
          {hotPosts.map(({ post, badge }) => (
            <TouchableOpacity
              key={post.post_id}
              style={[styles.trendingCard, styles[`hotBadge_${badge.tone}`]]}
              onPress={() => setExpandedComments((prev) => ({ ...prev, [post.post_id]: true }))}
            >
              <Text style={styles.trendingBadge}>{badge.icon} {badge.label}</Text>
              <Text style={styles.trendingTitle} numberOfLines={2}>{post.text || `@${post.username}`}</Text>
              <Text style={styles.trendingMeta}>@{post.username} · {post.comments_count || 0} kommenttia</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.trendingEmptyCard}>
          <Text style={styles.trendingEmptyTitle}>⭐ Nouseva keskustelu</Text>
          <Text style={styles.trendingEmptyBody}>Kommentoi kiinnostavia julkaisuja, niin kuumimmat aiheet nousevat tähän.</Text>
        </View>
      )}
    </View>
  );

  const renderPhenomenaPanel = () => (
    <View style={styles.phenomenaPanel}>
      <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>Ilmiöt</Text>
      {['#TikTok150', '#Luonto', '#CreatorLab'].map((item, index) => (
        <View key={item} style={styles.phenomenonRow}>
          <Text style={styles.phenomenonRank}>🚀 {index + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.phenomenonTag}>{item}</Text>
            <Text style={styles.phenomenonMeta}>+{(index + 2) * 19}% vauhti viime tunnilla</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderUpcomingStreams = () => (
    <View style={styles.upcomingPanel}>
      <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>Tulevat striimit</Text>
      {['AI suunnittelee yhteisön', 'Kuuma uutinen: somevero', 'Mediakisa finaali'].map((title, index) => (
        <View key={title} style={styles.streamRow}>
          <Text style={styles.streamTime}>{index === 0 ? '18:00' : index === 1 ? '20:30' : 'Huomenna'}</Text>
          <Text style={styles.streamTitle}>{title}</Text>
        </View>
      ))}
    </View>
  );

  const renderGamificationPanel = () => (
    <View style={styles.gamificationPanel}>
      <View style={[styles.sectionHeaderRow, isRTL && styles.rowReverse]}>
        <Text style={[styles.feedSectionTitle, isRTL && styles.textRight]}>Oma eteneminen</Text>
        <View style={styles.pointsBadge}>
          <Ionicons name="flash" size={14} color="#92400e" />
          <Text style={styles.pointsBadgeText}>340 pistettä</Text>
        </View>
      </View>
      <View style={styles.streakRow}>
        <View style={styles.streakPill}>
          <Text style={styles.streakValue}>3</Text>
          <Text style={styles.streakLabel}>päivän putki</Text>
        </View>
        {achievementBadges.map((badge) => (
          <View key={badge.title} style={styles.achievementBadge}>
            <Ionicons name={badge.icon} size={16} color="#0f62fe" />
            <View style={{ flex: 1 }}>
              <Text style={styles.achievementTitle} numberOfLines={1}>{badge.title}</Text>
              <Text style={styles.achievementValue} numberOfLines={1}>{badge.value}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  const renderActiveLiveModal = () => (
    <Modal visible={!!activeLiveHost} animationType="slide" onRequestClose={() => setActiveLiveHost(null)}>
      <View style={styles.liveModal}>
        <View style={styles.liveVideoShell}>
          <Text style={styles.liveModalBadge}>LIVE</Text>
          <Ionicons name="videocam" size={54} color="#fff" />
          <Text style={styles.liveModalTitle}>{activeLiveHost?.name}</Text>
          <Text style={styles.liveModalTopic}>{activeLiveHost?.topic} · aktiivinen stream-pohja</Text>
          <View style={styles.floatingReactionOne}><Text style={styles.floatingReactionText}>🔥</Text></View>
          <View style={styles.floatingReactionTwo}><Text style={styles.floatingReactionText}>🚀</Text></View>
        </View>
        <View style={styles.liveOverlayGrid}>
          <View style={styles.liveChatPanel}>
            <Text style={styles.livePanelTitle}>Live-chat</Text>
            {liveChatMessages.map((message, index) => (
              <Text key={`${message}-${index}`} style={styles.liveChatLine}>{message}</Text>
            ))}
          </View>
          <View style={styles.liveSidePanel}>
            <Text style={styles.livePanelTitle}>Q&A</Text>
            <Text style={styles.liveChatLine}>Nosta parhaat kysymykset tähän.</Text>
            <View style={styles.guestModeBox}>
              <Ionicons name="person-add" size={18} color="#fff" />
              <Text style={styles.guestModeText}>Vierastila valmiina</Text>
            </View>
          </View>
        </View>
        <TouchableOpacity style={styles.liveExitButton} onPress={() => setActiveLiveHost(null)}>
          <Text style={styles.liveExitText}>Poistu</Text>
        </TouchableOpacity>
      </View>
    </Modal>
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
        {item.user_id !== user?.user_id && (
          <View style={[styles.headerActions, isRTL && styles.rowReverse]}>
            <TouchableOpacity
              style={styles.moreButton}
              onPress={() => openSafetyActions(item)}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color="#666" />
            </TouchableOpacity>
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
          </View>
        )}
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

      {item.image ? (
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
              const { width, height } = event.nativeEvent.source;
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
      ) : item.video && isVideoUrl(item.video) ? (
        <View style={styles.postVideoWrap}>
          {Platform.OS === 'web' ? (
            React.createElement('video', {
              src: resolveMediaUrl(item.video),
              controls: true,
              muted: true,
              playsInline: true,
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
          onPress={() => void sharePost(item)}
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
          <ScrollView style={styles.leftRail} contentContainerStyle={styles.railContent}>
            {renderTrendingNow()}
            {renderPhenomenaPanel()}
            {renderWeeklyChallenge()}
            {renderGamificationPanel()}
          </ScrollView>
          <FlatList
            style={styles.centerFeed}
            data={feedItems}
            renderItem={renderFeedItem}
            keyExtractor={(item) => item.type === 'post' ? item.post.post_id : item.id}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 300 }}
            onViewableItemsChanged={onViewableItemsChanged}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={renderIntroStack}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name={feedError ? 'cloud-offline-outline' : 'paper-plane-outline'} size={64} color="#fb7185" />
                <Text style={styles.emptyText}>{feedError ? t('feedLoadFailed') : t('feedNoPosts')}</Text>
                <Text style={styles.emptySubtext}>{feedError ? t('feedLoadFailedBody') : t('feedCreateFirstPost')}</Text>
              </View>
            }
          />
          <ScrollView style={styles.rightRail} contentContainerStyle={styles.railContent}>
            {renderLiveNowSection()}
            {renderUpcomingStreams()}
            {renderDailyQuestion()}
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
              {renderLiveNowSection()}
              {renderDailyQuestion()}
              {renderTrendingNow()}
              {renderIntroStack()}
            </>
          }
          ListFooterComponent={renderWeeklyChallenge}
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
    backgroundColor: '#fff7ed',
  },
  desktopDashboard: {
    flex: 1,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    backgroundColor: '#fff7ed',
  },
  leftRail: {
    width: 286,
    flexShrink: 0,
  },
  rightRail: {
    width: 306,
    flexShrink: 0,
  },
  centerFeed: {
    flex: 1,
    minWidth: 0,
  },
  railContent: {
    gap: 12,
    paddingBottom: 24,
  },
  mobileFeedContent: {
    paddingBottom: 18,
  },
  liveNowSection: {
    backgroundColor: '#1a0710',
    borderWidth: 1,
    borderColor: '#fb7185',
    borderRadius: 18,
    paddingTop: 12,
    paddingBottom: 10,
    marginHorizontal: 12,
    marginTop: 10,
    shadowColor: '#ef4444',
    shadowOpacity: 0.22,
    shadowRadius: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    gap: 10,
  },
  feedSectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
  },
  lightSectionTitle: {
    color: '#fff',
  },
  livePulseText: {
    color: '#fff',
    backgroundColor: '#ef4444',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '900',
  },
  liveScroller: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 12,
  },
  liveHostCard: {
    width: 88,
    alignItems: 'center',
    gap: 5,
  },
  liveAvatarRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    borderColor: '#ef4444',
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ef4444',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 3,
  },
  liveAvatarInitial: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  liveBadge: {
    position: 'absolute',
    bottom: -5,
    borderRadius: 999,
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
  },
  liveHostName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 78,
  },
  liveTopic: {
    color: '#fecdd3',
    fontSize: 11,
    maxWidth: 78,
  },
  liveViewerCount: {
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: '900',
  },
  dailyQuestionCard: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#a78bfa',
    backgroundColor: '#312e81',
    paddingVertical: 14,
    shadowColor: '#7c3aed',
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  dailyQuestionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  dailyVoteRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  dailyVoteButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  dailyVoteButtonActive: {
    borderColor: '#facc15',
    backgroundColor: 'rgba(250,204,21,0.16)',
  },
  dailyVoteFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(34,197,94,0.32)',
  },
  dailyVoteFillNo: {
    backgroundColor: 'rgba(239,68,68,0.32)',
  },
  dailyVoteText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  dailyVotePercent: {
    position: 'absolute',
    right: 10,
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  dailyVoteMeta: {
    color: '#ddd6fe',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 8,
    paddingHorizontal: 12,
  },
  challengeCard: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fed7aa',
    backgroundColor: '#fff7ed',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  challengeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ea580c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeKicker: {
    color: '#9a3412',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  challengeTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  challengeBody: {
    color: '#7c2d12',
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  trendingSection: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingVertical: 12,
  },
  trendingScroller: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 10,
  },
  trendingCard: {
    width: 230,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 6,
    backgroundColor: '#fff',
  },
  trendingBadge: {
    fontSize: 12,
    fontWeight: '900',
    color: '#111827',
  },
  trendingTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  trendingMeta: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  trendingEmptyCard: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    padding: 14,
  },
  trendingEmptyTitle: {
    color: '#111827',
    fontWeight: '900',
    marginBottom: 3,
  },
  trendingEmptyBody: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
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
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
    padding: 14,
    gap: 10,
  },
  streamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 13,
    backgroundColor: '#fff',
    padding: 10,
  },
  streamTime: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '900',
    minWidth: 58,
  },
  streamTitle: {
    flex: 1,
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
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
