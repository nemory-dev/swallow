import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentUrlMiddleware } from '../electron/url-middleware.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function setup() {
  const fetcher = vi.fn(async () => ({ title: '문서', source: '본문', sourceUrl: 'https://react.dev/learn' }));
  const middleware = documentUrlMiddleware(fetcher);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error();
  return { origin: `http://127.0.0.1:${address.port}`, fetcher };
}
describe('preview URL boundary', () => {
  it('rejects cross-origin access and requires JSON POST', async () => {
    const { origin, fetcher } = await setup();
    for (const headers of [{ Origin: 'https://evil.example', 'Content-Type': 'application/json' }, { Origin: origin, 'Content-Type': 'text/plain' }]) {
      expect((await fetch(origin + '/__swallow/import-url', { method: 'POST', headers, body: JSON.stringify({ url: 'https://react.dev' }) })).status).toBe(403);
    }
    expect(fetcher).not.toHaveBeenCalled();
    const response = await fetch(origin + '/__swallow/import-url', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://react.dev/learn' }) });
    expect(await response.json()).toEqual({ ok: true, value: { title: '문서', source: '본문', sourceUrl: 'https://react.dev/learn' } });
    expect(fetcher).toHaveBeenCalledWith('https://react.dev/learn');
  });
  it('rejects malformed and oversized input', async () => {
    const { origin, fetcher } = await setup();
    for (const body of ['{', 'x'.repeat(21_000)]) {
      const response = await fetch(origin + '/__swallow/import-url', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
