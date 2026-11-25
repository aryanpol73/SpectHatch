import { test, expect } from '@playwright/test';
test('Open the catalog', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Quiet Shelf' })).toBeVisible();
});
