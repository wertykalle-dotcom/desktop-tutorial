import { expect, test } from '@playwright/test';

test('feed shell loads from the local YOSLA build', async ({ page }) => {
  await page.goto('/feed');
  await expect(page.locator('body')).toContainText(/YOSLA|Kirjaudu|Feed|LIVE|Mediavirta/i);
});

test('settings/account health route renders without horizontal overflow', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('body')).toContainText(/YOSLA|Kirjaudu|Asetukset|Account Health|Tilin luotettavuus/i);

  const hasHorizontalOverflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > window.innerWidth + 2;
  });

  expect(hasHorizontalOverflow).toBe(false);
});
