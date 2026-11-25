import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../dist/config.js';
import { withOutput, checkBundle, bundle } from '../dist/bundle.js';
import { captureSeed } from '../dist/seed.js';
import { listen, close } from '../dist/network.js';
import sample from '../examples/relay/spechatch.config.mjs';

test('capture projects scalar fields before they reach disk and rejects duplicate identities', async () => {
  const c = validateConfig(sample);
  const row = {
    id: 1,
    title: 'One',
    status: 'Backlog',
    priority: 'Normal',
    area: 'Product',
    private: 'NEVER_EXPORT',
  };
  let data = [row];
  const server = createServer((req, res) => {
    res.setHeader('Set-Cookie', 'session=NEVER_EXPORT');
    res.end(
      JSON.stringify(
        req.url === '/api/workspace'
          ? { team: 'Docs', cycle: '02', goal: 'Publish', private: 'NEVER_EXPORT' }
          : data,
      ),
    );
  });
  const origin = await listen(server);
  try {
    const seed = await captureSeed(c, origin);
    assert.ok(!JSON.stringify(seed).includes('NEVER_EXPORT'));
    data = [row, row];
    await assert.rejects(captureSeed(c, origin), /Duplicate seed ID/);
    data = [{ ...row, title: { nested: 'x' } }];
    await assert.rejects(captureSeed(c, origin), /scalar/);
  } finally {
    await close(server);
  }
});

test('a failed candidate preserves the previous output; changed or unrelated files are never overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spechatch-output-'));
  const config = validateConfig({ ...sample, buildDir: 'web', testDir: 'tests' });
  const project = { config, root, file: join(root, 'config.mjs') };
  const out = join(root, 'published');
  try {
    await mkdir(join(root, 'tests'));
    await mkdir(join(root, 'web'));
    await writeFile(
      join(root, 'web/index.html'),
      '<!doctype html><html><head></head><body>Demo</body></html>',
    );
    await withOutput(project, out, async (stage) => {
      await bundle(project, { resources: {}, reads: {} }, stage);
    });
    const first = await readFile(join(out, '__spechatch/inventory.json'), 'utf8');
    await assert.rejects(
      withOutput(project, out, async () => {
        throw Error('intentional regression');
      }),
      /intentional regression/,
    );
    assert.equal(await readFile(join(out, '__spechatch/inventory.json'), 'utf8'), first);
    await checkBundle(out);
    const unknown = join(root, 'other');
    await mkdir(unknown);
    await writeFile(join(unknown, 'notes.txt'), 'keep me');
    await assert.rejects(
      withOutput(project, unknown, async () => {}),
      /unrecognized/,
    );
    assert.equal(await readFile(join(unknown, 'notes.txt'), 'utf8'), 'keep me');
    await cp(out, join(root, 'copy'), { recursive: true });
    await writeFile(join(root, 'copy/index.html'), 'modified');
    await assert.rejects(checkBundle(join(root, 'copy')), /bytes changed/);
    await assert.rejects(
      withOutput(project, join(root, 'web/child'), async () => {}),
      /separate/,
    );
    await access(join(out, 'spechatch-sw.js'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
