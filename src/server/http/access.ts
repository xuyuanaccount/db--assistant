import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
function matches(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function installAccess(app: FastifyInstance, options: { token: string; port: number; devOrigin?: string }): void {
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  if (options.devOrigin) origins.add(options.devOrigin);
  app.addHook('onRequest', async (request, reply) => {
    if (!hosts.has(request.headers.host || '') ||
      (request.headers.origin && !origins.has(request.headers.origin)) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_ORIGIN', message: '只允许本机工作区访问' } });
    }
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin').header('X-Frame-Options', 'DENY');
  });
  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/') || ['/api/health','/api/bootstrap'].includes(request.url.split('?')[0])) return;
    const bodyToken = request.url.match(/^\/api\/transfers\/tasks\/[^/]+\/download$/)
      ? (request.body as { token?: unknown }|undefined)?.token : undefined;
    const token = request.headers['x-mwa-token'] || bodyToken;
    if (typeof token !== 'string' || !matches(token, options.token))
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: '工作区会话失效，请刷新页面' } });
  });
}
