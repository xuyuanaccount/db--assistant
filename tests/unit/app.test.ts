import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0)) await fn(); });
test('local API rejects missing tokens and foreign origins', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mwa-app-'));
  const app = buildApp({ dataDir, token: 'test-token', port: 3210 });
  cleanups.push(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const headers = { host: '127.0.0.1:3210' };
  expect((await app.inject({ url: '/api/health', headers })).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/connections', headers })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/bootstrap', headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/bootstrap', headers: { host: 'evil.example' } })).statusCode).toBe(403);
  const bootstrap = await app.inject({ url: '/api/bootstrap', headers });
  expect(bootstrap.json()).toEqual({ token: 'test-token' });
  expect(bootstrap.headers['cache-control']).toBe('no-store');
  // no-referrer makes native form POSTs carry Origin:null (Fetch Standard).
  // Keep the browser's same-origin identity while hiding cross-origin referrers.
  expect(bootstrap.headers['referrer-policy']).toBe('same-origin');
  expect((await app.inject({url:'/api/bootstrap',headers:{...headers,origin:'null','sec-fetch-site':'same-origin'}})).statusCode).toBe(403);
});
