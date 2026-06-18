import { expect, test } from '@playwright/test';

const user = {
  user_id: 'mobile_layout_user',
  email: 'mobile-layout@example.com',
  username: 'mobilelayout',
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

const expectNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasOverflow).toBe(false);
};

const mockAuthenticatedApi = async (page: import('@playwright/test').Page) => {
  const fulfillUser = (route: Parameters<Parameters<typeof page.route>[1]>[0]) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });

  await page.route('**/api/auth/me', fulfillUser);
  await page.route('**/auth/me', fulfillUser);
  await page.route('**/api/users/me', fulfillUser);
  await page.route('**/users/me', fulfillUser);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const json = (payload: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

    if (path === '/notifications/unread-count') return json({ unread_count: 0 });
    if (path === '/messages') return json({ unread_count: 0, threads: [] });
    if (path === '/users/me/presence') return json({ last_active_at: '2026-06-18T12:00:00.000Z' });
    if (path === '/users/me/bookmarks') return json([]);
    if (path === '/media/posts') return json([]);
    if (path === '/growth/achievements') {
      return json({
        achievements: [],
        creator_level: { level: 1, name: 'Starter', score: 0, progress: 0 },
      });
    }
    if (path === '/growth/creator-level') return json({ level: 1, name: 'Starter', score: 0, progress: 0 });
    if (path === '/users/me/account-health') {
      return json({
        trust_score: 100,
        status: 'good',
        active_restrictions_count: 0,
        recovery_tip: 'OK',
        restricted_posts: [],
        recent_decisions: [],
      });
    }
    return json({});
  });
};

test.describe('mobile core layouts', () => {
  test('landing page uses the mobile YOSLA hero without overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile-only smoke coverage.');

    await page.route('**/api/homepage/config', (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto('/');

    await expect(page.locator('body')).toContainText('Tervetuloa YOSLA SOME LIFEEN');
    const hero = page.locator('img[alt*="YOSLA"]').first();
    await expect(hero).toBeVisible();
    await expect(hero).toHaveAttribute('src', /yosla-hero-mobile/);
    await expectNoHorizontalOverflow(page);
  });

  test('live, media, and profile recordings stay usable on mobile', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile-only smoke coverage.');

    await page.addInitScript(() => localStorage.setItem('auth_token', 'mobile-layout-token'));
    await mockAuthenticatedApi(page);

    await page.goto('/live');
    await expect(page.locator('body')).toContainText('LIVE NYT');
    await expect(page.locator('body')).toContainText('TULEVAT LIVET');
    await expectNoHorizontalOverflow(page);

    await page.goto('/media');
    await expect(page.locator('body')).toContainText('Ei mediajulkaisuja vielä');
    await expect(page.locator('body')).toContainText('Julkaise mediaa');
    await expectNoHorizontalOverflow(page);

    await page.goto('/profile');
    await page.getByText(/Recordings 0/).click();
    await expect(page.locator('body')).toContainText('Ei live-tallenteita vielä');
    await expect(page.locator('body')).toContainText('Avaa Mediavirta');
    await expectNoHorizontalOverflow(page);
  });
});
