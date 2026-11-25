import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, relative, join } from 'node:path';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { Project } from './config.js';

export type TestCase = {
  title: string;
  file: string;
  line: number;
  sourceHash: string;
  duration: number;
};
type Suite = {
  title: string;
  suites?: Suite[];
  specs?: {
    title: string;
    file: string;
    line: number;
    tests: {
      expectedStatus: string;
      results: { status: string; duration: number; errors?: { message?: string }[] }[];
    }[];
  }[];
};
export async function runTests(
  project: Project,
  baseURL: string,
  proxy?: string,
): Promise<TestCase[]> {
  const temp = await mkdtemp(join(tmpdir(), 'spechatch-run-'));
  const outputFile = join(temp, 'report.json');
  const testDir = resolve(project.root, project.config.testDir);
  const localRequire = createRequire(project.file);
  let runner;
  try {
    runner = localRequire.resolve('@playwright/test/cli');
  } catch {
    runner = createRequire(import.meta.url).resolve('@playwright/test/cli');
  }
  const config = {
    testDir,
    testMatch: project.config.testMatch,
    retries: 0,
    repeatEach: 1,
    forbidOnly: true,
    workers: 1,
    globalTimeout: 150000,
    timeout: 30000,
    outputDir: join(temp, 'results'),
    reporter: [['list'], ['json', { outputFile }]],
    use: {
      browserName: 'chromium',
      baseURL,
      headless: true,
      launchOptions: { executablePath: process.env.SPECHATCH_CHROMIUM_PATH || undefined },
      ...(proxy ? { proxy: { server: proxy, bypass: '<-loopback>' } } : {}),
    },
  };
  try {
    const path = join(temp, 'playwright.config.cjs');
    await writeFile(path, 'module.exports = ' + JSON.stringify(config));
    const status = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [runner, 'test', '--config', path], {
        cwd: project.root,
        env: process.env,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', resolve);
    });
    if (status !== 0) throw Error('Playwright failed. See the failing assertion above.');
    const report = JSON.parse(await readFile(outputFile, 'utf8'));
    const cases: TestCase[] = [];
    async function walk(suite: Suite, parents: string[]) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests) {
          const result = test.results[0];
          if (
            test.expectedStatus !== 'passed' ||
            test.results.length !== 1 ||
            result?.status !== 'passed'
          )
            throw Error('Every selected test must pass without skips or retries: ' + spec.title);
          const file = resolve(testDir, spec.file);
          const sourceHash = createHash('sha256')
            .update(await readFile(file))
            .digest('hex');
          cases.push({
            title: [...parents, spec.title].join(' › '),
            file: relative(testDir, file).replaceAll('\\', '/'),
            line: spec.line,
            sourceHash,
            duration: result.duration,
          });
        }
      }
      for (const sub of suite.suites || []) await walk(sub, [...parents, sub.title]);
    }
    for (const suite of report.suites as Suite[]) await walk(suite, []);
    if (!cases.length) throw Error('No passing Playwright tests selected.');
    return cases;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
export function testKey(t: Omit<TestCase, 'duration'>) {
  return JSON.stringify([t.file, t.line, t.title, t.sourceHash]);
}
