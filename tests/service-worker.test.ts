import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const paths = ['/', '/index.html', '/assets/app-abc123.js', '/assets/app-abc123.css'];
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  .replace('__TEMPO_CACHE_NAME__', 'tempo-shell-current')
  .replace('/* __TEMPO_PRECACHE__ */ []', JSON.stringify(paths))
  .replace('__TEMPO_APP_SHELL__', '/index.html');

function setup() {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shell = new Response('<html>Tempo</html>');
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(shell),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(['tempo-shell-old', 'tempo-shell-current', 'another-app']),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi.fn().mockResolvedValue(new Response('network'));
  const claim = vi.fn().mockResolvedValue(undefined);
  runInNewContext(source, {
    self: {
      location: { origin: 'https://tempo.example' },
      clients: { claim },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener;
      },
    },
    caches,
    fetch,
    URL,
    Request,
  });
  return { listeners, cache, caches, fetch, claim, shell };
}

describe('offline application shell', () => {
  it('waits for all versioned assets to be cached before installation completes', async () => {
    const { listeners, cache, caches } = setup();
    let installation: Promise<unknown> | undefined;
    listeners.install({ waitUntil: (promise: Promise<unknown>) => { installation = promise; } });
    await installation;
    expect(caches.open).toHaveBeenCalledWith('tempo-shell-current');
    const requests = cache.addAll.mock.calls[0][0] as Request[];
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(paths);
    expect(requests.every((request) => request.cache === 'reload')).toBe(true);
  });

  it('removes only previous Tempo caches when activating', async () => {
    const { listeners, caches, claim } = setup();
    let activation: Promise<unknown> | undefined;
    listeners.activate({ waitUntil: (promise: Promise<unknown>) => { activation = promise; } });
    await activation;
    expect(caches.delete.mock.calls).toEqual([['tempo-shell-old']]);
    expect(claim).toHaveBeenCalledOnce();
  });

  it('serves a cached page during an offline navigation, including app routes', async () => {
    const { listeners, cache, fetch, shell } = setup();
    let response: Promise<Response> | undefined;
    listeners.fetch({
      request: { url: 'https://tempo.example/calendar?day=2026-11-09', method: 'GET', mode: 'navigate' },
      respondWith: (promise: Promise<Response>) => { response = promise; },
    });
    expect(await response).toBe(shell);
    expect(cache.match).toHaveBeenCalledWith('/index.html');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not intercept private requests, writes or third-party requests', () => {
    const { listeners, cache } = setup();
    const respondWith = vi.fn();
    for (const request of [
      { url: 'https://tempo.example/api/events', method: 'GET', mode: 'cors' },
      { url: 'https://tempo.example/documents/ticket.pdf', method: 'GET', mode: 'cors' },
      { url: 'https://tempo.example/index.html', method: 'POST', mode: 'cors' },
      { url: 'https://other.example/index.html', method: 'GET', mode: 'cors' },
    ]) listeners.fetch({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.addAll).not.toHaveBeenCalled();
  });

  it('serves the precached hashed asset without a network request', async () => {
    const { listeners, cache, fetch, shell } = setup();
    let response: Promise<Response> | undefined;
    listeners.fetch({
      request: { url: 'https://tempo.example/assets/app-abc123.js', method: 'GET', mode: 'cors' },
      respondWith: (promise: Promise<Response>) => { response = promise; },
    });
    expect(await response).toBe(shell);
    expect(cache.match).toHaveBeenCalledWith('/assets/app-abc123.js');
    expect(fetch).not.toHaveBeenCalled();
  });
});
