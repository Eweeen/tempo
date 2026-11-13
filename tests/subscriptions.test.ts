import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSubscriptionServer } from '../server/subscriptions.mjs';

const calendar = (title = 'Rendez-vous') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:stable@tempo.local\r\nDTSTAMP:20261113T120000Z\r\nDTSTART:20261114T090000Z\r\nDTEND:20261114T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('private calendar subscription service', () => {
  let directory: string;
  let server: ReturnType<typeof createSubscriptionServer>;
  let base: string;
  let key: string;
  const headers = () => ({ Authorization: `Bearer ${key}`, 'X-Tempo-Subscription': '1', 'Content-Type': 'text/calendar' });
  const publish = (body = calendar()) => fetch(`${base}/api/subscription`, { method: 'PUT', headers: headers(), body });
  const start = async (options = {}) => {
    server = createSubscriptionServer({ directory, ...options });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const close = () => new Promise<void>((resolve, reject) => {
    if (!server.listening) { resolve(); return; }
    server.close((error: Error | undefined) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tempo-subscription-test-'));
    key = randomBytes(32).toString('hex');
    await start();
  });
  afterEach(async () => { await close(); await rm(directory, { recursive: true, force: true }); });

  it('serves an Apple-compatible feed and HEAD with cache validation, without exposing the write key', async () => {
    const response = await publish();
    expect(response.status).toBe(200);
    const { path } = await response.json();
    expect(path).not.toContain(key);
    const feed = await fetch(base + path);
    expect(feed.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(feed.headers.get('cache-control')).toContain('private');
    expect(await feed.text()).toBe(calendar());
    const head = await fetch(base + path, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(calendar())));
    expect(await head.text()).toBe('');
    const cached = await fetch(base + path, { headers: { 'If-None-Match': feed.headers.get('etag')! } });
    expect(cached.status).toBe(304);
  });

  it('updates the same feed, survives restart and publishes an empty calendar after the last deletion', async () => {
    const { path } = await (await publish()).json();
    const original = await fetch(base + path);
    expect((await (await publish(calendar('Modifié'))).json()).path).toBe(path);
    await close();
    await start();
    const updated = await fetch(base + path, { headers: { 'If-None-Match': original.headers.get('etag')! } });
    expect(updated.status).toBe(200);
    expect(await updated.text()).toContain('SUMMARY:Modifié');
    const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    expect((await publish(empty)).status).toBe(200);
    expect(await (await fetch(base + path)).text()).not.toContain('VEVENT');
  });

  it('keeps the read capability from changing or revoking the original feed', async () => {
    const { path } = await (await publish()).json();
    key = path.split('/').at(-1).slice(0, -4);
    expect((await fetch(base + path, { method: 'PUT', headers: headers(), body: calendar('Intrus') })).status).toBe(404);
    await fetch(`${base}/api/subscription`, { method: 'DELETE', headers: headers() });
    await publish(calendar('Un autre calendrier'));
    expect(await (await fetch(base + path)).text()).toBe(calendar());
  });

  it('revokes access and rejects a delayed upload with the old publication key', async () => {
    const { path } = await (await publish()).json();
    expect((await fetch(`${base}/api/subscription`, { method: 'DELETE', headers: headers() })).status).toBe(204);
    expect((await fetch(base + path)).status).toBe(404);
    expect((await publish()).status).toBe(410);
    expect((await fetch(`${base}/api/subscription`, { method: 'DELETE', headers: headers() })).status).toBe(204);
  });

  it('rejects missing authorization, cross-site writes, invalid calendars and unknown routes', async () => {
    expect((await fetch(`${base}/api/subscription`, { method: 'PUT', body: calendar() })).status).toBe(401);
    expect((await fetch(`${base}/api/subscription`, { method: 'PUT', headers: { ...headers(), 'Sec-Fetch-Site': 'cross-site' }, body: calendar() })).status).toBe(403);
    expect((await publish('<html>error</html>')).status).toBe(400);
    expect((await fetch(`${base}/api/calendars/unknown.ics`)).status).toBe(404);
    expect((await fetch(`${base}/api/calendars/${'a'.repeat(64)}.ics`)).status).toBe(404);
  });

  it('enforces payload, storage and feed-count limits without losing the previous calendar', async () => {
    await close();
    await start({ maxBytes: 1000, maxTotalBytes: 500, maxFeeds: 1 });
    const { path } = await (await publish()).json();
    expect((await publish(calendar('x'.repeat(1100)))).status).toBe(413);
    expect((await publish(calendar('x'.repeat(400)))).status).toBe(507);
    key = randomBytes(32).toString('hex');
    expect((await publish()).status).toBe(507);
    expect(await (await fetch(base + path)).text()).toBe(calendar());
  });

  it('limits write requests without restricting Apple read requests', async () => {
    await close();
    await start({ writeLimit: 1 });
    const { path } = await (await publish()).json();
    const rejected = await publish();
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('retry-after')).toBe('60');
    expect((await fetch(base + path)).status).toBe(200);
  });
});
