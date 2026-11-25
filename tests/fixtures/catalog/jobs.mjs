import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('./web/', import.meta.url);
createServer(async (req, res) => {
  if (req.url === '/ready') {
    res.end('ok');
    return;
  }
  if (req.url === '/v2/book') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ title: 'The Quiet Shelf', privateNote: 'NEVER_EXPORT' }));
    return;
  }
  if (req.url === '/v2/bonus') {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"available":true}');
    return;
  }
  if (!['/', '/client.js'].includes(req.url)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'text/javascript');
  res.end(await readFile(new URL(req.url === '/' ? 'index.html' : 'client.js', root)));
}).listen(Number(process.env.PORT), '127.0.0.1');
