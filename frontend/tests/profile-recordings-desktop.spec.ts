import { expect, test } from '@playwright/test';

const user = {
  user_id: 'user_pc_recordings',
  email: 'pc-recordings@example.com',
  username: 'pcrecordings',
  profile_picture: '',
  bio: 'PC recordings smoke profile',
  relationship_status: 'private',
  followers_count: 0,
  following_count: 0,
  posts_count: 3,
  trust_score: 100,
  role: 'user',
  banned_until: null,
};

const recordings = [
  {
    post_id: 'post_pinned_recording',
    user_id: user.user_id,
    username: user.username,
    text: 'Tallenne: #PCSmoke julkinen',
    title: 'Tallenne: #PCSmoke julkinen',
    image: '',
    video: 'https://example.com/public.webm',
    videoUrl: 'https://example.com/public.webm',
    thumbnailUrl: '',
    duration: 75,
    visibility: 'public',
    pinned_to_profile: true,
    type: 'live_recording',
    source: 'live_replay',
    status: 'ready',
    is_clip: false,
    likes_count: 4,
    comments_count: 2,
    views: 24,
    replay_count: 6,
    is_liked: false,
    is_bookmarked: false,
    comments: [],
    created_at: '2026-06-17T12:00:00.000Z',
  },
  {
    post_id: 'post_private_recording',
    user_id: user.user_id,
    username: user.username,
    text: 'Tallenne: #PCSmoke yksityinen',
    title: 'Tallenne: #PCSmoke yksityinen',
    image: '',
    video: 'https://example.com/private.webm',
    videoUrl: 'https://example.com/private.webm',
    thumbnailUrl: '',
    duration: 45,
    visibility: 'private',
    pinned_to_profile: false,
    type: 'live_recording',
    source: 'live_replay',
    status: 'ready',
    is_clip: false,
    likes_count: 0,
    comments_count: 0,
    views: 0,
    replay_count: 0,
    is_liked: false,
    is_bookmarked: false,
    comments: [],
    created_at: '2026-06-17T12:05:00.000Z',
  },
];

test('desktop profile shows pinned and private live recordings cleanly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop-only PC web smoke coverage.');

  const badResponses: { status: number; url: string }[] = [];
  const consoleErrors: string[] = [];

  page.on('response', (response) => {
    if (response.status() >= 400) {
      badResponses.push({ status: response.status(), url: response.url() });
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
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
    if (path === '/users/me/presence') return json({ last_active_at: '2026-06-17T12:00:00.000Z' });
    if (path === '/users/me/bookmarks') return json([]);
    if (path === '/media/posts') return json(recordings);
    if (path === '/growth/achievements') {
      return json({
        achievements: [
          { achievement_id: 'first_post', title: 'Ensimmäinen julkaisu', icon: 'create-outline', progress: 100, unlocked: true },
          { achievement_id: 'live_replay', title: 'Live Replay avattu', icon: 'radio-outline', progress: 100, unlocked: true },
        ],
        creator_level: { level: 2, name: 'Rising Creator', score: 330, progress: 34 },
      });
    }
    if (path === '/growth/creator-level') return json({ level: 2, name: 'Rising Creator', score: 330, progress: 34 });
    if (path === '/users/me/account-health') {
      return json({
        trust_score: 100,
        status: 'good',
        active_restrictions_count: 0,
        recovery_tip: 'Tilisi on hyvässä kunnossa.',
        restricted_posts: [],
        recent_decisions: [],
      });
    }
    return json({});
  });

  await page.addInitScript(() => localStorage.setItem('auth_token', 'pc-recordings-token'));
  await page.goto('/profile', { waitUntil: 'networkidle' });

  await expect(page.locator('body')).toContainText('pcrecordings');
  await expect(page.locator('body')).toContainText('Kiinnitetyt replayt');
  await expect(page.locator('body')).toContainText('Tallenne: #PCSmoke julkinen');

  const overflowProfile = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflowProfile).toBe(false);

  await page.getByText(/Recordings 2/).click();
  await expect(page.locator('body')).toContainText('Tallenne: #PCSmoke yksityinen');
  await expect(page.locator('body')).toContainText('Kansikuva puuttuu');
  await expect(page.getByLabel('Yksityistä tallennetta ei voi jakaa linkillä').first()).toBeVisible();

  const overflowRecordings = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflowRecordings).toBe(false);
  expect(badResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
