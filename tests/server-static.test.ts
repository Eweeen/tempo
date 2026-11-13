import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSubscriptionServer } from '../server/subscriptions.mjs';

describe('single-container production server', () => {
  let directory: string;
  let origin: string;
  let server: ReturnType<typeof createSubscriptionServer>;
  const html = '<!doctype html><title>Tempo</title>';
  const script = '/* application bundle */\n'.repeat(100);
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tempo-static-test-'));
    const publicDirectory = join(directory, 'dist');
    await mkdir(join(publicDirectory, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(join(publicDirectory, 'index.html'), html),
      writeFile(join(publicDirectory, 'assets', 'index-hash.js'), script),
      writeFile(join(publicDirectory, 'assets', 'index-hash.css'), 'body { margin: 0; }'),
      writeFile(join(publicDirectory, 'sw.js'), 'self.addEventListener("fetch", () => {});'),
      writeFile(join(publicDirectory, 'manifest.webmanifest'), '{"name":"Tempo"}'),
      writeFile(join(publicDirectory, 'icon.png'), new Uint8Array([137, 80, 78, 71])),
      writeFile(join(directory, 'private.txt'), 'private calendar contents'),
      writeFile(join(publicDirectory, '.env'), 'must remain private'),
    ]);
    await symlink(join(directory, 'private.txt'), join(publicDirectory, 'escaped.txt'));
    server = createSubscriptionServer({ directory: join(directory, 'feeds'), staticDirectory: publicDirectory });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error: Error | undefined) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });

  it('serves the app and publishes a persistent subscription on the same port', async () => {
    expect(await (await fetch(origin)).text()).toBe(html);
    expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({ subscriptions: true });
    const key = randomBytes(32).toString('hex');
    const headers = { Authorization: `Bearer ${key}`, 'X-Tempo-Subscription': '1', 'Content-Type': 'text/calendar' };
    const body = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    const response = await fetch(`${origin}/api/subscription`, { method: 'PUT', headers, body });
    expect(response.status).toBe(200);
    const { path } = await response.json();
    expect(await (await fetch(origin + path)).text()).toBe(body);
    expect(await readFile(join(directory, 'feeds', path.split('/').at(-1)), 'utf8')).toBe(body);
  });

  it('revalidates HTML and PWA metadata and keeps fingerprinted assets immutable', async () => {
    const home = await fetch(origin);
    expect(home.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(home.headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(origin, { headers: { 'If-None-Match': home.headers.get('etag')! } })).status).toBe(304);
    const worker = await fetch(`${origin}/sw.js`);
    expect(worker.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(worker.headers.get('cache-control')).toBe('no-store');
    const manifest = await fetch(`${origin}/manifest.webmanifest`);
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
    const asset = await fetch(`${origin}/assets/index-hash.css`);
    expect(asset.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${origin}/icon.png`)).headers.get('content-type')).toBe('image/png');
  });

  it('compresses bundles only when gzip is accepted and supports HEAD without a body', async () => {
    const compressed = await fetch(`${origin}/assets/index-hash.js`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(compressed.headers.get('content-encoding')).toBe('gzip');
    expect(compressed.headers.get('vary')).toBe('Accept-Encoding');
    expect(await compressed.text()).toBe(script);
    const head = await fetch(`${origin}/assets/index-hash.js`, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip;q=0' } });
    expect(head.headers.get('content-encoding')).toBeNull();
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(script)));
    expect(await head.text()).toBe('');
  });

  it('falls back only for app navigation, never for API paths or missing assets', async () => {
    expect(await (await fetch(`${origin}/calendar/today?view=month`)).text()).toBe(html);
    for (const path of ['/api', '/api/missing', '/api/calendars/missing.ics', '/assets/missing.js', '/assets/missing', '/missing.css']) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('<!doctype html>');
      expect(response.headers.get('cache-control')).not.toContain('immutable');
    }
    expect((await fetch(origin, { method: 'POST', body: 'ignored' })).status).toBe(405);
  });

  it('rejects malformed paths, hidden files, traversal and symlinks outside the build directory', async () => {
    for (const path of ['/.env', '/%2eenv', '/%2e%2e%2fprivate.txt', '/%5c..%5cprivate.txt', '/escaped.txt', '/%00private.txt']) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('private');
    }
    expect((await fetch(`${origin}/%ZZ`)).status).toBe(400);
  });
});
