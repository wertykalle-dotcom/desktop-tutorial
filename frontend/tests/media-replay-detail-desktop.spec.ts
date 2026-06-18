import { expect, test } from '@playwright/test';

const user = {
  user_id: 'user_media_replay',
  email: 'media-replay@example.com',
  username: 'mediareplay',
  profile_picture: '',
  bio: 'PC media replay smoke profile',
  relationship_status: 'private',
  followers_count: 1,
  following_count: 2,
  posts_count: 4,
  trust_score: 100,
  role: 'user',
  banned_until: null,
};

const replayPost = {
  post_id: 'post_media_replay',
  user_id: user.user_id,
  username: user.username,
  profile_picture: '',
  text: 'Tallenne: #MediaSmoke',
  title: 'Tallenne: #MediaSmoke',
  image: 'https://example.com/replay-thumb.jpg',
  video: 'https://example.com/replay.webm',
  videoUrl: 'https://example.com/replay.webm',
  media_url: 'https://example.com/replay.webm',
  thumbnailUrl: 'https://example.com/replay-thumb.jpg',
  thumbnail_url: 'https://example.com/replay-thumb.jpg',
  duration: 191,
  visibility: 'public',
  pinned_to_profile: false,
  type: 'live_recording',
  source: 'live_replay',
  status: 'ready',
  is_clip: false,
  likes_count: 8,
  comments_count: 3,
  views: 124,
  watch_time: 540,
  completion_rate: 72,
  replay_count: 11,
  is_liked: false,
  is_bookmarked: false,
  comments: [],
  hashtags: ['#mediasmoke'],
  mentions: [],
  created_at: '2026-06-17T12:00:00.000Z',
};

test('desktop media live replay opens a playable post detail', async ({ page }, testInfo) => {
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
      text.includes('Live signaling socket error:') ||
      text.includes('[video-playback] error {label: media-card, postId: post_media_replay');

    if (text.includes('[post-actions]')) actionLogs.push(text);
    if (message.type() === 'error' && !expectedMockNoise) {
      consoleErrors.push(text);
    }
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
    if (path === '/media/posts') return json([replayPost]);
    if (path === '/posts/post_media_replay') return json(replayPost);
    if (path === '/posts/post_media_replay/comments') return json([]);
    if (path === '/posts/post_media_replay/video-analytics') return json({ ok: true });
    return json({});
  });

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'pc-media-token');
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
  await page.goto('/media', { waitUntil: 'networkidle' });

  await expect(page.locator('body')).toContainText('Mediavirta');
  await expect(page.locator('body')).toContainText('LIVE REPLAY');
  await expect(page.locator('body')).toContainText('Tallenne: #MediaSmoke');

  await page.getByLabel('Jaa julkaisu').first().click();
  await expect(page).toHaveURL(/\/media/);
  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __copiedPostUrl?: string }).__copiedPostUrl)).toContain('/posts/post_media_replay');
  await expect(page.getByText('Linkki kopioitu')).toBeVisible();
  await expect.poll(() => Promise.resolve(actionLogs.some((line) => line.includes('share clicked')))).toBe(true);

  const overflowMedia = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflowMedia).toBe(false);

  await page.getByText('Tallenne: #MediaSmoke').first().click();
  await expect(page).toHaveURL(/\/posts\/post_media_replay/);
  await expect(page.locator('body')).toContainText('3 min live');
  await expect(page.locator('body')).toContainText('124 Views');
  await expect(page.locator('video')).toHaveAttribute('src', 'https://example.com/replay.webm');

  await page.getByLabel('Avaa julkaisun toimintovalikko').first().click();
  await expect(page.getByText('Edit post')).toBeVisible();
  await expect(page.getByText('Copy link')).toBeVisible();
  await page.getByText('Copy link').click();
  await expect(page.getByText('Linkki kopioitu')).toBeVisible();

  await page.getByLabel('Jaa julkaisu').first().click();
  await expect(page.getByText('Linkki kopioitu')).toBeVisible();
  await expect.poll(() => Promise.resolve(actionLogs.some((line) => line.includes('menu opened')))).toBe(true);
  await expect.poll(() => Promise.resolve(actionLogs.some((line) => line.includes('copied link')))).toBe(true);

  const overflowDetail = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflowDetail).toBe(false);
  expect(badResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
