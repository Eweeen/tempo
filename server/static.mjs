import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const compress = promisify(gzip);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const inside = (root, path) => {
  const local = relative(root, path);
  return local !== '..' && !local.startsWith('../') && !isAbsolute(local);
};

/** Serve only build output. API requests never fall back to the application. */
export async function serveApplication(req, res, pathname, directory) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let path;
  try { path = decodeURIComponent(pathname); }
  catch { res.writeHead(400).end(); return; }
  if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) {
    res.writeHead(404).end();
    return;
  }
  const root = await realpath(directory);
  let file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (!inside(root, file)) { res.writeHead(404).end(); return; }
  try {
    file = await realpath(file);
    if (!inside(root, file) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    if (extname(path) || path.startsWith('/assets/')) { res.writeHead(404).end(); return; }
    file = await realpath(resolve(root, 'index.html'));
    if (!inside(root, file)) { res.writeHead(404).end(); return; }
  }
  const type = types[extname(file)] || 'application/octet-stream';
  let body = await readFile(file);
  if (body.length >= 1024 && /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/.test(type)) {
    res.setHeader('Vary', 'Accept-Encoding');
    const acceptsGzip = (req.headers['accept-encoding'] || '').split(',').some(value => {
      const [encoding, ...parameters] = value.trim().split(';');
      const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
      return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
    });
    if (acceptsGzip) {
      body = await compress(body);
      res.setHeader('Content-Encoding', 'gzip');
    }
  }
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', path === '/sw.js' ? 'no-store'
    : path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}
