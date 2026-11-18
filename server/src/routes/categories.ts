import { TAX_LINES } from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optStr, toInt, type AppContext } from '../context';
import { categoryToApi, type CategoryRow } from '../db/rows';

export function categoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/tax-lines', async () => TAX_LINES);

  app.get('/api/categories', async () => {
    const rows = ctx.db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as CategoryRow[];
    const usage = ctx.db
      .prepare('SELECT category_id, COUNT(*) AS n FROM ledger_lines WHERE category_id IS NOT NULL GROUP BY category_id')
      .all() as { category_id: number; n: number }[];
    const n = new Map(usage.map((u) => [u.category_id, u.n]));
    return rows.map((c) => ({ ...categoryToApi(c), usageCount: n.get(c.id) ?? 0 }));
  });

  app.post('/api/categories', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = optStr(b.name);
    if (!name) badRequest('Name is required');
    const kind = optStr(b.kind) ?? 'expense';
    if (!['expense', 'income', 'other'].includes(kind)) badRequest('Unknown kind');
    const taxLine = optStr(b.taxLine) ?? 'C-27a';
    if (!TAX_LINES.some((t) => t.code === taxLine)) badRequest('Unknown tax line');
    const pct = b.deductiblePct === undefined ? 100 : Number(b.deductiblePct);
    if (!(pct >= 0 && pct <= 100)) badRequest('Deductible % must be 0–100');
    const maxSort = (ctx.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories').get() as { m: number }).m;
    try {
      const info = ctx.db
        .prepare(
          'INSERT INTO categories (name, kind, tax_line, deductible_pct, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(name, kind, taxLine, pct, optStr(b.description) ?? null, maxSort + 10);
      return categoryToApi(ctx.db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) as CategoryRow);
    } catch (e) {
      if (String(e).includes('UNIQUE')) badRequest('A category with that name already exists');
      throw e;
    }
  });

  app.patch('/api/categories/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const row = ctx.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
    if (!row) notFound('Category not found');
    if (b.taxLine !== undefined && !TAX_LINES.some((t) => t.code === b.taxLine)) badRequest('Unknown tax line');
    const pct = b.deductiblePct === undefined ? row.deductible_pct : Number(b.deductiblePct);
    if (!(pct >= 0 && pct <= 100)) badRequest('Deductible % must be 0–100');
    ctx.db
      .prepare(
        'UPDATE categories SET name = ?, tax_line = ?, deductible_pct = ?, description = ?, archived = ?, kind = ? WHERE id = ?',
      )
      .run(
        optStr(b.name) ?? row.name,
        optStr(b.taxLine) ?? row.tax_line,
        pct,
        b.description !== undefined ? optStr(b.description) ?? null : row.description,
        b.archived !== undefined ? (b.archived ? 1 : 0) : row.archived,
        optStr(b.kind) ?? row.kind,
        id,
      );
    return categoryToApi(ctx.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow);
  });
}
