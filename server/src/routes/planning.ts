import {
  addDays,
  APPROACH_LABEL,
  budgetStatus,
  detectRecurring,
  forecast,
  projectSeries,
  replacementIdea,
  retainerSchedule,
  todayIso,
  weeklyAverageSpend,
  type CashEvent,
  type RecurringSeries,
} from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, optInt, optStr, toInt, type AppContext } from '../context';
import type { DB } from '../db/database';
import type { AccountRow } from '../db/rows';
import { invoiceDetail } from './income';

type Row = Record<string, any>;
const PREF_STATUSES = ['keep', 'replace', 'cancelled', 'ignore'];

export function loadSeries(db: DB, today = todayIso()) {
  const rows = db
    .prepare(
      `SELECT id, date, amount_cents, merchant_key, merchant, classification, category_id FROM transactions
        WHERE date >= ? AND COALESCE(classification, '') != 'transfer' AND transfer_pair_id IS NULL`,
    )
    .all(addDays(today, -550)) as Row[];
  const series = detectRecurring(
    rows.map((r) => ({
      id: r.id,
      date: r.date,
      amountCents: r.amount_cents,
      merchantKey: r.merchant_key,
      merchant: r.merchant,
      classification: r.classification,
      categoryId: r.category_id,
    })),
    today,
  );
  const prefs = new Map((db.prepare('SELECT * FROM subscription_prefs').all() as Row[]).map((p) => [p.series_key as string, p]));
  return series.map((s) => {
    const p = prefs.get(s.seriesKey);
    return {
      ...s,
      pref: (p?.status as 'keep' | 'replace' | 'cancelled' | 'ignore' | undefined) ?? null,
      note: (p?.note as string | null) ?? null,
      idea: replacementIdea(s.merchantKey),
    };
  });
}

export type SeriesWithPrefs = ReturnType<typeof loadSeries>[number];

function activeSeries(s: SeriesWithPrefs[]): SeriesWithPrefs[] {
  return s.filter((x) => x.pref !== 'cancelled' && x.pref !== 'ignore' && x.status !== 'stopped');
}

/** Current balance per account: last known balance + everything posted after it. */
export function accountBalances(db: DB) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY name').all() as AccountRow[];
  return accounts.map((a) => {
    let current: number | null = null;
    if (a.balance_cents !== null && a.balance_date) {
      const after = (
        db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE account_id = ? AND date > ?').get(a.id, a.balance_date) as {
          s: number;
        }
      ).s;
      current = a.balance_cents + after;
    }
    return { id: a.id, name: a.name, type: a.type, balanceCents: a.balance_cents, balanceDate: a.balance_date, currentCents: current };
  });
}

function seriesMarkdown(series: SeriesWithPrefs[]): string {
  const out = activeSeries(series).filter((s) => s.direction === 'out');
  const lines = [
    '# My subscriptions and recurring bills',
    '',
    `Exported ${todayIso()} from my expense tracker. Amounts only — no account numbers.`,
    '',
    '| Service | How often | Amount | Per year | Business/personal | My plan | Idea |',
    '|---|---|---:|---:|---|---|---|',
    ...out.map(
      (s) =>
        `| ${s.merchant} | ${s.frequency} | $${(s.amountCents / 100).toFixed(2)} | $${(s.yearlyCents / 100).toFixed(2)} | ${s.classification} | ${s.pref ?? ''} | ${APPROACH_LABEL[s.idea.approach]}: ${s.idea.idea.replace(/\|/g, '/')} |`,
    ),
    '',
    `Total: $${(out.reduce((t, s) => t + s.yearlyCents, 0) / 100).toFixed(2)} per year.`,
    '',
    'Question: which of these could I replace with an agent workflow or a small self-built app?',
  ];
  return lines.join('\n');
}

