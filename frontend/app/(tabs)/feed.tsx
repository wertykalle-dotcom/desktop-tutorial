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
} from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useApiClient } from '../../src/hooks/useApiClient';

const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const BACKEND_BASE = EXPO_PUBLIC_BACKEND_URL.replace(/\/+$/, '').replace(/\/api$/, '');

interface Comment {
  comment_id: string;
  post_id: string;
  user_id: string;
  username: string;
  profile_picture?: string;
  text: string;
  created_at: string;
}

interface Post {
  post_id: string;
  user_id: string;
  username: string;
  profile_picture?: string;
  text: string;
  image?: string;
  likes_count: number;
  comments_count: number;
  is_liked: boolean;
  comments?: Comment[];
  created_at: string;
}

const moveHighlightedPostFirst = (items: Post[], highlightedId?: string) => {
  if (!highlightedId) return items;
  const index = items.findIndex((post) => post.post_id === highlightedId);
  if (index <= 0) return items;
  const next = [...items];
  const [highlighted] = next.splice(index, 1);
  next.unshift(highlighted);
  return next;
};

export default function FeedScreen() {
  const params = useLocalSearchParams<{ highlightPostId?: string | string[] }>();
  const highlightPostId = Array.isArray(params.highlightPostId)
    ? params.highlightPostId[0]
    : params.highlightPostId;
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [editingCommentIdByPost, setEditingCommentIdByPost] = useState<Record<string, string | null>>({});
  const [editingCommentTextById, setEditingCommentTextById] = useState<Record<string, string>>({});
  const [likeLoadingByPost, setLikeLoadingByPost] = useState<Record<string, boolean>>({});
  const [commentLoadingByPost, setCommentLoadingByPost] = useState<Record<string, boolean>>({});
  const [followingByUserId, setFollowingByUserId] = useState<Record<string, boolean>>({});
  const [followLoadingByUserId, setFollowLoadingByUserId] = useState<Record<string, boolean>>({});
  const [mutedByUserId, setMutedByUserId] = useState<Record<string, boolean>>({});
  const [blockedByUserId, setBlockedByUserId] = useState<Record<string, boolean>>({});
  const [imageAspectByPostId, setImageAspectByPostId] = useState<Record<string, number>>({});
  const { token, user } = useAuth();
  const { apiFetch } = useApiClient();
  const highlightPulse = useRef(new Animated.Value(0)).current;
  const highlightGlow = useRef(new Animated.Value(0)).current;

  const resolveMediaUrl = (uri?: string) => {
    if (!uri) return undefined;
    if (/^https?:\/\//i.test(uri)) return uri;
    return `${BACKEND_BASE}${uri.startsWith('/') ? uri : `/${uri}`}`;
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
      if (!response || response.status === 401) return;

      if (response.ok) {
        const data = await response.json();
        const normalizedPosts = Array.isArray(data) ? (data as Post[]) : [];
        const orderedPosts = moveHighlightedPostFirst(normalizedPosts, highlightPostId);
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
      } else {
        const raw = await response.text();
        console.error('Feed fetch failed:', response.status, raw);
        setPosts([]);
      }
    } catch (error) {
      console.error('Error fetching feed:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [followingOnly, token, user?.user_id, apiFetch]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  useEffect(() => {
    if (highlightPostId && followingOnly) {
      setFollowingOnly(false);
    }
  }, [highlightPostId, followingOnly]);

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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFeed();
  }, [fetchFeed]);

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
      Alert.alert('Virhe', 'Seurannan päivitys epäonnistui');
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
      Alert.alert('Kiitos', 'Ilmoitus lähetetty moderointiin.');
    } catch (error) {
      console.error('Error reporting post:', error);
      Alert.alert('Virhe', 'Ilmoituksen lähetys epäonnistui');
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
      Alert.alert('Valmis', isMuted ? 'Käyttäjä hiljennetty.' : 'Käyttäjän hiljennys poistettu.');
    } catch (error) {
      console.error('Error toggling mute:', error);
      Alert.alert('Virhe', 'Hiljennyksen päivitys epäonnistui');
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
      Alert.alert('Valmis', isBlocked ? 'Käyttäjä estetty.' : 'Käyttäjän esto poistettu.');
    } catch (error) {
      console.error('Error toggling block:', error);
      Alert.alert('Virhe', 'Eston päivitys epäonnistui');
    }
  };

  const openSafetyActions = (post: Post) => {
    if (post.user_id === user?.user_id) return;
    const isMuted = !!mutedByUserId[post.user_id];
    const isBlocked = !!blockedByUserId[post.user_id];
    Alert.alert(
      'Toiminnot',
      `@${post.username}`,
      [
        { text: 'Ilmianna julkaisu', onPress: () => reportPost(post.post_id) },
        { text: isMuted ? 'Poista hiljennys' : 'Hiljennä käyttäjä', onPress: () => toggleMute(post.user_id) },
        { text: isBlocked ? 'Poista esto' : 'Estä käyttäjä', style: 'destructive', onPress: () => toggleBlock(post.user_id) },
        { text: 'Peruuta', style: 'cancel' },
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
      Alert.alert('Virhe', 'Tykkäyksen päivittäminen epäonnistui');
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
      Alert.alert('Virhe', 'Kommentin lähetys epäonnistui');
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
      Alert.alert('Virhe', 'Kommentin muokkaus epäonnistui');
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
      Alert.alert('Virhe', 'Kommentin poisto epäonnistui');
    } finally {
      setCommentLoadingByPost((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const confirmDeleteComment = (postId: string, commentId: string) => {
    Alert.alert(
      'Poista kommentti',
      'Haluatko varmasti poistaa tämän kommentin?',
      [
        { text: 'Peruuta', style: 'cancel' },
        {
          text: 'Poista',
          style: 'destructive',
          onPress: () => deleteComment(postId, commentId),
        },
      ]
    );
  };

  const renderPost = ({ item }: { item: Post }) => {
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
      <View style={styles.postHeader}>
        <View style={styles.userInfo}>
          {item.profile_picture ? (
            <Image
              source={{ uri: resolveMediaUrl(item.profile_picture) }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={24} color="#fff" />
            </View>
          )}
          <View>
            <Text style={styles.username}>{item.username}</Text>
            <Text style={styles.timestamp}>
              {new Date(item.created_at).toLocaleDateString('fi-FI')}
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
            <Text style={styles.notificationBadgeText}>Ilmoituksesta</Text>
          </Animated.View>
        )}
        {item.user_id !== user?.user_id && (
          <View style={styles.headerActions}>
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
                  {followingByUserId[item.user_id] ? 'Seurataan' : 'Seuraa'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Text style={styles.postText}>{item.text}</Text>

      {item.image && (
        <View style={styles.postImageWrap}>
          <Image
            source={{ uri: resolveMediaUrl(item.image) }}
            style={[
              styles.postImage,
              imageAspectByPostId[item.post_id]
                ? { aspectRatio: imageAspectByPostId[item.post_id], height: undefined }
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
            resizeMode="cover"
          />
        </View>
      )}

      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleLike(item)}
          disabled={likeLoadingByPost[item.post_id]}
        >
          <Ionicons
            name={item.is_liked ? 'heart' : 'heart-outline'}
            size={24}
            color={item.is_liked ? '#FF3B30' : '#666'}
          />
          <Text style={styles.actionText}>{item.likes_count}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => toggleComments(item.post_id)}
        >
          <Ionicons name="chatbubble-outline" size={22} color="#666" />
          <Text style={styles.actionText}>{item.comments_count || 0}</Text>
        </TouchableOpacity>
      </View>

      {expandedComments[item.post_id] && (
        <View style={styles.commentsContainer}>
          {(item.comments || []).length > 0 ? (
            (item.comments || []).map((comment) => {
              const isOwnComment = user?.user_id === comment.user_id;
              const isEditing = editingCommentIdByPost[item.post_id] === comment.comment_id;
              return (
                <View key={comment.comment_id} style={styles.commentRow}>
                  <View style={styles.commentTopRow}>
                    <Text style={styles.commentAuthor}>{comment.username}</Text>
                    {isOwnComment && !isEditing && (
                      <View style={styles.commentActionRow}>
                        <TouchableOpacity onPress={() => startEditComment(item.post_id, comment)}>
                          <Text style={styles.commentActionText}>Muokkaa</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmDeleteComment(item.post_id, comment.comment_id)}>
                          <Text style={[styles.commentActionText, styles.commentDeleteText]}>Poista</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {isEditing ? (
                    <View style={styles.commentEditRow}>
                      <TextInput
                        style={styles.commentEditInput}
                        value={editingCommentTextById[comment.comment_id] || ''}
                        onChangeText={(value) =>
                          setEditingCommentTextById((prev) => ({ ...prev, [comment.comment_id]: value }))
                        }
                        editable={!commentLoadingByPost[item.post_id]}
                      />
                      <TouchableOpacity onPress={() => saveEditedComment(item.post_id, comment.comment_id)}>
                        <Text style={styles.commentSaveText}>Tallenna</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => cancelEditComment(item.post_id)}>
                        <Text style={styles.commentCancelText}>Peruuta</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.commentText}>{comment.text}</Text>
                  )}
                </View>
              );
            })
          ) : (
            <Text style={styles.noCommentsText}>Ei kommentteja vielä</Text>
          )}

          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder="Kirjoita kommentti..."
              value={commentInputs[item.post_id] || ''}
              onChangeText={(value) =>
                setCommentInputs((prev) => ({ ...prev, [item.post_id]: value }))
              }
              editable={!commentLoadingByPost[item.post_id]}
            />
            <TouchableOpacity
              style={styles.sendButton}
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

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.feedFilterRow}>
        <TouchableOpacity
          style={[styles.feedFilterButton, !followingOnly && styles.feedFilterButtonActive]}
          onPress={() => setFollowingOnly(false)}
        >
          <Text style={[styles.feedFilterText, !followingOnly && styles.feedFilterTextActive]}>Kaikki</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.feedFilterButton, followingOnly && styles.feedFilterButtonActive]}
          onPress={() => setFollowingOnly(true)}
        >
          <Text style={[styles.feedFilterText, followingOnly && styles.feedFilterTextActive]}>Seuraamani</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={(item) => item.post_id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="paper-plane-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>Ei julkaisuja vielä</Text>
            <Text style={styles.emptySubtext}>Luo ensimmäinen julkaisu!</Text>
          </View>
        }
        contentContainerStyle={posts.length === 0 ? styles.emptyList : null}
      />
    </View>
  );
}

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
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
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
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
  },
  postImage: {
    width: '100%',
    backgroundColor: '#f2f2f2',
  },
  postImageFallback: {
    height: Platform.OS === 'web' ? 320 : 300,
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
  actionText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
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
  },
});
