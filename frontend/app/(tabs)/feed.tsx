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

  const resolveMediaUrl = (uri?: string) => {
    if (!uri) return undefined;
    if (/^https?:\/\//i.test(uri)) return uri;
    return `${BACKEND_BASE}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const isVideoUrl = (uri?: string) => !!uri && /\.(mp4|mov|webm)(?:$|\?)/i.test(uri);

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

  const renderPost = ({ item }: { item: LocalPost }) => {
    const isHighlighted = highlightPostId === item.post_id;
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
        <TouchableOpacity
          style={[styles.actionButton, isRTL && styles.actionButtonRTL]}
          onPress={() => handleLike(item)}
          disabled={likeLoadingByPost[item.post_id]}
        >
          <Ionicons
            name={item.is_liked ? 'heart' : 'heart-outline'}
            size={24}
            color={item.is_liked ? '#FF3B30' : '#666'}
          />
          <Text style={[styles.actionText, isRTL && styles.actionTextRTL]}>{item.likes_count}</Text>
        </TouchableOpacity>

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
      </View>

      {expandedComments[item.post_id] && (
        <View style={styles.commentsContainer}>
          {(item.comments || []).length > 0 ? (
            (item.comments || []).map((comment) => {
              const isOwnComment = user?.user_id === comment.user_id;
              const isEditing = editingCommentIdByPost[item.post_id] === comment.comment_id;
              const isOnline = Boolean((comment as { is_online?: boolean }).is_online);
              return (
                <View key={comment.comment_id} style={styles.commentRow}>
                  <View style={[styles.commentTopRow, isRTL && styles.rowReverse]}>
                    <View style={styles.commentAuthorWrap}>
                      <Text style={[styles.commentAuthor, isRTL && styles.textRight]}>{comment.username}</Text>
                      {isOnline ? <View style={styles.commentPresenceDot} /> : null}
                    </View>
                    {isOwnComment && !isEditing && (
                      <View style={[styles.commentActionRow, isRTL && styles.rowReverse]}>
                        <TouchableOpacity onPress={() => startEditComment(item.post_id, comment)}>
                          <Text style={styles.commentActionText}>{t('feedCommentEdit')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmDeleteComment(item.post_id, comment.comment_id)}>
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
                        editable={!commentLoadingByPost[item.post_id]}
                      />
                      <TouchableOpacity onPress={() => saveEditedComment(item.post_id, comment.comment_id)}>
                        <Text style={styles.commentSaveText}>{t('feedCommentSave')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => cancelEditComment(item.post_id)}>
                        <Text style={styles.commentCancelText}>{t('feedCommentCancel')}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={[styles.commentText, isRTL && styles.textRight]}>{comment.text}</Text>
                  )}
                </View>
              );
            })
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
      {adConfig.placements.sidebar && width >= 768 ? (
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
      <FlatList
        data={feedItems}
        renderItem={renderFeedItem}
        keyExtractor={(item) => item.type === 'post' ? item.post.post_id : item.id}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 60,
          minimumViewTime: 300,
        }}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name={feedError ? 'cloud-offline-outline' : 'paper-plane-outline'} size={64} color="#ccc" />
            <Text style={styles.emptyText}>{feedError ? t('feedLoadFailed') : t('feedNoPosts')}</Text>
            <Text style={styles.emptySubtext}>{feedError ? t('feedLoadFailedBody') : t('feedCreateFirstPost')}</Text>
            {feedError ? (
              <TouchableOpacity style={styles.emptyRetryButton} onPress={() => void fetchFeed()}>
                <Text style={styles.emptyRetryText}>{t('retry')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        contentContainerStyle={posts.length === 0 ? styles.emptyList : null}
      />
    </View>
  );
}

export default FeedScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  feedFilterRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ececec',
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
    backgroundColor: '#f5f5f5',
  },
  postCard: {
    backgroundColor: '#fff',
    marginBottom: 8,
    padding: 16,
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
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 24,
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
