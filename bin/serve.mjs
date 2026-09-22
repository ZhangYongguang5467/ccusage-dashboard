#!/usr/bin/env node
// Minimal static server used when nginx is not available (macOS, containers, …).
// Serves ../www with the same routes as the nginx template: /healthz, /data/*.json (no-store).
//   PORT=8090 HOST=127.0.0.1 node bin/serve.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'www');
const PORT = +(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok\n'); }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found\n'); }
    const ext = path.extname(file);
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': rel.startsWith('/data/') ? 'no-store' : 'no-cache' };
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && (ext === '.json' || ext === '.html' || ext === '.js' || ext === '.css') && st.size > 1024;
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    const stream = fs.createReadStream(file);
    (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
  });
}).listen(PORT, HOST, () => console.log(`serving ${ROOT} on http://${HOST}:${PORT}/`));
