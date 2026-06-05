import { apiUrl, buildApiHeaders } from '../../utils/api/http';
import type { Post } from '../feed/dwell';

export type ExploreTopic = { label: string; count: number };
export type CreatorSuggestion = { username: string; postCount: number; userId: string };
export type ThreadItem = { id: string; title: string; preview: string; time: string };
export type CommunityItem = { name: string; members: number; description: string; is_member?: boolean };
export type ProjectItem = { name: string; status: string; description: string };
export type NetworkItem = { label: string; value: string };

const normalizeWord = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 || part.startsWith('#'));

export const deriveTopicsFromPosts = (posts: Post[]): ExploreTopic[] => {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const token of normalizeWord(post.text || '')) {
      if (!token.startsWith('#')) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8);
};

export const deriveCreatorsFromPosts = (posts: Post[]): CreatorSuggestion[] => {
  const creators = new Map<string, CreatorSuggestion>();
  for (const post of posts) {
    const existing = creators.get(post.user_id);
    creators.set(post.user_id, {
      userId: post.user_id,
      username: post.username,
      postCount: (existing?.postCount || 0) + 1,
    });
  }
  return [...creators.values()]
    .sort((a, b) => b.postCount - a.postCount || a.username.localeCompare(b.username))
    .slice(0, 6);
};

export const deriveThreadsFromNotifications = (notifications: any[]): ThreadItem[] =>
  notifications.slice(0, 5).map((item, index) => ({
    id: item.notification_id || `thread_${index}`,
    title: item.actor_username ? `@${item.actor_username}` : item.type || 'Notification',
    preview: item.message || item.text || item.type || 'Update',
    time: item.created_at || '',
  }));

export const defaultCommunities: CommunityItem[] = [];

export const defaultProjects: ProjectItem[] = [
  { name: 'Alpha launch', status: 'Luonnos', description: 'Julkaisun valmistelut ja testaus.' },
  { name: 'Creator toolkit', status: 'Käynnissä', description: 'Sisältötyökalujen pilotointi.' },
  { name: 'Community map', status: 'Suunnittelu', description: 'Yhteisöjen ja teemojen kartoitus.' },
];

export const defaultNetwork: NetworkItem[] = [
  { label: 'Aktiiviset yhteydet', value: '24' },
  { label: 'Yhteistyöehdotukset', value: '8' },
  { label: 'A/B Debug', value: 'Live' },
];

export const fetchJson = async <T>(path: string, token?: string | null): Promise<T | null> => {
  try {
    const response = await fetch(apiUrl(path), {
      headers: buildApiHeaders(undefined, token),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
};
