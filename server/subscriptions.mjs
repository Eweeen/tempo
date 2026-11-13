import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const exists = async (path) => stat(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

/** No Apple credentials: the read URL is a hash of a separate 256-bit write key. */
export function createSubscriptionServer({
  directory = resolve(process.env.TEMPO_FEED_DIR || '.tempo-feeds'),
  maxBytes = 10 * 1024 * 1024,
  maxTotalBytes = 100 * 1024 * 1024,
  maxFeeds = 1000,
  writeLimit = 120,
} = {}) {
  let queue = Promise.resolve();
  let windowStart = Date.now();
  let writes = 0;
  const serialized = (action) => {
    const pending = queue.then(action);
    queue = pending.catch(() => {});
    return pending;
  };
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/health' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"subscriptions":true}');
        return;
      }
      const match = /^\/api\/calendars\/([a-f0-9]{64})\.ics$/.exec(path);
      if (match && ['GET', 'HEAD'].includes(req.method)) {
        if (await exists(join(directory, `${match[1]}.revoked`))) throw fail(404, 'Abonnement introuvable.');
        const contents = await readFile(join(directory, `${match[1]}.ics`));
        const etag = `"${hash(contents)}"`;
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="tempo.ics"');
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304).end();
          return;
        }
        res.setHeader('Content-Length', contents.length);
        res.end(req.method === 'HEAD' ? undefined : contents);
        return;
      }
      if (path !== '/api/subscription' || !['PUT', 'DELETE'].includes(req.method))
        throw fail(404, 'Adresse introuvable.');
      // Custom header + no CORS prevents websites from publishing through a browser.
      const key = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
      if (!key || req.headers['x-tempo-subscription'] !== '1') throw fail(401, 'Clé de publication requise.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Origine refusée.');
      if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); writes = 0; }
      if (++writes > writeLimit) { res.setHeader('Retry-After', '60'); throw fail(429, 'Trop de publications. Réessayez dans une minute.'); }
      const id = hash(key);
      const file = join(directory, `${id}.ics`);
      const revoked = join(directory, `${id}.revoked`);
      let contents;
      if (req.method === 'PUT') {
        if (!/^text\/calendar(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Un calendrier .ics est requis.');
        if (Number(req.headers['content-length']) > maxBytes) throw fail(413, 'Le calendrier dépasse 10 Mo.');
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBytes) throw fail(413, 'Le calendrier dépasse 10 Mo.');
          chunks.push(chunk);
        }
        contents = Buffer.concat(chunks).toString('utf8');
        if (!contents.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') || !contents.endsWith('\r\nEND:VCALENDAR\r\n'))
          throw fail(400, 'Calendrier invalide.');
      }
      await serialized(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (req.method === 'DELETE') {
          if (!await exists(revoked)) {
            if (!await exists(file) && (await readdir(directory)).length >= maxFeeds)
              throw fail(507, 'Le stockage des abonnements est plein. Contactez l’hébergeur.');
            // Also revoke unpublished keys: a timed-out upload may still arrive.
            await writeFile(revoked, '', { mode: 0o600 });
          }
          await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
          return;
        }
        if (await exists(revoked)) throw fail(410, 'Cet abonnement a été révoqué. Désactivez-le puis créez un nouveau lien.');
        const entries = await readdir(directory);
        const currentSize = await stat(file).then(value => value.size, error => {
          if (error.code === 'ENOENT') return 0;
          throw error;
        });
        const sizes = await Promise.all(entries.filter(name => name.endsWith('.ics')).map(name => stat(join(directory, name)).then(value => value.size)));
        if ((!currentSize && entries.length >= maxFeeds) || sizes.reduce((a, b) => a + b, 0) - currentSize + Buffer.byteLength(contents) > maxTotalBytes)
          throw fail(507, 'Le stockage des abonnements est plein. Contactez l’hébergeur.');
        const temporary = join(directory, `${id}.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, contents, { mode: 0o600 });
          await rename(temporary, file);
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      });
      if (req.method === 'DELETE') res.writeHead(204).end();
      else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ path: `/api/calendars/${id}.ics` }));
      }
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : error.status || 500;
      // Never log bearer keys, feed URLs, or calendar contents.
      if (status === 500) console.error('Subscription service failure:', error.code || 'unknown');
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: status === 500 ? 'Publication indisponible. Réessayez plus tard.' : status === 404 ? 'Abonnement introuvable.' : error.message }));
      } else res.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.TEMPO_FEED_PORT || 3001);
  createSubscriptionServer().listen(port, process.env.TEMPO_FEED_HOST || '127.0.0.1', () => {
    console.log(`Tempo subscription service listening on port ${port}`);
  });
}
