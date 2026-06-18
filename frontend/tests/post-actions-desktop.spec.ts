import { expect, test } from '@playwright/test';

const user = {
  user_id: 'user_post_actions',
  email: 'post-actions@example.com',
  username: 'postactions',
  profile_picture: '',
  bio: 'Post actions smoke profile',
  relationship_status: 'private',
  followers_count: 1,
  following_count: 2,
  posts_count: 4,
  trust_score: 100,
  role: 'user',
  banned_until: null,
};

const feedPost = {
  post_id: 'post_actions_smoke',
  user_id: 'creator_actions',
  username: 'creatoractions',
  profile_picture: '',
  text: 'Post action smoke test',
  title: 'Post action smoke test',
  image: '',
  video: '',
  duration: 0,
  visibility: 'public',
  type: 'text',
  status: 'ready',
  likes_count: 2,
  comments_count: 0,
  repost_count: 0,
  reaction_counts: {},
  is_liked: false,
  is_bookmarked: false,
  comments: [],
  hashtags: [],
  mentions: [],
  created_at: '2026-06-17T12:00:00.000Z',
};

test('desktop post action menu and share button respond in feed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop-only PC web smoke coverage.');

  const badResponses: { status: number; url: string }[] = [];
  const consoleErrors: string[] = [];
  const actionLogs: string[] = [];

  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push({ status: response.status(), url: response.url() });
    }
  });
  page.on('console', (message) => {
    const text = message.text();
    const expectedMockNoise =
      text.includes("WebSocket connection to 'ws://127.0.0.1:8000/ws/live' failed") ||
      text.includes('Live signaling socket error:');

    if (text.includes('[post-actions]')) actionLogs.push(text);
    if (message.type() === 'error' && !expectedMockNoise) consoleErrors.push(text);
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (payload: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

    if (path === '/auth/me' || path === '/users/me') return json(user);
    if (path === '/notifications/unread-count') return json({ unread_count: 0 });
    if (path === '/messages') return json({ unread_count: 0, threads: [] });
    if (path === '/posts') return json([feedPost]);
    if (path === '/ads/config') return json({ placements: { in_feed: false, sidebar: false, interstitial: false }, frequency: 5, network_enabled: false });
    if (path === '/growth/daily-trends') return json({ items: [] });
    if (path === '/live/breaking') return json({ streams: [] });
    if (path === '/discovery/local-yosla') return json({ items: [] });
    if (path === '/users/creator_actions/is-following') return json({ is_following: false });
    return json({});
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'pc-post-actions-token');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as typeof window & { __copiedPostUrl?: string }).__copiedPostUrl = text;
        },
      },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto('/feed', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText('Post action smoke test');

  await page.getByLabel('Avaa julkaisun toimintovalikko').first().click();
  await expect(page.getByText('Copy link')).toBeVisible();
  await expect(page.getByText('Report post')).toBeVisible();
  await expect(page.getByText('Hide post')).toBeVisible();
  await expect(actionLogs.some((line) => line.includes('menu opened'))).toBe(true);

  await page.getByText('Copy link').click();
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __copiedPostUrl?: string }).__copiedPostUrl)).toContain('/posts/post_actions_smoke');
  await expect(page.getByText('Linkki kopioitu')).toBeVisible();

  await page.getByLabel('Jaa julkaisu').first().click();
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __copiedPostUrl?: string }).__copiedPostUrl)).toContain('/posts/post_actions_smoke');
  await expect.poll(() => Promise.resolve(actionLogs.some((line) => line.includes('share clicked')))).toBe(true);
  await expect.poll(() => Promise.resolve(actionLogs.some((line) => line.includes('copied link')))).toBe(true);
  await expect(page.getByText('Linkki kopioitu')).toBeVisible();

  const overflowFeed = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflowFeed).toBe(false);
  expect(badResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
