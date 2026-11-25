import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  copyFile,
  rename,
  rm,
  mkdtemp,
  realpath,
} from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Project, Seed } from './config.js';

export const metadata = '__spechatch';
const runtime = fileURLToPath(new URL('../runtime/', import.meta.url));
export const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export function contains(parent: string, child: string) {
  const rel = relative(parent, child);
  return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
async function entries(root: string, sub = ''): Promise<string[]> {
  const results = [];
  for (const entry of await readdir(join(root, sub), { withFileTypes: true })) {
    const name = sub ? sub + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw Error('Symlinks cannot be bundled: ' + name);
    if (entry.isDirectory()) results.push(...(await entries(root, name)));
    else if (entry.isFile()) results.push(name);
    else throw Error('Expected a regular file: ' + name);
  }
  return results.sort();
}
const reserved = new Set([metadata, 'spechatch-app.html', 'spechatch-sw.js']);
export type Inventory = { format: 1; project: string; id: string; files: Record<string, string> };
export async function bundle(project: Project, seed: Seed, stage: string): Promise<Inventory> {
  const { config } = project;
  const src = resolve(project.root, config.buildDir);
  const meta = join(stage, metadata);
  await mkdir(meta);
  const list = await entries(src);
  if (!list.includes('index.html')) throw Error('Static build is missing index.html in ' + src);
  for (const path of list) {
    if (reserved.has(path.split('/')[0]!)) throw Error('Build uses a reserved file: ' + path);
    if (path === '.nojekyll' || path.endsWith('.map')) continue;
    if (path.split('/').some((n) => n.startsWith('.')) || /\.(pem|key|pfx)$/i.test(path))
      throw Error('Private or hidden build asset: ' + path);
    if (path === 'index.html') continue;
    await mkdir(dirname(join(stage, path)), { recursive: true });
    await copyFile(join(src, path), join(stage, path));
  }
  let app = await readFile(join(src, 'index.html'), 'utf8');
  if (!/<\/head\s*>/i.test(app) || !/<\/body\s*>/i.test(app))
    throw Error('index.html needs closing head and body tags.');
  const policy =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
  app = app.replace(
    /<head(?:\s[^>]*)?>/i,
    (head) =>
      head +
      '<meta http-equiv="Content-Security-Policy" content="' +
      policy +
      '"><script src="./__spechatch/guard.js"></script>',
  );
  app = app
    .replace(/<\/head\s*>/i, '<link rel="stylesheet" href="./__spechatch/bar.css"></head>')
    .replace(/<\/body\s*>/i, '<script type="module" src="./__spechatch/bar.mjs"></script></body>');
  await writeFile(join(stage, 'spechatch-app.html'), app);
  await copyFile(join(runtime, 'start.html'), join(stage, 'index.html'));
  for (const file of [
    'guard.js',
    'model.mjs',
    'start.mjs',
    'bar.mjs',
    'bar.css',
    'receipt.html',
    'receipt.mjs',
    'receipt.css',
  ]) {
    await copyFile(join(runtime, file), join(meta, file));
  }
  await writeFile(
    join(meta, 'contract.json'),
    json({ apiPrefix: config.apiPrefix, resources: config.resources, reads: config.reads, seed }),
  );
  const files: Record<string, string> = {};
  for (const name of await entries(stage)) files[name] = digest(await readFile(join(stage, name)));
  const template = await readFile(join(runtime, 'worker.mjs'), 'utf8');
  const id = digest(json(files) + template);
  const worker = template.replace(
    '__SPECHATCH_RELEASE__',
    JSON.stringify({ id, files: Object.keys(files) }),
  );
  await writeFile(join(stage, 'spechatch-sw.js'), worker);
  await writeFile(join(stage, '.nojekyll'), '');
  files['spechatch-sw.js'] = digest(worker);
  files['.nojekyll'] = digest('');
  const manifest: Inventory = { format: 1, project: config.name, id, files };
  await writeFile(join(meta, 'inventory.json'), json(manifest));
  return manifest;
}

export async function checkBundle(root: string): Promise<Inventory> {
  const manifest = JSON.parse(
    await readFile(join(root, metadata, 'inventory.json'), 'utf8'),
  ) as Inventory;
  if (manifest.format !== 1 || !manifest.files || !manifest.files['spechatch-sw.js'])
    throw Error('Invalid SpecHatch inventory.');
  const skip = new Set([metadata + '/inventory.json', metadata + '/receipt.json']);
  const actual = (await entries(root)).filter((file) => !skip.has(file));
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort()))
    throw Error('Exported file list changed since build.');
  for (const file of actual) {
    if (digest(await readFile(join(root, file))) !== manifest.files[file])
      throw Error('Exported bytes changed: ' + file);
  }
  return manifest;
}

export async function withOutput(
  project: Project,
  output: string,
  build: (stage: string) => Promise<void>,
) {
  const src = await realpath(resolve(project.root, project.config.buildDir));
  const tests = await realpath(resolve(project.root, project.config.testDir));
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  // Resolve parent symlinks before overlap checks. Existing output itself must be a real directory.
  const dest = join(await realpath(parent), relative(parent, output));
  if (
    contains(dest, project.root) ||
    contains(dest, src) ||
    contains(src, dest) ||
    contains(dest, tests) ||
    contains(tests, dest)
  )
    throw Error('Choose an output directory separate from the app build and tests.');
  const lock = dest + '.spechatch-lock';
  await mkdir(lock).catch(() => {
    throw Error('Output is locked by another build: ' + lock);
  });
  const temp = await mkdtemp(join(dirname(dest), '.spechatch-')).catch(async (e) => {
    await rm(lock, { recursive: true });
    throw e;
  });
  let preserveRecovery = false;
  try {
    const exists = await lstat(dest).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (exists) {
      if (!exists.isDirectory() || exists.isSymbolicLink())
        throw Error('Output must be a dedicated directory.');
      const previous = await checkBundle(dest).catch(() => {
        throw Error('Existing output is unrecognized or modified. Choose another --out directory.');
      });
      if (previous.project !== project.config.name)
        throw Error('Existing output belongs to another project.');
    }
    const stage = join(temp, 'candidate');
    await mkdir(stage);
    await build(stage);
    const backup = join(temp, 'previous');
    if (exists) await rename(dest, backup);
    try {
      await rename(stage, dest);
    } catch (error) {
      if (exists) {
        try {
          await rename(backup, dest);
        } catch {
          preserveRecovery = true;
          throw Error('Could not restore previous export. It is preserved at ' + backup);
        }
      }
      throw error;
    }
  } finally {
    if (!preserveRecovery) await rm(temp, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
