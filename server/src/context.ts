import type { AppPaths } from './config';
import type { DB } from './db/database';

/**
 * Shared state for request handlers. `db` is swapped when a backup is restored,
 * so handlers must always read `ctx.db` at call time.
 */
export interface AppContext {
  db: DB;
  paths: AppPaths;
  port: number;
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message = 'Not found'): never {
  throw new HttpError(404, message);
}

export function toInt(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n)) badRequest(`${name} must be a whole number`);
  return n;
}

export function optInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

export function optStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}
