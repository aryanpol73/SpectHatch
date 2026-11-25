#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
export async function serveFile(root, pathname, req, res, extraHeaders = {}) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405).end();
    return;
  }
  try {
    const name = decodeURIComponent(pathname);
    if (
      name.includes('\\') ||
      name.includes('\0') ||
      name.split('/').some((s) => s.startsWith('.'))
    )
      throw Error();
    const base = await realpath(root);
    const file = await realpath(
      resolve(base, '.' + (name.endsWith('/') ? name + 'index.html' : name)),
    );
    const rel = relative(base, file);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel === '..' ||
      rel.startsWith('..' + sep) ||
      !(await stat(file)).isFile()
    )
      throw Error();
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end('File not found');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] || 'demo');
  const port = Number(process.argv[3] || process.env.PORT || 4173);
  await stat(resolve(root, 'index.html')).catch(() => {
    throw Error('No static export in ' + root + '. Run npm run demo first.');
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    void serveFile(root, url.pathname, req, res);
  });
  server.on('error', (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () =>
    console.log('SpecHatch demo  http://127.0.0.1:' + server.address().port + '/'),
  );
}
