import type { FastifyInstance } from 'fastify';
import { APP_VERSION } from '../config';
import { badRequest, optInt, optStr, type AppContext } from '../context';
import { getSetting, setSetting } from '../db/database';
import { createBackup, listBackups, restoreBackup } from '../services/backupService';

/** Settings the UI may change. Anything else is rejected. */
const EDITABLE_SETTINGS: Record<string, (v: unknown) => boolean> = {
  mileage_method: (v) => v === 'standard' || v === 'actual',
  trip_window_before_days: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 365,
  trip_window_after_days: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 60,
  business_name: (v) => typeof v === 'string' && v.length <= 120,
};

/** Categories whose totals are NOT Schedule C deductions. */
const NON_SCHEDULE_C = ['F8829', 'S1-16', 'S1-17', 'EST-FED', 'EST-STATE', 'NONE'];

export function systemRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/meta', async () => ({
    version: APP_VERSION,
    dataDir: ctx.paths.dataDir,
    dbPath: ctx.paths.dbPath,
    schemaVersion: ctx.db.pragma('user_version', { simple: true }),
  }));

  app.get('/api/settings', async () => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(EDITABLE_SETTINGS)) out[key] = getSetting(ctx.db, key, null);
    return out;
  });

  app.patch('/api/settings', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(b)) {
      const check = EDITABLE_SETTINGS[k];
      if (!check) badRequest(`Unknown setting "${k}"`);
      if (!check(v)) badRequest(`Invalid value for "${k}"`);
    }
    for (const [k, v] of Object.entries(b)) setSetting(ctx.db, k, v);
    return { ok: true };
  });

  app.get('/api/mileage-rates', async () =>
    (ctx.db.prepare('SELECT * FROM mileage_rates ORDER BY effective_from').all() as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      centsPerMile: r.cents_per_mile,
      note: r.note,
    })),
  );

  app.post('/api/mileage-rates', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const from = optStr(b.effectiveFrom);
    const to = optStr(b.effectiveTo);
    const cents = Number(b.centsPerMile);
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      badRequest('Enter a valid date range');
    }
    if (!(cents > 0 && cents < 500)) badRequest('Enter the rate in cents per mile, e.g. 72.5');
    ctx.db
      .prepare('INSERT INTO mileage_rates (kind, effective_from, effective_to, cents_per_mile, note) VALUES (?, ?, ?, ?, ?)')
      .run(optStr(b.kind) ?? 'business', from, to, cents, optStr(b.note) ?? null);
    return { ok: true };
  });

  app.delete('/api/mileage-rates/:id', async (req) => {
    ctx.db.prepare('DELETE FROM mileage_rates WHERE id = ?').run(Number((req.params as { id: string }).id));
    return { ok: true };
  });

  app.get('/api/backups', async () => listBackups(ctx));
  app.post('/api/backups', async (req) => createBackup(ctx, optStr(((req.body ?? {}) as Record<string, unknown>).label) ?? 'manual'));
  app.post('/api/backups/restore', async (req) => {
    const name = optStr(((req.body ?? {}) as Record<string, unknown>).name);
    if (!name) badRequest('Choose a backup');
    try {
      return await restoreBackup(ctx, name);
    } catch (e) {
      badRequest((e as Error).message);
    }
  });

  app.get('/api/dashboard', async (req) => {
    const year = optInt((req.query as Record<string, unknown>).year) ?? new Date().getFullYear();
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const db = ctx.db;
    const mileageMethod = getSetting(db, 'mileage_method', 'standard');

    const statusRows = db.prepare('SELECT status, COUNT(*) AS n FROM transactions GROUP BY status').all() as { status: string; n: number }[];
    const status = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));

    const byCat = db
      .prepare(
        `SELECT c.id, c.name, c.kind, c.tax_line, c.deductible_pct, SUM(l.amount_cents) AS total, COUNT(*) AS n
           FROM ledger_lines l JOIN categories c ON c.id = l.category_id
          WHERE l.status = 'reviewed' AND l.classification = 'business' AND l.date BETWEEN ? AND ?
          GROUP BY c.id ORDER BY ABS(SUM(l.amount_cents)) DESC`,
      )
      .all(from, to) as { id: number; name: string; kind: string; tax_line: string; deductible_pct: number; total: number; n: number }[];

    let incomeCents = 0;
    let expenseCents = 0;
    let deductibleCents = 0;
    const categories = byCat.map((c) => {
      const isScheduleC = !NON_SCHEDULE_C.includes(c.tax_line) && !(c.tax_line === 'C-9-ACTUAL' && mileageMethod === 'standard');
      if (c.kind === 'income') incomeCents += c.total;
      if (c.kind === 'expense' && isScheduleC) {
        expenseCents += -c.total;
        deductibleCents += Math.round((-c.total * c.deductible_pct) / 100);
      }
      return {
        categoryId: c.id,
        name: c.name,
        kind: c.kind,
        taxLine: c.tax_line,
        totalCents: c.kind === 'income' ? c.total : -c.total,
        deductibleCents: c.kind === 'expense' && isScheduleC ? Math.round((-c.total * c.deductible_pct) / 100) : 0,
        count: c.n,
        countsTowardScheduleC: isScheduleC,
      };
    });

    const monthly = db
      .prepare(
        `SELECT substr(l.date, 1, 7) AS month,
                SUM(CASE WHEN c.kind = 'income' THEN l.amount_cents ELSE 0 END) AS income,
                SUM(CASE WHEN c.kind = 'expense' THEN -l.amount_cents ELSE 0 END) AS expense
           FROM ledger_lines l JOIN categories c ON c.id = l.category_id
          WHERE l.status = 'reviewed' AND l.classification = 'business' AND l.date BETWEEN ? AND ?
            AND c.tax_line NOT IN (${NON_SCHEDULE_C.map(() => '?').join(',')})
          GROUP BY month ORDER BY month`,
      )
      .all(from, to, ...NON_SCHEDULE_C) as { month: string; income: number; expense: number }[];

    const uncategorized = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM ledger_lines
            WHERE status = 'reviewed' AND classification = 'business' AND category_id IS NULL AND date BETWEEN ? AND ?`,
        )
        .get(from, to) as { n: number }
    ).n;

    const yearNeedsReview = (
      db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status != 'reviewed' AND date BETWEEN ? AND ?").get(from, to) as { n: number }
    ).n;

    const years = (db.prepare("SELECT DISTINCT substr(date, 1, 4) AS y FROM transactions ORDER BY y DESC").all() as { y: string }[]).map(
      (r) => Number(r.y),
    );

    return {
      year,
      years,
      mileageMethod,
      review: {
        unreviewed: status.unreviewed ?? 0,
        suggested: status.suggested ?? 0,
        reviewed: status.reviewed ?? 0,
        yearNeedsReview,
      },
      incomeCents,
      expenseCents,
      deductibleCents,
      netProfitCents: incomeCents - deductibleCents,
      uncategorizedBusiness: uncategorized,
      categories,
      monthly: monthly.map((m) => ({ month: m.month, incomeCents: m.income, expenseCents: m.expense })),
    };
  });
}
