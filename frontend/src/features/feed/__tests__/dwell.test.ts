import { buildDwellEvents, getVisiblePostIds, type Post } from '../dwell';

describe('feed dwell helpers', () => {
  const mockPost = (postId: string): Post => ({
    post_id: postId,
    user_id: 'user_1',
    username: 'testuser',
    text: 'test',
    likes_count: 0,
    comments_count: 0,
    is_liked: false,
    created_at: '2024-01-01',
  });

  test('extracts visible post ids only from viewable post rows', () => {
    const visible = getVisiblePostIds([
      { item: { type: 'post', post: mockPost('post_1') }, isViewable: true },
      { item: { type: 'ad', id: 'ad_1', label: 'Ad' }, isViewable: true },
      { item: { type: 'post', post: mockPost('post_2') }, isViewable: false },
    ]);

    expect(Array.from(visible)).toEqual(['post_1']);
  });

  test('builds dwell events for posts that leave the viewport', () => {
    const result = buildDwellEvents(
      new Set(['post_1', 'post_2']),
      new Set(['post_2', 'post_3']),
      { post_1: 1_000, post_2: 2_000 },
      5_000,
    );

    expect(result.events).toEqual([{ postId: 'post_1', dwellMs: 4_000 }]);
    expect(result.nextActiveStarts.post_1).toBeUndefined();
    expect(result.nextActiveStarts.post_2).toBe(2_000);
    expect(result.nextActiveStarts.post_3).toBe(5_000);
  });
});
