import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optStr, toInt, type AppContext } from '../context';
import { accountToApi, type AccountRow } from '../db/rows';

const TYPES = ['checking', 'savings', 'credit_card', 'cash', 'other'];

export function accountRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/accounts', async () => {
    const rows = ctx.db.prepare('SELECT * FROM accounts ORDER BY archived, name COLLATE NOCASE').all() as AccountRow[];
    const stats = ctx.db
      .prepare(
        `SELECT a.id,
                (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS n,
                (SELECT MAX(date) FROM transactions t WHERE t.account_id = a.id) AS last_date,
                (SELECT MAX(created_at) FROM import_batches b WHERE b.account_id = a.id) AS last_import
           FROM accounts a`,
      )
      .all() as { id: number; n: number; last_date: string | null; last_import: string | null }[];
    const byId = new Map(stats.map((s) => [s.id, s]));
    return rows.map((a) => ({
      ...accountToApi(a),
      transactionCount: byId.get(a.id)?.n ?? 0,
      lastTransactionDate: byId.get(a.id)?.last_date ?? null,
      lastImportAt: byId.get(a.id)?.last_import ?? null,
    }));
  });

  app.post('/api/accounts', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = optStr(b.name);
    if (!name) badRequest('Account name is required');
    const type = optStr(b.type) ?? 'checking';
    if (!TYPES.includes(type)) badRequest('Unknown account type');
    const last4 = optStr(b.last4)?.replace(/\D/g, '').slice(-4) ?? null;
    const info = ctx.db
      .prepare('INSERT INTO accounts (name, institution, type, last4) VALUES (?, ?, ?, ?)')
      .run(name, optStr(b.institution) ?? null, type, last4);
    return accountToApi(ctx.db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid) as AccountRow);
  });

  app.patch('/api/accounts/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const row = ctx.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
    if (!row) notFound('Account not found');
    if (b.type !== undefined && !TYPES.includes(String(b.type))) badRequest('Unknown account type');
    ctx.db
      .prepare(
        `UPDATE accounts SET name = ?, institution = ?, type = ?, last4 = ?, archived = ?,
                csv_mapping = CASE WHEN ? THEN NULL ELSE csv_mapping END WHERE id = ?`,
      )
      .run(
        optStr(b.name) ?? row.name,
        b.institution !== undefined ? optStr(b.institution) ?? null : row.institution,
        optStr(b.type) ?? row.type,
        b.last4 !== undefined ? optStr(b.last4)?.replace(/\D/g, '').slice(-4) ?? null : row.last4,
        b.archived !== undefined ? (b.archived ? 1 : 0) : row.archived,
        b.forgetMapping ? 1 : 0,
        id,
      );
    return accountToApi(ctx.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow);
  });

  app.delete('/api/accounts/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?').get(id) as { n: number }).n;
    if (n > 0) badRequest(`This account has ${n} transactions. Archive it instead, or undo its imports first.`);
    ctx.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return { ok: true };
  });
}
