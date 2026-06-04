export type Post = {
  post_id: string;
  user_id: string;
  username: string;
  profile_picture?: string;
  text: string;
  image?: string;
  repost_post_id?: string | null;
  repost_count?: number;
  likes_count: number;
  comments_count: number;
  is_liked: boolean;
  moderation_status?: string | null;
  comments?: Comment[];
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
