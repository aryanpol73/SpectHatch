import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtemp, cp, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/catalog/', import.meta.url));

test(
  'an unrelated plain-JS app exports; a missed route fails even if the UI test passes',
  { timeout: 120000 },
  async () => {
    // The temporary consumer is underneath the checkout so its original spec can resolve @playwright/test.
    const project = await mkdtemp(join(root, '.spechatch-consumer-'));
    try {
      await cp(fixture, project, { recursive: true });
      const out = join(project, 'site');
      const args = [
        join(root, 'dist/cli.js'),
        'build',
        '--config',
        join(project, 'config.mjs'),
        '--out',
        out,
      ];
      await exec(process.execPath, args);
      const receiptPath = join(out, '__spechatch/receipt.json');
      const receipt = await readFile(receiptPath, 'utf8');
      assert.equal(JSON.parse(receipt).tests[0].title, 'Open the catalog');
      assert.ok(
        !(await readFile(join(out, '__spechatch/contract.json'), 'utf8')).includes('NEVER_EXPORT'),
      );
      const script = join(project, 'web/client.js');
      const original = await readFile(script, 'utf8');
      // Both apps perform this request and ignore the payload. All UI assertions still pass.
      await writeFile(script, "await fetch('/v2/bonus');\n" + original);
      await assert.rejects(exec(process.execPath, args), (error) => {
        assert.match(error.stderr, /Unexpected requests during replay/);
        assert.match(error.stderr, /GET \/v2\/bonus/);
        return true;
      });
      assert.equal(await readFile(receiptPath, 'utf8'), receipt);
      // A modified passing spec must never be attributed to an earlier live run.
      await appendFile(join(project, 'spec/catalog.spec.ts'), '\n// changed after capture\n');
      const verify = [...args];
      verify[1] = 'verify';
      await assert.rejects(exec(process.execPath, verify), (error) => {
        assert.match(error.stderr, /identities differ/);
        return true;
      });
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  },
);
