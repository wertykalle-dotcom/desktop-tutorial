import { expect, test } from '@playwright/test';

const user = {
  user_id: 'saved_desktop_user',
  email: 'saved-desktop@example.com',
  username: 'saveddesktop',
  profile_picture: '',
  bio: '',
  relationship_status: 'private',
  followers_count: 12,
  following_count: 5,
  posts_count: 8,
  trust_score: 100,
  role: 'user',
  banned_until: null,
};

const savedPosts = [
  {
    post_id: 'saved_discussion',
    username: 'mira',
    text: 'Tallennettu keskustelu: miten YOSLA rakentuu seuraavaksi?',
    type: 'discussion',
    comments_count: 12,
    reaction_counts: { like: 4, fire: 2 },
    created_at: '2026-06-18T10:00:00.000Z',
  },
  {
    post_id: 'saved_live',
    username: 'livehost',
    text: 'Tallenne: #Luonto live aamusta',
    type: 'live_recording',
    source: 'live_replay',
    comments_count: 3,
    reaction_counts: { like: 9 },
    created_at: '2026-06-17T11:00:00.000Z',
  },
  {
    post_id: 'saved_poll',
    username: 'pollmaker',
    text: 'Kesän paras biisi?',
    type: 'poll',
    poll: { question: 'Kesän paras biisi?' },
    comments_count: 5,
    reaction_counts: { like: 1 },
    created_at: '2026-06-16T09:00:00.000Z',
  },
];

test('desktop saved page renders bookmark cards and filters without overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop-only saved smoke coverage.');

  await page.addInitScript(() => localStorage.setItem('auth_token', 'saved-desktop-token'));
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
    if (path === '/users/me/bookmarks') return json(savedPosts);
    if (path === '/notifications/unread-count') return json({ unread_count: 0 });
    if (path === '/messages') return json({ unread_count: 0, threads: [] });
    if (path === '/users/me/presence') return json({ last_active_at: '2026-06-18T12:00:00.000Z' });
    if (path === '/media/posts') return json([]);
    if (path === '/growth/achievements') return json({ achievements: [], creator_level: { level: 1, name: 'Starter', score: 0, progress: 0 } });
    if (path === '/growth/creator-level') return json({ level: 1, name: 'Starter', score: 0, progress: 0 });
    if (path === '/users/me/account-health') return json({ trust_score: 100, status: 'good', active_restrictions_count: 0, recovery_tip: 'OK', restricted_posts: [], recent_decisions: [] });
    return json({});
  });

  await page.goto('/saved', { waitUntil: 'networkidle' });

  await expect(page.locator('body')).toContainText('Tallennetut');
  await expect(page.locator('body')).toContainText('Tallennettu keskustelu');
  await expect(page.locator('body')).toContainText('Tallenne: #Luonto');
  await page.getByText('Livet').first().click();
  await expect(page.locator('body')).toContainText('Tallenne: #Luonto');

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasOverflow).toBe(false);
});
