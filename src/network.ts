import http, { type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { serveFile } from '../bin/serve.mjs';
import type { Project } from './config.js';

export async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Cannot bind to loopback.');
  return 'http://127.0.0.1:' + address.port;
}
export async function close(server: Server) {
  const closed = new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  server.closeAllConnections();
  await closed;
}
export async function startLive(project: Project) {
  const reservation = http.createServer();
  const origin = await listen(reservation);
  await close(reservation);
  const port = new URL(origin).port;
  const [cmd, ...args] = project.config.server.command;
  const child = spawn(cmd === 'node' ? process.execPath : cmd!, args, {
    cwd: project.root,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, PORT: port, SPECHATCH_PORT: port },
  });
  let log = '';
  let failure: Error | undefined;
  child.stdout.on('data', (chunk) => {
    log = (log + chunk).slice(-2000);
  });
  child.stderr.on('data', (chunk) => {
    log = (log + chunk).slice(-2000);
  });
  child.once('error', (e) => {
    failure = e;
  });
  const exit = new Promise<void>((resolve) => child.once('close', () => resolve()));
  function terminate(signal: NodeJS.Signals) {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      /* Already stopped. */
    }
  }
  async function stop() {
    terminate('SIGTERM');
    if (
      (await Promise.race([exit.then(() => true), delay(900, false, { ref: false })])) === false
    ) {
      terminate('SIGKILL');
      await exit;
    }
    // Confirm that the managed listener disappeared before accepting any static result.
    const stillUp = await fetch(origin + project.config.server.readyPath, {
      signal: AbortSignal.timeout(700),
    }).then(
      () => true,
      () => false,
    );
    if (stillUp) throw Error('Managed backend is still listening after shutdown.');
  }
  try {
    const until = Date.now() + project.config.server.timeoutMs;
    while (Date.now() < until) {
      if (failure) throw failure;
      if (child.exitCode !== null || child.signalCode)
        throw Error('Server exited before readiness. ' + log);
      if (
        await fetch(origin + project.config.server.readyPath, {
          signal: AbortSignal.timeout(600),
        }).then(
          (r) => r.ok,
          () => false,
        )
      )
        return { origin, stop };
      await delay(90);
    }
    throw Error('Server readiness timed out. Bind your app to SPECHATCH_PORT. ' + log);
  } catch (e) {
    await stop();
    throw e;
  }
}

export type Audit = { kind: 'route' | 'miss'; method: string; path: string; status: number };
export async function startVerifier(root: string, mount = '/') {
  const audit: Audit[] = [];
  const denied = new Set<string>();
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (!pathname.startsWith(mount)) {
        denied.add(req.method + ' ' + pathname);
        res.writeHead(404).end();
        return;
      }
      const name = '/' + pathname.slice(mount.length);
      if (name === '/__spechatch/audit' && req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const item = JSON.parse(Buffer.concat(chunks).toString()) as Audit;
        if (!['route', 'miss'].includes(item.kind) || typeof item.path !== 'string') {
          res.writeHead(400).end();
          return;
        }
        audit.push(item);
        res.writeHead(204).end();
        return;
      }
      res.once('finish', () => {
        if (res.statusCode >= 400) denied.add(req.method + ' ' + pathname);
      });
      await serveFile(root, name, req, res, { 'X-SpecHatch-Audit': '1' });
    } catch {
      res.writeHead(400).end();
    }
  });
  const origin = await listen(server);
  const allowed = new URL(origin);
  // Explicit loopback proxy: even an absolute URL to a different localhost backend is rejected.
  const proxy = http.createServer((req, res) => {
    try {
      const target = new URL(req.url || '');
      if (target.origin !== origin) {
        denied.add(req.method + ' ' + target.origin);
        res.writeHead(403).end();
        return;
      }
      const upstream = http.request(
        {
          hostname: allowed.hostname,
          port: allowed.port,
          path: target.pathname + target.search,
          method: req.method,
          headers: { ...req.headers, host: allowed.host },
        },
        (remote) => {
          res.writeHead(remote.statusCode || 502, remote.headers);
          remote.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    } catch {
      res.writeHead(400).end();
    }
  });
  proxy.on('connect', (req, socket) => {
    denied.add('CONNECT ' + req.url);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  let proxyURL;
  try {
    proxyURL = await listen(proxy);
  } catch (e) {
    await close(server);
    throw e;
  }
  return {
    baseURL: origin + mount,
    proxy: proxyURL,
    audit,
    denied,
    stop: async () => {
      await Promise.all([close(proxy), close(server)]);
    },
  };
}
