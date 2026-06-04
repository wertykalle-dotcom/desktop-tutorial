import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Badge } from '../../src/components/Badge';
import { useApiClient } from '../../src/hooks/useApiClient';
import { useI18n } from '../../src/contexts/I18nContext';

type SearchPost = {
  post_id: string;
  user_id: string;
  username: string;
  text: string;
  image?: string | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
  score?: number;
  match_reason?: string | null;
  score_breakdown?: {
    text?: number;
    author?: number;
    keywords?: number;
    hashtags?: number;
    engagement?: number;
    recency_bonus?: number;
  } | null;
};

type SearchUser = {
  user_id: string;
  username: string;
  bio?: string | null;
  followers_count: number;
  posts_count: number;
  role: string;
  score?: number;
  match_reason?: string | null;
  score_breakdown?: {
    username?: number;
    display_name?: number;
    bio?: number;
    role?: number;
    social?: number;
  } | null;
};

type SearchTopic = { label: string; count: number };
type SearchCommunity = { name: string; members: number; description: string };

type SearchResponse = {
  query: string;
  posts: SearchPost[];
  users: SearchUser[];
  hashtags: SearchTopic[];
  communities: SearchCommunity[];
};

type SearchTab = 'all' | 'recent' | 'top' | 'people' | 'hashtags';

const emptyResult: SearchResponse = {
  query: '',
  posts: [],
  users: [],
  hashtags: [],
  communities: [],
};

const splitQueryTerms = (value: string) =>
  value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

const scoreText = (text: string, terms: string[]) => {
  if (!terms.length) return 0;
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
};

