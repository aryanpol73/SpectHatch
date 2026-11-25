import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { serveFile } from '../../bin/serve.mjs';
import { seedIssues, workspace } from './seed.mjs';

const rows = structuredClone(seedIssues);
let nextId = Math.max(...rows.map((row) => row.id)) + 1;
const root = fileURLToPath(new URL('./dist/', import.meta.url));
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}
async function payload(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return json(res, 200, { ready: true });
    if (url.pathname === '/api/workspace' && req.method === 'GET') return json(res, 200, workspace);
    const match = /^\/api\/issues(?:\/(\d+))?$/.exec(url.pathname);
    if (!match) return serveFile(root, url.pathname, req, res);
    const id = match[1] ? Number(match[1]) : null;
    const at = rows.findIndex((row) => row.id === id);
    if (id !== null && at < 0) return json(res, 404, { error: 'Issue not found.' });
    if (req.method === 'GET') {
      if (id !== null) return json(res, 200, rows[at]);
      const found = rows.filter((row) =>
        [...url.searchParams].every(
          ([key, value]) => ['status', 'priority'].includes(key) && row[key] === value,
        ),
      );
      return json(res, 200, found);
    }
    if (req.method === 'DELETE' && at >= 0) {
      rows.splice(at, 1);
      return json(res, 204);
    }
    const creating = req.method === 'POST' && id === null;
    if (!creating && !(req.method === 'PATCH' && at >= 0))
      return json(res, 405, { error: 'Unsupported method.' });
    const body = await payload(req);
    const start = creating
      ? { detail: '', status: 'Backlog', priority: 'Normal', area: 'Product' }
      : rows[at];
    const item = { ...start };
    for (const field of ['title', 'detail', 'status', 'priority', 'area']) {
      if (Object.hasOwn(body, field)) item[field] = body[field];
    }
    if (
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      typeof item.detail !== 'string' ||
      !['Backlog', 'In progress', 'Done'].includes(item.status) ||
      !['Normal', 'High'].includes(item.priority) ||
      !['Design', 'Platform', 'Product'].includes(item.area)
    ) {
      return json(res, 422, { error: 'Invalid issue fields.' });
    }
    if (creating) {
      item.id = nextId++;
      rows.push(item);
    } else rows[at] = item;
    json(res, creating ? 201 : 200, item);
  } catch {
    json(res, 400, { error: 'Invalid request.' });
  }
});
server.listen(Number(process.env.SPECHATCH_PORT || process.env.PORT || 4174), '127.0.0.1');
