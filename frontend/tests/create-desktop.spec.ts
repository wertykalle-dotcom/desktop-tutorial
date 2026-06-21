import { expect, test } from '@playwright/test';

const user = {
  user_id: 'create_desktop_user',
  email: 'create-desktop@example.com',
  username: 'createdesktop',
  followers_count: 12,
  following_count: 5,
  posts_count: 8,
  role: 'user',
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
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );
};

test('desktop create page shows composer and live preview without overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop-only create smoke coverage.');

  await page.addInitScript(() => localStorage.setItem('auth_token', 'create-desktop-token'));
  await mockAuthenticatedApi(page);
  await page.goto('/create', { waitUntil: 'networkidle' });

  await expect(page.locator('body')).toContainText(/YOSLA Studio/i);
  await expect(page.locator('body')).toContainText('Sisältö');
  await expect(page.locator('body')).toContainText('Esikatselu');

  await page.getByPlaceholder('Kirjoita jotain...').fill('PC-polish julkaisu YOSLAan');
  await expect(page.locator('body')).toContainText('PC-polish julkaisu YOSLAan');

  const dropZone = page.locator('#create-media-dropzone');
  const droppedFile = await page.evaluateHandle(() => {
    const dataTransfer = new DataTransfer();
    const file = new File(['yosla-test-image'], 'yosla-drop-test.png', { type: 'image/png' });
    dataTransfer.items.add(file);
    return dataTransfer;
  });
  await dropZone.dispatchEvent('drop', { dataTransfer: droppedFile });
  await expect(page.locator('body')).toContainText('yosla-drop-test.png');
  expect(page.url()).toContain('/create');

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(hasOverflow).toBe(false);
});
