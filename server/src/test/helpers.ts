import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { appPaths } from '../config';
import type { AppContext } from '../context';
import { openDatabase } from '../db/database';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  dir: string;
  call: <T = any>(method: string, url: string, body?: unknown) => Promise<{ status: number; body: T }>;
  close: () => Promise<void>;
}

export async function makeTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'et-test-'));
  const paths = appPaths(dir);
  const db = await openDatabase(paths.dbPath, paths.backupsDir);
  const ctx: AppContext = { db, paths, port: 4280 };
  const app = await buildApp(ctx, { webDist: join(dir, 'no-web') });
  const call = async (method: string, url: string, body?: unknown) => {
    // The web client always sends JSON for writes (the server requires it).
    if (body === undefined && method !== 'GET') body = {};
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { host: '127.0.0.1:4280', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let parsed: unknown = res.body;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* not JSON */
    }
    return { status: res.statusCode, body: parsed as any };
  };
  return {
    app,
    ctx,
    dir,
    call,
    close: async () => {
      await app.close();
      ctx.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
