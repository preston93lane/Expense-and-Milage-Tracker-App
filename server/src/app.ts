import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_DIST } from './config';
import { HttpError, type AppContext } from './context';
import { accountRoutes } from './routes/accounts';
import { categoryRoutes } from './routes/categories';
import { importRoutes } from './routes/imports';
import { ruleRoutes } from './routes/rules';
import { systemRoutes } from './routes/system';
import { transactionRoutes } from './routes/transactions';
import { tripRoutes } from './routes/trips';
import { incomeRoutes } from './routes/income';
import { planningRoutes } from './routes/planning';

/**
 * Content Security Policy: the page may only talk to this local server.
 * No CDNs, no analytics, no external fonts — nothing leaves the machine.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export interface BuildOptions {
  logger?: boolean;
  webDist?: string;
  /** Extra Host header values to accept (Wi-Fi mode, Phase 6). */
  allowedHosts?: string[];
}

export async function buildApp(ctx: AppContext, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 150 * 1024 * 1024 });
  app.removeContentTypeParser('text/plain');

  const allowedHosts = new Set([
    `127.0.0.1:${ctx.port}`,
    `localhost:${ctx.port}`,
    '127.0.0.1',
    'localhost',
    ...(opts.allowedHosts ?? []),
  ]);

  // Block DNS-rebinding and cross-site requests: a web page you visit elsewhere
  // must never be able to read or change your data through this local server.
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowedHosts.has(host)) {
      return reply.code(421).send({ error: 'Unrecognised host' });
    }
    // Writes must be JSON: browsers can't send that cross-site without a CORS
    // preflight, which this server never approves.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/')) {
      const ct = String(req.headers['content-type'] ?? '').toLowerCase();
      if (!ct.startsWith('application/json')) {
        return reply.code(415).send({ error: 'Requests that change data must be sent as JSON' });
      }
    }
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let ok = false;
      try {
        ok = allowedHosts.has(new URL(origin).host.toLowerCase());
      } catch {
        ok = false;
      }
      if (!ok) return reply.code(403).send({ error: 'Cross-origin request blocked' });
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the local server. Details are in the console window.' });
  });

  accountRoutes(app, ctx);
  categoryRoutes(app, ctx);
  importRoutes(app, ctx);
  transactionRoutes(app, ctx);
  ruleRoutes(app, ctx);
  systemRoutes(app, ctx);
  tripRoutes(app, ctx);
  incomeRoutes(app, ctx);
  planningRoutes(app, ctx);

  const webDist = opts.webDist ?? WEB_DIST;
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/html')
        .send('<p>The web interface has not been built yet. Run <code>npm run build:web</code> (the launcher does this for you).</p>'),
    );
  }
  return app;
}
