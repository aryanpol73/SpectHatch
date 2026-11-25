import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { listen, close } from '../../dist/network.js';
import { serveFile } from '../../bin/serve.mjs';

const root = fileURLToPath(new URL('../../demo/', import.meta.url));
test('export survives offline reload, serializes concurrent writes, isolates visitors, resets, and renders its receipt', async () => {
  const server = createServer((req, res) =>
    serveFile(root, new URL(req.url, 'http://local').pathname, req, res),
  );
  const origin = await listen(server);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.SPECHATCH_CHROMIUM_PATH || undefined,
    });
    const one = await browser.newContext();
    const tab = await one.newPage();
    await tab.goto(origin);
    await expect(tab.getByRole('button', { name: /Tighten the empty state/ })).toBeVisible();
    const secondTab = await one.newPage();
    await secondTab.goto(origin);
    await expect(secondTab.getByRole('button', { name: /Tighten the empty state/ })).toBeVisible();
    const create = (page, title) =>
      page.evaluate(
        async (text) =>
          (
            await fetch('/api/issues', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: text }),
            })
          ).json(),
        title,
      );
    const created = await Promise.all([
      create(tab, 'One-tab write'),
      create(secondTab, 'Two-tab write'),
    ]);
    assert.equal(new Set(created.map((row) => row.id)).size, 2);
    await one.setOffline(true);
    await tab.reload();
    await expect(tab.getByRole('button', { name: /One-tab write/ })).toBeVisible();
    await expect(tab.getByRole('button', { name: /Two-tab write/ })).toBeVisible();
    const offlineRow = await create(tab, 'Created without a network');
    assert.equal(offlineRow.title, 'Created without a network');
    await one.setOffline(false);
    const two = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const visitor = await two.newPage();
    await visitor.goto(origin);
    await expect(visitor.getByRole('button', { name: /Tighten the empty state/ })).toBeVisible();
    await expect(visitor.getByRole('button', { name: /One-tab write/ })).toHaveCount(0);
    assert.equal(
      await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await visitor.getByRole('link', { name: /Build receipt/ }).click();
    await expect(visitor.getByRole('heading', { name: 'Verified workflows' })).toBeVisible();
    await expect(
      visitor.getByRole('cell', { name: /Create an issue, move it to Done/ }),
    ).toBeVisible();
    tab.once('dialog', (dialog) => dialog.accept());
    await tab.getByRole('button', { name: 'Reset demo' }).click();
    await expect(tab.getByRole('button', { name: /Tighten the empty state/ })).toBeVisible();
    await expect(tab.getByRole('button', { name: /One-tab write/ })).toHaveCount(0);
    assert.equal(await tab.evaluate(async () => (await fetch('/api/unmodeled')).status), 501);
    await expect(tab.getByText(/This action is outside the demo/)).toBeVisible();
  } finally {
    await browser?.close();
    await close(server);
  }
});
