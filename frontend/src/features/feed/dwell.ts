export type Post = {
  post_id: string;
  user_id: string;
  username: string;
  profile_picture?: string;
  text: string;
  image?: string;
  video?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  title?: string | null;
  duration?: number | null;
  visibility?: 'public' | 'private' | 'hidden' | string | null;
  pinned_to_profile?: boolean | number | null;
  is_pinned?: boolean | number | null;
  type?: string;
  source?: string;
  status?: 'processing' | 'ready' | 'failed' | string;
  is_clip?: boolean;
  poll?: {
    question: string;
    options: { option_id: string; text: string; votes_count: number }[];
    total_votes: number;
    user_vote?: string | null;
  } | null;
  reaction_counts?: Record<string, number>;
  user_reaction?: string | null;
  repost_post_id?: string | null;
  repost_count?: number;
  likes_count: number;
  comments_count: number;
  views?: number;
  watch_time?: number;
  completion_rate?: number;
  replay_count?: number;
  is_liked: boolean;
  is_bookmarked?: boolean;
  moderation_status?: string | null;
  comments?: Comment[];
  copyright_status?: string;
  music_risk?: string;
  music_warning_acknowledged?: boolean;
  distribution_limited?: boolean;
  created_at: string;
};

export type Comment = {
  comment_id: string;
  post_id: string;
  user_id: string;
  username: string;
  profile_picture?: string;
  text: string;
  created_at: string;
};

export type FeedItem = { type: 'post'; post: Post } | { type: 'ad'; id: string; label: string };

export type ViewableFeedItem = {
  item: FeedItem;
  isViewable: boolean;
};

export type DwellEvent = {
  postId: string;
  dwellMs: number;
};

export const getVisiblePostIds = (viewableItems: ViewableFeedItem[]) =>
  new Set(
    viewableItems
      .filter((viewable) => viewable.isViewable && viewable.item.type === 'post')
      .map((viewable) => (viewable.item as { type: 'post'; post: Post }).post.post_id)
  );

export const buildDwellEvents = (
  previousVisibleIds: Set<string>,
  nextVisibleIds: Set<string>,
  startedAtByPostId: Record<string, number>,
  now: number,
) => {
  const events: DwellEvent[] = [];
  const nextActiveStarts = { ...startedAtByPostId };

  for (const previousPostId of previousVisibleIds) {
    if (nextVisibleIds.has(previousPostId)) continue;
    const startedAt = startedAtByPostId[previousPostId];
    if (!startedAt) continue;
    events.push({
      postId: previousPostId,
      dwellMs: Math.max(0, now - startedAt),
    });
    delete nextActiveStarts[previousPostId];
  }

  for (const nextPostId of nextVisibleIds) {
    if (!nextActiveStarts[nextPostId]) {
      nextActiveStarts[nextPostId] = now;
    }
  }

  return {
    events,
    nextActiveStarts,
  };
};