export default function SearchScreen() {
  const { apiFetch } = useApiClient();
  const { t, isRTL } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse>(emptyResult);
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const runSearch = useCallback(async (value: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/search?q=${encodeURIComponent(value)}&limit=10`, {}, { requireAuth: true });
      if (!response) return;
      if (response.ok) {
        const data = (await response.json()) as SearchResponse;
        setResults(data);
      } else {
        setError(t('searchError'));
      }
    } catch {
      setError(t('searchError'));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, t]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void runSearch(query);
    }, 350);
    return () => clearTimeout(timeoutId);
  }, [query, runSearch]);

  const onRefresh = () => {
    void runSearch(query);
  };

  const queryTerms = splitQueryTerms(query);

  const recentPosts = [...results.posts].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    return bTime - aTime;
  });

  const topPosts = [...results.posts].sort((a, b) => {
    const aRelevance = scoreText(a.text, queryTerms) + scoreText(a.username, queryTerms) * 2;
    const bRelevance = scoreText(b.text, queryTerms) + scoreText(b.username, queryTerms) * 2;
    const aScore = a.likes_count * 1.5 + a.comments_count * 2.5 + aRelevance * 4;
    const bScore = b.likes_count * 1.5 + b.comments_count * 2.5 + bRelevance * 4;
    return bScore - aScore || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const sortedPeople = [...results.users].sort((a, b) => {
    const aRelevance = scoreText(a.username, queryTerms) * 3 + scoreText(a.bio || '', queryTerms) * 2;
    const bRelevance = scoreText(b.username, queryTerms) * 3 + scoreText(b.bio || '', queryTerms) * 2;
    return bRelevance - aRelevance || b.followers_count - a.followers_count || b.posts_count - a.posts_count || a.username.localeCompare(b.username);
  });

  const sortedHashtags = [...results.hashtags].sort((a, b) => {
    const aRelevance = scoreText(a.label, queryTerms);
    const bRelevance = scoreText(b.label, queryTerms);
    return bRelevance - aRelevance || b.count - a.count || a.label.localeCompare(b.label);
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
    >
      <Text style={[styles.title, isRTL && styles.textRight]}>{t('search')}</Text>
      <Text style={[styles.subtitle, isRTL && styles.textRight]}>{t('searchSubtitle')}</Text>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color="#8E8E93" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor="#8E8E93"
          style={[styles.input, isRTL && styles.textRight]}
          returnKeyType="search"
          onSubmitEditing={() => void runSearch(query)}
        />
        {loading ? <ActivityIndicator size="small" color="#007AFF" /> : null}
      </View>
      <Text style={[styles.searchNote, isRTL && styles.textRight]}>
        {t('searchRankingNote')}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {query.trim() && !loading && !error && !results.posts.length && !results.users.length && !results.hashtags.length && !results.communities.length ? (
        <View style={styles.emptyResultCard}>
          <Text style={styles.emptyHeroTitle}>{t('searchNoResultsTitle')}</Text>
          <Text style={styles.emptyHeroBody}>{t('searchNoResultsBody')}</Text>
        </View>
      ) : null}

      {!query.trim() ? (
        <View style={styles.emptyHero}>
          <Text style={styles.emptyHeroTitle}>{t('searchHintTitle')}</Text>
          <Text style={styles.emptyHeroBody}>{t('searchHintBody')}</Text>
        </View>
      ) : null}

      <View style={styles.tabRow}>
        <TabButton label={t('searchAll')} active={activeTab === 'all'} onPress={() => setActiveTab('all')} />
        <TabButton label={t('searchRecent')} active={activeTab === 'recent'} onPress={() => setActiveTab('recent')} />
        <TabButton label={t('searchTop')} active={activeTab === 'top'} onPress={() => setActiveTab('top')} />
        <TabButton label={t('searchUsers')} active={activeTab === 'people'} onPress={() => setActiveTab('people')} />
        <TabButton label={t('searchHashtags')} active={activeTab === 'hashtags'} onPress={() => setActiveTab('hashtags')} />
      </View>

      {activeTab === 'all' ? (
        <>
          <Section title={t('searchRecent')} icon="time">
            {recentPosts.length ? recentPosts.slice(0, 3).map((post) => <PostCard key={post.post_id} post={post} terms={queryTerms} expanded={!!expandedCards[post.post_id]} onToggleExpanded={() => setExpandedCards((current) => ({ ...current, [post.post_id]: !current[post.post_id] }))} onOpen={() => router.push(`/posts/${post.post_id}`)} t={t} />) : <EmptyState label={t('searchNoPosts')} />}
          </Section>
          <Section title={t('searchUsers')} icon="person">
            {sortedPeople.length ? sortedPeople.slice(0, 3).map((user) => <UserCard key={user.user_id} user={user} terms={queryTerms} expanded={!!expandedCards[user.user_id]} onToggleExpanded={() => setExpandedCards((current) => ({ ...current, [user.user_id]: !current[user.user_id] }))} t={t} />) : <EmptyState label={t('searchNoUsers')} />}
          </Section>
          <Section title={t('searchHashtags')} icon="pricetag">
            <View style={styles.tagRow}>
              {sortedHashtags.length ? sortedHashtags.slice(0, 6).map((topic) => <Tag key={topic.label} label={`${topic.label} · ${topic.count}`} />) : <EmptyState label={t('searchNoHashtags')} />}
            </View>
          </Section>
          <Section title={t('searchCommunities')} icon="people">
            {results.communities.length ? results.communities.slice(0, 3).map((community) => <CommunityCard key={community.name} community={community} />) : <EmptyState label={t('searchNoCommunities')} />}
          </Section>
        </>
      ) : null}

      {activeTab === 'recent' ? (
        <Section title={t('searchRecent')} icon="time">
          {recentPosts.length ? recentPosts.map((post) => <PostCard key={post.post_id} post={post} terms={queryTerms} expanded={!!expandedCards[post.post_id]} onToggleExpanded={() => setExpandedCards((current) => ({ ...current, [post.post_id]: !current[post.post_id] }))} onOpen={() => router.push(`/posts/${post.post_id}`)} t={t} />) : <EmptyState label={t('searchNoPosts')} />}
        </Section>
      ) : null}

      {activeTab === 'top' ? (
        <Section title={t('searchTop')} icon="trending-up">
          {topPosts.length ? topPosts.map((post) => <PostCard key={post.post_id} post={post} terms={queryTerms} expanded={!!expandedCards[post.post_id]} onToggleExpanded={() => setExpandedCards((current) => ({ ...current, [post.post_id]: !current[post.post_id] }))} onOpen={() => router.push(`/posts/${post.post_id}`)} t={t} />) : <EmptyState label={t('searchNoPosts')} />}
        </Section>
      ) : null}

      {activeTab === 'people' ? (
        <Section title={t('searchUsers')} icon="person">
          {sortedPeople.length ? sortedPeople.map((user) => <UserCard key={user.user_id} user={user} terms={queryTerms} expanded={!!expandedCards[user.user_id]} onToggleExpanded={() => setExpandedCards((current) => ({ ...current, [user.user_id]: !current[user.user_id] }))} t={t} />) : <EmptyState label={t('searchNoUsers')} />}
        </Section>
      ) : null}

      {activeTab === 'hashtags' ? (
        <>
          <Section title={t('searchHashtags')} icon="pricetag">
            <View style={styles.tagRow}>
              {sortedHashtags.length ? sortedHashtags.map((topic) => <Tag key={topic.label} label={`${topic.label} · ${topic.count}`} />) : <EmptyState label={t('searchNoHashtags')} />}
            </View>
          </Section>
          <Section title={t('searchCommunities')} icon="people">
            {results.communities.length ? results.communities.map((community) => <CommunityCard key={community.name} community={community} />) : <EmptyState label={t('searchNoCommunities')} />}
          </Section>
        </>
      ) : null}
    </ScrollView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabButton, active && styles.tabButtonActive]}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={18} color="#007AFF" />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function EmptyState({ label }: { label: string }) {
  return <Text style={styles.emptyState}>{label}</Text>;
}

function PostCard({
  post,
  terms,
  expanded,
  onToggleExpanded,
  onOpen,
  t,
}: {
  post: SearchPost;
  terms: string[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpen: () => void;
  t: (key: string) => string;
}) {
  const whyText = post.match_reason || 'match';
  return (
    <Pressable style={styles.card} onPress={onOpen}>
      <Text style={styles.cardTitle}>@{post.username}</Text>
      <HighlightText text={post.text} terms={terms} style={styles.cardText} numberOfLines={2} />
      <Text style={styles.meta}>{post.likes_count} ♥ · {post.comments_count} 💬</Text>
      <Pressable onPress={onToggleExpanded} hitSlop={6}>
        {typeof post.score === 'number' ? <Badge tone="brand" icon={<Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={10} color="#0F62FE" />} label={whyText.length > 18 ? `${whyText.slice(0, 15)}…` : whyText} compact /> : null}
      </Pressable>
      {expanded && post.score_breakdown ? (
        <Text style={styles.breakdownText} numberOfLines={1}>
          {formatScoreBreakdown(post.score_breakdown, ['text', 'author', 'keywords', 'hashtags', 'engagement', 'recency_bonus'])}
        </Text>
      ) : null}
    </Pressable>
  );
}

function UserCard({ user, terms, expanded, onToggleExpanded, t }: { user: SearchUser; terms: string[]; expanded: boolean; onToggleExpanded: () => void; t: (key: string) => string }) {
  const whyText = user.match_reason || 'match';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>@{user.username}</Text>
      <HighlightText text={user.bio || ''} terms={terms} style={styles.cardText} />
      <Text style={styles.meta}>{user.followers_count} · {user.posts_count}</Text>
      <Pressable onPress={onToggleExpanded} hitSlop={6}>
        {typeof user.score === 'number' ? <Badge tone="brand" icon={<Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={10} color="#0F62FE" />} label={whyText.length > 18 ? `${whyText.slice(0, 15)}…` : whyText} compact /> : null}
      </Pressable>
      {expanded && user.score_breakdown ? (
        <Text style={styles.breakdownText} numberOfLines={1}>
          {formatScoreBreakdown(user.score_breakdown, ['username', 'display_name', 'bio', 'role', 'social'])}
        </Text>
      ) : null}
    </View>
  );
}

function formatScoreBreakdown(breakdown: Record<string, number>, keys: string[]) {
  return keys
    .map((key) => {
      const value = breakdown[key];
      return value && value > 0 ? `${key.replace('_', ' ')} ${value.toFixed(1)}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}

function CommunityCard({ community }: { community: SearchCommunity }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{community.name}</Text>
      <Text style={styles.cardText}>{community.description}</Text>
      <Text style={styles.meta}>{community.members} members</Text>
    </View>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

function HighlightText({
  text,
  terms,
  style,
  numberOfLines,
}: {
  text: string;
  terms: string[];
  style?: any;
  numberOfLines?: number;
}) {
  if (!text) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }
  if (!terms.length) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }
  const lowerText = text.toLowerCase();
  const segments: { text: string; highlight: boolean }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const nextMatch = terms
      .map((term) => ({ term, index: term ? lowerText.indexOf(term, cursor) : -1 }))
      .filter((match) => match.index >= 0)
      .sort((a, b) => a.index - b.index)[0];
    if (!nextMatch) {
      segments.push({ text: text.slice(cursor), highlight: false });
      break;
    }
    if (nextMatch.index > cursor) {
      segments.push({ text: text.slice(cursor, nextMatch.index), highlight: false });
    }
    segments.push({ text: text.slice(nextMatch.index, nextMatch.index + nextMatch.term.length), highlight: true });
    cursor = nextMatch.index + nextMatch.term.length;
  }
  if (!segments.some((segment) => segment.highlight)) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, index) => (
        <Text key={`${segment.text}-${index}`} style={segment.highlight ? styles.highlight : undefined}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA' },
  content: { padding: 16, paddingBottom: 36, gap: 16 },
  title: { fontSize: 30, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 15, color: '#6B7280', marginTop: -4 },
  textRight: { textAlign: 'right' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    gap: 10,
    minHeight: 54,
  },
  input: { flex: 1, fontSize: 16, color: '#111827' },
  searchNote: { fontSize: 12, color: '#6B7280', lineHeight: 18, marginTop: -4 },
  error: { color: '#B42318', backgroundColor: '#FEF3F2', padding: 12, borderRadius: 12 },
  emptyHero: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    gap: 6,
  },
  emptyResultCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#FED7AA',
    padding: 16,
    gap: 6,
  },
  emptyHeroTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  emptyHeroBody: { fontSize: 14, color: '#6B7280', lineHeight: 20 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tabButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tabButtonActive: {
    backgroundColor: '#0F62FE',
    borderColor: '#0F62FE',
  },
  tabButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 13,
  },
  tabButtonTextActive: {
    color: '#fff',
  },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  sectionContent: { gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cardText: { fontSize: 14, color: '#374151', lineHeight: 20 },
  meta: { fontSize: 12, color: '#6B7280' },
  breakdownText: { fontSize: 10, color: '#94A3B8', marginTop: 1, lineHeight: 14 },
  emptyState: {
    color: '#6B7280',
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    backgroundColor: '#E8F1FF',
    borderColor: '#B8D4FF',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tagText: { color: '#0F62FE', fontSize: 13, fontWeight: '600' },
  highlight: { fontWeight: '800', color: '#0F62FE' },
});
