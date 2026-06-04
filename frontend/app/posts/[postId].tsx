import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { useApiClient } from '../../src/hooks/useApiClient';

type Post = {
  post_id: string;
  username: string;
  text: string;
  hashtags?: string[];
  mentions?: string[];
  likes_count: number;
  comments_count: number;
  moderation_status?: string | null;
  created_at: string;
};

type Comment = {
  comment_id: string;
  post_id: string;
  username: string;
  text: string;
  created_at: string;
};

export default function PostDetailScreen() {
  const { postId, commentId } = useLocalSearchParams<{ postId: string; commentId?: string }>();
  const { token } = useAuth();
  const { apiFetch } = useApiClient();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView | null>(null);
  const commentLayouts = useRef<Record<string, number>>({});
  const highlightedCommentId = typeof commentId === 'string' ? commentId : null;

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!postId) return;
      setLoading(true);
      const [postResp, commentsResp] = await Promise.all([
        apiFetch(`/posts/${postId}`, {}, { requireAuth: true }),
        apiFetch(`/posts/${postId}/comments`, {}, { requireAuth: true }),
      ]);
      const data = postResp && postResp.ok ? await postResp.json() : null;
      const commentData = commentsResp && commentsResp.ok ? await commentsResp.json() : [];
      if (!mounted) return;
      setPost(data);
      setComments(Array.isArray(commentData) ? commentData : []);
      setLoading(false);
    };
    void load();
    const intervalId = setInterval(() => {
      void load();
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

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
      <Text style={styles.title}>@{post.username}</Text>
      <Text style={styles.meta}>{post.created_at}</Text>
      <Text style={styles.body}>{post.text}</Text>
      {post.moderation_status ? (
        <View style={styles.moderationBadge}>
          <Text style={styles.moderationBadgeText}>
            {post.moderation_status === 'queued' ? 'Queued for review' : post.moderation_status}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  container: { padding: 16, backgroundColor: '#f5f7fb' },
  title: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 8 },
  meta: { color: '#6b7280', marginBottom: 16 },
  body: { fontSize: 16, color: '#111827', lineHeight: 24, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  moderationBadge: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fef3c7' },
  moderationBadgeText: { color: '#92400e', fontWeight: '800', fontSize: 12 },
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
