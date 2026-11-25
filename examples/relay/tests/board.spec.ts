import { test, expect } from '@playwright/test';

// These tests import no SpecHatch helpers and run against both base URLs.
test('Create an issue, move it to Done, and reload', async ({ page }) => {
  const title = 'Keyboard review ' + crypto.randomUUID().slice(0, 8);
  await page.goto('./');
  await page.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await dialog.getByLabel('Description').fill('Review the release with the keyboard.');
  await dialog.getByRole('button', { name: 'Create issue' }).click();
  const backlog = page.getByRole('region', { name: 'Backlog', exact: true });
  await backlog.getByRole('button', { name: new RegExp(title) }).click();
  await dialog.getByLabel('Status').selectOption('Done');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  const done = page.getByRole('region', { name: 'Done', exact: true });
  await expect(done.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  await page.reload();
  await expect(done.getByRole('button', { name: new RegExp(title) })).toBeVisible();
});

test('Search and filter seeded issues', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Filter by priority').selectOption('High');
  await expect(page.getByRole('button', { name: /Add keyboard shortcuts/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Document retry behavior/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search issues' }).fill('setup');
  await expect(page.getByRole('button', { name: /Simplify account setup/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add keyboard shortcuts/ })).toHaveCount(0);
});

test('Delete an issue and keep it deleted after reload', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Refresh the welcome screen/ }).click();
  await page.getByRole('button', { name: 'Delete issue' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /Restore filter preferences/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Refresh the welcome screen/ })).toHaveCount(0);
});