export function planningRoutes(app: FastifyInstance, ctx: AppContext) {
  // ----- Subscriptions -----
  app.get('/api/subscriptions', async () => {
    const all = loadSeries(ctx.db);
    const out = all.filter((s) => s.direction === 'out');
    const active = activeSeries(out);
    const sum = (xs: SeriesWithPrefs[], f: (s: SeriesWithPrefs) => number) => xs.reduce((t, s) => t + f(s), 0);
    return {
      series: out,
      recurringIncome: all.filter((s) => s.direction === 'in'),
      totals: {
        monthlyCents: sum(active, (s) => s.monthlyCents),
        yearlyCents: sum(active, (s) => s.yearlyCents),
        businessYearlyCents: sum(active.filter((s) => s.classification === 'business'), (s) => s.yearlyCents),
        personalYearlyCents: sum(active.filter((s) => s.classification !== 'business'), (s) => s.yearlyCents),
        replaceYearlyCents: sum(active.filter((s) => s.pref === 'replace'), (s) => s.yearlyCents),
        cancelledYearlyCents: sum(out.filter((s) => s.pref === 'cancelled'), (s) => s.yearlyCents),
        priceIncreases: active.filter((s) => s.priceChange && s.priceChange.toCents > s.priceChange.fromCents).length,
      },
    };
  });

  app.put('/api/subscriptions/prefs', async (req) => {
    const b = (req.body ?? {}) as Row;
    const key = optStr(b.seriesKey);
    if (!key) badRequest('seriesKey is required');
    if (b.status === null || b.status === '') {
      ctx.db.prepare('DELETE FROM subscription_prefs WHERE series_key = ?').run(key);
      return { ok: true };
    }
    if (!PREF_STATUSES.includes(b.status)) badRequest('Unknown status');
    ctx.db
      .prepare(
        `INSERT INTO subscription_prefs (series_key, status, note) VALUES (?, ?, ?)
         ON CONFLICT(series_key) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = datetime('now')`,
      )
      .run(key, b.status, optStr(b.note) ?? null);
    return { ok: true };
  });

  app.get('/api/subscriptions/export.md', async (_req, reply) => {
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="subscriptions.md"');
    return seriesMarkdown(loadSeries(ctx.db));
  });

  app.get('/api/subscriptions/export-text', async () => ({ markdown: seriesMarkdown(loadSeries(ctx.db)) }));

  // ----- Planned one-off items -----
  app.get('/api/planned', async () =>
    (ctx.db.prepare('SELECT * FROM planned_items ORDER BY date').all() as Row[]).map((p) => ({
      id: p.id,
      date: p.date,
      amountCents: p.amount_cents,
      description: p.description,
    })),
  );
  app.post('/api/planned', async (req) => {
    const b = (req.body ?? {}) as Row;
    const date = optStr(b.date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) badRequest('Choose a date');
    const amount = Math.round(Number(b.amountCents));
    if (!Number.isFinite(amount) || amount === 0) badRequest('Enter an amount');
    const desc = optStr(b.description);
    if (!desc) badRequest('Describe it');
    const info = ctx.db.prepare('INSERT INTO planned_items (date, amount_cents, description) VALUES (?, ?, ?)').run(date, amount, desc);
    return { id: Number(info.lastInsertRowid) };
  });
  app.delete('/api/planned/:id', async (req) => {
    ctx.db.prepare('DELETE FROM planned_items WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  // ----- Cash flow forecast -----
  app.get('/api/cashflow', async (req) => {
    const q = req.query as Row;
    const days = Math.min(Math.max(optInt(q.days) ?? 90, 14), 365);
    const includeTypical = q.typical !== '0';
    const includeCards = q.cards !== '0';
    const today = todayIso();
    const end = addDays(today, days);
    const db = ctx.db;
    const warnings: string[] = [];

    const balances = accountBalances(db);
    const missing = balances.filter((b) => b.currentCents === null && b.type !== 'other');
    for (const m of missing) warnings.push(`No balance for “${m.name}” yet — add it on the Cash flow page (or import a QFX/OFX file, which includes it).`);
    const cashCents = balances.filter((b) => b.type !== 'credit_card' && b.currentCents !== null).reduce((s, b) => s + b.currentCents!, 0);
    const cardCents = balances.filter((b) => b.type === 'credit_card' && b.currentCents !== null).reduce((s, b) => s + b.currentCents!, 0);
    const startCents = cashCents + (includeCards ? cardCents : 0);

    const series = activeSeries(loadSeries(db, today));
    const events: CashEvent[] = [];

    // Retainers (expected client payments).
    const retainers = db.prepare('SELECT * FROM retainers WHERE active = 1').all() as Row[];
    const retainerClients = new Set(retainers.map((r) => r.client_id as number));
    const deps = (db.prepare("SELECT id, date, amount_cents, client_id FROM transactions WHERE amount_cents > 0 AND date >= ?").all(addDays(today, -40)) as Row[]).map(
      (d) => ({ id: d.id, date: d.date, amountCents: d.amount_cents, clientId: d.client_id }),
    );
    const names = new Map((db.prepare('SELECT id, name FROM clients').all() as Row[]).map((c) => [c.id as number, c.name as string]));
    for (const e of retainerSchedule(
      retainers.map((r) => ({
        id: r.id,
        clientId: r.client_id,
        name: r.name,
        amountCents: r.amount_cents,
        frequency: r.frequency,
        startDate: r.start_date,
        endDate: r.end_date,
        active: !!r.active,
      })),
      deps,
      addDays(today, -30),
      end,
      today,
    )) {
      if (e.status === 'received' || e.status === 'missed') continue;
      events.push({ date: e.dueDate < today ? addDays(today, 3) : e.dueDate, amountCents: e.amountCents, label: `${names.get(e.clientId) ?? 'Client'} — ${e.name}`, kind: 'retainer' });
    }

    // Recurring charges and recurring income (skip income already covered by a retainer).
    const seriesClient = (s: SeriesWithPrefs) => {
      const r = db
        .prepare(`SELECT client_id FROM transactions WHERE id IN (${s.transactionIds.map(() => '?').join(',')}) AND client_id IS NOT NULL LIMIT 1`)
        .get(...s.transactionIds) as Row | undefined;
      return r?.client_id as number | undefined;
    };
    const projectable = series.filter((s) => s.direction === 'out' || !retainerClients.has(seriesClient(s) ?? -1));
    events.push(...projectSeries(projectable as RecurringSeries[], today, end));

    // Unpaid invoices (overdue ones assumed to arrive within a week).
    for (const inv of (db.prepare("SELECT * FROM invoices WHERE status = 'sent'").all() as Row[]).map((i) => invoiceDetail(db, i))) {
      if (inv.balanceCents <= 0) continue;
      const due = !inv.dueDate || inv.dueDate < today ? addDays(today, 7) : inv.dueDate;
      if (due <= end) events.push({ date: due, amountCents: inv.balanceCents, label: `Invoice ${inv.number} — ${inv.clientName}`, kind: 'invoice' });
    }

    // Planned one-offs.
    for (const p of db.prepare('SELECT * FROM planned_items WHERE date BETWEEN ? AND ?').all(today, end) as Row[]) {
      events.push({ date: p.date, amountCents: p.amount_cents, label: p.description, kind: 'planned' });
    }

    // Estimated tax payments (from the Taxes page, when set up).
    for (const t of db.prepare("SELECT * FROM settings WHERE key LIKE 'est_tax_due_%'").all() as Row[]) {
      try {
        const v = JSON.parse(t.value) as { date: string; amountCents: number };
        if (v.date >= today && v.date <= end && v.amountCents > 0) events.push({ date: v.date, amountCents: -v.amountCents, label: 'Estimated tax payment', kind: 'tax' });
      } catch {
        /* ignore */
      }
    }

    // Typical everyday spending: last 90 days, not recurring, not transfers.
    let weeklyTypical = 0;
    if (includeTypical) {
      const recurringIds = new Set(series.flatMap((s) => s.transactionIds));
      const outs = (
        db
          .prepare(
            `SELECT id, amount_cents FROM transactions WHERE amount_cents < 0 AND date > ? AND date <= ?
               AND COALESCE(classification, '') != 'transfer' AND transfer_pair_id IS NULL`,
          )
          .all(addDays(today, -90), today) as Row[]
      ).filter((r) => !recurringIds.has(r.id));
      const firstDate = (db.prepare('SELECT MIN(date) AS d FROM transactions').get() as Row).d as string | null;
      const span = firstDate ? Math.min(90, Math.max(7, Math.round((Date.parse(today) - Date.parse(firstDate)) / 86400000))) : 90;
      weeklyTypical = weeklyAverageSpend(outs.map((r) => r.amount_cents), span);
    }

    const f = forecast(startCents, today, days, events, weeklyTypical);
    if (f.lowest.balanceCents < 0) {
      const amt = (Math.abs(f.lowest.balanceCents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      warnings.unshift(`Cash is projected to go negative (−$${amt}) around ${f.lowest.date}. The list below shows what drives it.`);
    }
    return { today, days, balances, cashCents, cardCents, weeklyTypicalCents: weeklyTypical, warnings, ...f };
  });

  // ----- Budgets -----
  app.get('/api/budgets', async (req) => {
    const month = optStr((req.query as Row).month) ?? todayIso().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) badRequest('month must be YYYY-MM');
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const to = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const today = todayIso();
    const asOf = today >= from && today <= to ? today : to;
    const db = ctx.db;

    const spentByCat = new Map(
      (
        db
          .prepare(
            `SELECT category_id, SUM(-amount_cents) AS spent FROM ledger_lines
              WHERE classification = 'business' AND status != 'unreviewed' AND date BETWEEN ? AND ? AND category_id IS NOT NULL
              GROUP BY category_id`,
          )
          .all(from, to) as Row[]
      ).map((r) => [r.category_id as number, r.spent as number]),
    );
    const businessTotal = [...spentByCat.values()].reduce((s, v) => s + v, 0);
    const personalTotal = (
      db
        .prepare(`SELECT COALESCE(SUM(-amount_cents), 0) AS s FROM ledger_lines WHERE classification = 'personal' AND amount_cents < 0 AND date BETWEEN ? AND ?`)
        .get(from, to) as Row
    ).s as number;

    const budgets = db.prepare('SELECT b.*, c.name AS category_name FROM budgets b LEFT JOIN categories c ON c.id = b.category_id').all() as Row[];
    const list = budgets.map((b) => {
      const spent = b.scope === 'category' ? spentByCat.get(b.category_id) ?? 0 : b.scope === 'business_total' ? businessTotal : personalTotal;
      return {
        id: b.id,
        scope: b.scope,
        categoryId: b.category_id,
        name: b.scope === 'category' ? b.category_name : b.scope === 'business_total' ? 'All business spending' : 'All personal spending',
        ...budgetStatus(b.monthly_cents, spent, asOf),
      };
    });

    // Typical monthly spend per category over the previous 3 full months (to suggest budgets).
    const threeBack = (() => {
      let d = from;
      for (let i = 0; i < 3; i++) d = `${addDays(d, -1).slice(0, 7)}-01`;
      return d;
    })();
    const typical = (
      db
        .prepare(
          `SELECT l.category_id, c.name, SUM(-l.amount_cents) / 3 AS avg_spent FROM ledger_lines l JOIN categories c ON c.id = l.category_id
            WHERE l.classification = 'business' AND l.status != 'unreviewed' AND c.kind = 'expense' AND l.date >= ? AND l.date < ?
            GROUP BY l.category_id HAVING avg_spent > 0 ORDER BY avg_spent DESC`,
        )
        .all(threeBack, from) as Row[]
    ).map((r) => ({ categoryId: r.category_id as number, name: r.name as string, avgMonthlyCents: Math.round(r.avg_spent as number) }));
    const unreviewed = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'unreviewed' AND date BETWEEN ? AND ?").get(from, to) as Row).n as number;
    return { month, budgets: list, typical, unreviewed, businessTotalCents: businessTotal, personalTotalCents: personalTotal };
  });

  app.put('/api/budgets', async (req) => {
    const b = (req.body ?? {}) as Row;
    const scope = optStr(b.scope) ?? 'category';
    if (!['category', 'business_total', 'personal_total'].includes(scope)) badRequest('Unknown budget type');
    const categoryId = scope === 'category' ? toInt(b.categoryId, 'categoryId') : null;
    const cents = Math.round(Number(b.monthlyCents));
    if (!(cents > 0)) badRequest('Enter a monthly amount');
    const existing = ctx.db.prepare('SELECT id FROM budgets WHERE scope = ? AND category_id IS ?').get(scope, categoryId) as Row | undefined;
    if (existing) ctx.db.prepare('UPDATE budgets SET monthly_cents = ? WHERE id = ?').run(cents, existing.id);
    else ctx.db.prepare('INSERT INTO budgets (scope, category_id, monthly_cents) VALUES (?, ?, ?)').run(scope, categoryId, cents);
    return { ok: true };
  });

  app.delete('/api/budgets/:id', async (req) => {
    ctx.db.prepare('DELETE FROM budgets WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });
}
