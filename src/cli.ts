#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { loadProject, type Project } from './config.js';
import { captureSeed } from './seed.js';
import { bundle, checkBundle, json, withOutput, metadata } from './bundle.js';
import { startLive, startVerifier } from './network.js';
import { runTests, testKey, type TestCase } from './run-tests.js';

const usage = `SpecHatch · verified static demos

  spechatch build  --config path/to/spechatch.config.mjs --out ./demo
  spechatch verify --config path/to/spechatch.config.mjs --out ./demo

build   Start the seeded app, run its spec, stop the backend, then verify and export.
verify  Validate the exported bytes and repeat its tests with only static files.

Paths on the command line are relative to the current directory.
Paths inside the config are relative to that config's directory.
Set SPECHATCH_CHROMIUM_PATH to use an installed Chromium executable.`;

async function replay(project: Project, root: string, liveCases: TestCase[]) {
  const server = await startVerifier(root, project.config.mountPath);
  try {
    console.log('\n[replay] Running against static files under ' + project.config.mountPath);
    let tests;
    try {
      tests = await runTests(project, server.baseURL, server.proxy);
    } finally {
      const misses = [
        ...server.denied,
        ...server.audit.filter((x) => x.kind === 'miss').map((x) => x.method + ' ' + x.path),
      ];
      if (misses.length)
        throw Error('Unexpected requests during replay:\n  ' + [...new Set(misses)].join('\n  '));
    }
    const live = new Map(liveCases.map((t) => [testKey(t), t]));
    if (tests.length !== live.size || tests.some((t) => !live.has(testKey(t))))
      throw Error(
        'Test files or selected test identities differ from the live run. Rebuild the demo.',
      );
    if (!server.audit.some((a) => a.kind === 'route'))
      throw Error('No contract-backed API request was exercised in replay.');
    const routes = new Map<string, { method: string; path: string; count: number }>();
    for (const a of server.audit) {
      const key = a.method + ' ' + a.path;
      const item = routes.get(key) || { method: a.method, path: a.path, count: 0 };
      item.count++;
      routes.set(key, item);
    }
    return {
      tests: tests.map((t) => ({
        title: t.title,
        file: t.file,
        line: t.line,
        sourceHash: t.sourceHash,
        liveMs: live.get(testKey(t))!.duration,
        replayMs: t.duration,
      })),
      requestCount: server.audit.length,
      misses: 0,
      routes: [...routes.values()].sort(
        (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      ),
    };
  } finally {
    await server.stop();
  }
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', default: 'spechatch.config.mjs' },
      out: { type: 'string', default: 'demo' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
  if (values.version) {
    console.log('0.1.0');
    return;
  }
  if (values.help || !positionals.length) {
    console.log(usage);
    return;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || !['build', 'verify'].includes(command!)) throw Error(usage);
  const project = await loadProject(values.config!);
  const output = resolve(values.out!);
  if (command === 'verify') {
    const manifest = await checkBundle(output);
    const receipt = JSON.parse(await readFile(join(output, metadata, 'receipt.json'), 'utf8'));
    if (receipt.buildId !== manifest.id || manifest.project !== project.config.name)
      throw Error('Receipt does not match this project and build.');
    const live: TestCase[] = receipt.tests.map((t: TestCase & { liveMs: number }) => ({
      ...t,
      duration: t.liveMs,
    }));
    const result = await replay(project, output, live);
    console.log(
      '\nVerified ' +
        result.tests.length +
        ' workflows and ' +
        result.requestCount +
        ' local API requests.',
    );
    return;
  }
  await withOutput(project, output, async (stage) => {
    console.log('[live] Starting an isolated, seeded app for ' + project.config.name);
    const live = await startLive(project);
    let seed, tests;
    try {
      seed = await captureSeed(project.config, live.origin);
      tests = await runTests(project, live.origin + '/');
    } finally {
      await live.stop();
    }
    console.log('[live] Backend stopped and its listener checked.');
    const manifest = await bundle(project, seed, stage);
    const result = await replay(project, stage, tests);
    const receipt = {
      schemaVersion: 1,
      project: project.config.name,
      buildId: manifest.id,
      verifiedAt: new Date().toISOString(),
      ...result,
    };
    await writeFile(join(stage, metadata, 'receipt.json'), json(receipt));
    await checkBundle(stage);
    console.log(
      '\nPassed ' +
        result.tests.length +
        ' workflows twice. ' +
        result.requestCount +
        ' replay API requests. Zero unexpected requests.',
    );
  });
  console.log('Export: ' + output);
}
main().catch((error) => {
  console.error('\nSpecHatch: ' + error.message);
  process.exitCode = 1;
});
