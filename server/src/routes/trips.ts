import { addDays, suggestTrips, tripCandidates, tripProfit, type TripTxn } from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { getSetting } from '../db/database';
import { splitsFor, transactionToApi, tripToApi, tripToWindow, type TransactionRow, type TripRow } from '../db/rows';
import { loadCategoryIdByKey, loadHomeState, recategorize } from '../services/categorizeService';
import { assignToTrip, bulkUpdate } from '../services/transactionService';
import { invoiceDetail } from './income';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toTripTxn(t: TransactionRow): TripTxn {
  return {
    id: t.id,
    date: t.date,
    amountCents: t.amount_cents,
    merchantKey: t.merchant_key,
    description: t.description,
    city: t.city,
    state: t.state,
    isOnline: !!t.is_online,
    status: t.status,
    classification: t.classification,
    categoryId: t.category_id,
    tripId: t.trip_id,
  };
}

function readTrip(ctx: AppContext, body: unknown, existing?: TripRow) {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = optStr(b.name) ?? existing?.name;
  const start = optStr(b.startDate) ?? existing?.start_date;
  const end = optStr(b.endDate) ?? existing?.end_date;
  if (!name) badRequest('Give the trip a name');
  if (!start || !end || !ISO.test(start) || !ISO.test(end)) badRequest('Choose the trip dates');
  if (start > end) badRequest('The trip ends before it starts');
  const state = b.destState !== undefined ? optStr(b.destState)?.toUpperCase().slice(0, 2) ?? null : existing?.dest_state ?? null;
  return {
    name,
    start,
    end,
    city: b.destCity !== undefined ? optStr(b.destCity) ?? null : existing?.dest_city ?? null,
    state,
    purpose: b.purpose !== undefined ? optStr(b.purpose) ?? null : existing?.purpose ?? null,
    before: optInt(b.beforeDays) ?? existing?.before_days ?? getSetting(ctx.db, 'trip_window_before_days', 60),
    after: optInt(b.afterDays) ?? existing?.after_days ?? getSetting(ctx.db, 'trip_window_after_days', 5),
    clientId: b.clientId !== undefined ? optInt(b.clientId) ?? null : existing?.client_id ?? null,
    projectId: b.projectId !== undefined ? optInt(b.projectId) ?? null : existing?.project_id ?? null,
    agreedFee:
      b.agreedFeeCents !== undefined
        ? b.agreedFeeCents === null || b.agreedFeeCents === ''
          ? null
          : Math.round(Number(b.agreedFeeCents))
        : existing?.agreed_fee_cents ?? null,
  };
}

/** What the trip earned and cost (see core tripProfit). */
function tripMoney(ctx: AppContext, trip: TripRow) {
  const received = (
    ctx.db
      .prepare(
        `SELECT COALESCE(SUM(l.amount_cents), 0) AS c FROM ledger_lines l JOIN categories c ON c.id = l.category_id
          WHERE l.trip_id = ? AND c.kind = 'income' AND l.classification = 'business' AND l.status = 'reviewed'`,
      )
      .get(trip.id) as { c: number }
  ).c;
  const invoices = (ctx.db.prepare("SELECT * FROM invoices WHERE trip_id = ? AND status != 'void'").all(trip.id) as Record<string, unknown>[]).map(
    (i) => invoiceDetail(ctx.db, i),
  );
  // Payments recorded by hand (not linked to a bank deposit) count as received too.
  const manualPaid = invoices.flatMap((i) => i.payments.filter((p) => !p.transactionId)).reduce((s, p) => s + p.amountCents, 0);
  const invoicedOpenCents = invoices.filter((i) => i.status === 'sent').reduce((s, i) => s + i.balanceCents, 0);
  const totals = tripTotals(ctx, trip.id);
  const profit = tripProfit({
    startDate: trip.start_date,
    endDate: trip.end_date,
    receivedCents: received + manualPaid,
    invoicedOpenCents,
    agreedFeeCents: trip.agreed_fee_cents,
    expenseCents: totals.totalCents,
    mileageCents: 0,
  });
  return {
    receivedCents: received + manualPaid,
    invoicedOpenCents,
    agreedFeeCents: trip.agreed_fee_cents,
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, totalCents: i.totalCents, balanceCents: i.balanceCents, state: i.state })),
    ...profit,
  };
}

function tripTotals(ctx: AppContext, tripId: number) {
  const rows = ctx.db
    .prepare(
      `SELECT l.category_id, c.name, c.deductible_pct, COUNT(*) AS n, SUM(l.amount_cents) AS total
         FROM ledger_lines l LEFT JOIN categories c ON c.id = l.category_id
        WHERE l.trip_id = ? AND l.classification = 'business' AND l.status = 'reviewed'
          AND COALESCE(c.kind, CASE WHEN l.amount_cents < 0 THEN 'expense' ELSE 'income' END) = 'expense'
          AND COALESCE(c.tax_line, '') NOT IN ('EST-FED', 'EST-STATE', 'NONE')
        GROUP BY l.category_id ORDER BY SUM(l.amount_cents)`,
    )
    .all(tripId) as { category_id: number | null; name: string | null; deductible_pct: number | null; n: number; total: number }[];
  const byCategory = rows.map((r) => ({
    categoryId: r.category_id,
    name: r.name ?? 'No category',
    count: r.n,
    totalCents: -r.total,
    deductibleCents: Math.round((-r.total * (r.deductible_pct ?? 100)) / 100),
  }));
  return {
    byCategory,
    count: byCategory.reduce((s, c) => s + c.count, 0),
    totalCents: byCategory.reduce((s, c) => s + c.totalCents, 0),
    deductibleCents: byCategory.reduce((s, c) => s + c.deductibleCents, 0),
  };
}

export function tripRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/trips', async () => {
    const trips = ctx.db.prepare('SELECT * FROM business_trips ORDER BY start_date DESC').all() as TripRow[];
    const pending = ctx.db
      .prepare("SELECT trip_id, COUNT(*) AS n FROM transactions WHERE trip_id IS NOT NULL AND status != 'reviewed' GROUP BY trip_id")
      .all() as { trip_id: number; n: number }[];
    const pendingBy = new Map(pending.map((p) => [p.trip_id, p.n]));
    const clients = new Map((ctx.db.prepare('SELECT id, name FROM clients').all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
    return trips.map((t) => ({
      ...tripToApi(t),
      clientName: t.client_id ? clients.get(t.client_id) ?? null : null,
      totals: tripTotals(ctx, t.id),
      profit: tripMoney(ctx, t),
      suggestedCount: pendingBy.get(t.id) ?? 0,
    }));
  });

  /** Likely trips spotted from out-of-state card activity. */
  app.get('/api/trips/suggestions', async () => {
    const trips = (ctx.db.prepare('SELECT * FROM business_trips').all() as TripRow[]).map(tripToWindow);
    const rows = ctx.db
      .prepare("SELECT * FROM transactions WHERE date >= date('now', '-400 day') AND state IS NOT NULL")
      .all() as TransactionRow[];
    const home = loadHomeState(ctx.db);
    return { homeState: home, suggestions: suggestTrips(rows.map(toTripTxn), home, trips) };
  });

  app.post('/api/trips', async (req) => {
    const t = readTrip(ctx, req.body);
    const info = ctx.db
      .prepare(
        `INSERT INTO business_trips (name, start_date, end_date, dest_city, dest_state, purpose, before_days, after_days,
                                     client_id, project_id, agreed_fee_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.name, t.start, t.end, t.city, t.state, t.purpose, t.before, t.after, t.clientId, t.projectId, t.agreedFee);
    // Undecided transactions in the window now get "part of this trip?" suggestions.
    recategorize(ctx.db);
    return tripToApi(ctx.db.prepare('SELECT * FROM business_trips WHERE id = ?').get(info.lastInsertRowid) as TripRow);
  });

  app.patch('/api/trips/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const existing = ctx.db.prepare('SELECT * FROM business_trips WHERE id = ?').get(id) as TripRow | undefined;
    if (!existing) notFound('Trip not found');
    const t = readTrip(ctx, req.body, existing);
    ctx.db
      .prepare(
        `UPDATE business_trips SET name=?, start_date=?, end_date=?, dest_city=?, dest_state=?, purpose=?, before_days=?, after_days=?,
                client_id=?, project_id=?, agreed_fee_cents=? WHERE id=?`,
      )
      .run(t.name, t.start, t.end, t.city, t.state, t.purpose, t.before, t.after, t.clientId, t.projectId, t.agreedFee, id);
    recategorize(ctx.db);
    return tripToApi(ctx.db.prepare('SELECT * FROM business_trips WHERE id = ?').get(id) as TripRow);
  });

  app.delete('/api/trips/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE transactions SET trip_id = NULL WHERE trip_id = ?').run(id);
      ctx.db.prepare('DELETE FROM business_trips WHERE id = ?').run(id);
    })();
    recategorize(ctx.db);
    return { ok: true };
  });

  /** The trip, what's on it, and everything that might belong to it. */
  app.get('/api/trips/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const row = ctx.db.prepare('SELECT * FROM business_trips WHERE id = ?').get(id) as TripRow | undefined;
    if (!row) notFound('Trip not found');
    const trip = tripToWindow(row);
    const catIds = loadCategoryIdByKey(ctx.db);
    const windowRows = ctx.db
      .prepare('SELECT * FROM transactions WHERE (date BETWEEN ? AND ?) OR trip_id = ? ORDER BY date, id')
      .all(addDays(trip.startDate, -trip.beforeDays), addDays(trip.endDate, trip.afterDays), id) as TransactionRow[];
    const byId = new Map(windowRows.map((r) => [r.id, r]));
    const splits = splitsFor(ctx.db, windowRows.filter((r) => r.is_split).map((r) => r.id));
    const home = loadHomeState(ctx.db);
    const cands = tripCandidates(trip, windowRows.map(toTripTxn), home);

    const confirmedOnTrip = (r: TransactionRow) => r.trip_id === id && r.status === 'reviewed';
    const incomeCats = new Set(
      (ctx.db.prepare("SELECT id FROM categories WHERE kind = 'income'").all() as { id: number }[]).map((r) => r.id),
    );
    // Client payments belong in "Income for this trip", not in the expense list.
    const isIncomeLike = (r: TransactionRow) => r.amount_cents > 0 && ((r.category_id !== null && incomeCats.has(r.category_id)) || r.client_id !== null);
    const candidates = cands
      .filter((c) => !confirmedOnTrip(byId.get(c.id)!) && !isIncomeLike(byId.get(c.id)!))
      .map((c) => {
        const r = byId.get(c.id)!;
        const keyCat = c.suggestedCategoryKey ? catIds[c.suggestedCategoryKey] ?? null : null;
        // Keep a category you already chose; otherwise use the trip-aware one.
        const suggestedCategoryId =
          r.status === 'reviewed' && r.classification === 'business' && r.category_id ? r.category_id : keyCat ?? r.category_id;
        return {
          transaction: transactionToApi(r, splits.get(r.id)),
          reason: c.reason,
          why: c.why,
          preselect: c.preselect,
          suggestedCategoryId,
        };
      });
    const assigned = windowRows.filter(confirmedOnTrip).map((r) => transactionToApi(r, splits.get(r.id)));
    // Deposits around the trip that aren't on any trip yet: from the trip's client
    // first, then untagged ones (could be that client's payment).
    const incomeCandidates = (ctx.db
      .prepare(
        `SELECT * FROM transactions WHERE amount_cents > 0 AND trip_id IS NULL
           AND (client_id IS NULL OR client_id = ?)
           AND (category_id IS NULL OR category_id IN (SELECT id FROM categories WHERE kind = 'income'))
           AND date BETWEEN ? AND ? AND COALESCE(classification, '') NOT IN ('transfer', 'personal')
         ORDER BY (client_id IS NULL), date`,
      )
      .all(row.client_id ?? -1, addDays(trip.startDate, -45), addDays(trip.endDate, 60)) as TransactionRow[]).slice(0, 20);
    const income = (ctx.db
      .prepare(
        `SELECT t.* FROM transactions t JOIN categories c ON c.id = t.category_id
          WHERE t.trip_id = ? AND c.kind = 'income' ORDER BY t.date`,
      )
      .all(id) as TransactionRow[]).map((r) => transactionToApi(r));
    return {
      trip: tripToApi(row),
      homeState: home,
      candidates,
      assigned: assigned.filter((t) => t.amountCents < 0 || !income.some((i) => i.id === t.id)),
      income,
      incomeCandidates: incomeCandidates.map((r) => transactionToApi(r)),
      totals: tripTotals(ctx, id),
      profit: tripMoney(ctx, row),
    };
  });

  app.post('/api/trips/:id/assign', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const row = ctx.db.prepare('SELECT * FROM business_trips WHERE id = ?').get(id) as TripRow | undefined;
    if (!row) notFound('Trip not found');
    const b = (req.body ?? {}) as { items?: { id: number; categoryId: number | null }[] };
    if (!Array.isArray(b.items) || b.items.length === 0) badRequest('Select at least one transaction');
    const items = b.items.map((i) => ({ id: toInt(i.id, 'id'), categoryId: i.categoryId === null || i.categoryId === undefined ? null : toInt(i.categoryId, 'categoryId') }));
    return assignToTrip(ctx.db, id, row.name, items);
  });

  /** Take transactions off a trip (back to Needs Review). */
  app.post('/api/trips/:id/remove', async (req) => {
    const b = (req.body ?? {}) as { ids?: number[] };
    if (!Array.isArray(b.ids) || b.ids.length === 0) badRequest('Select at least one transaction');
    return bulkUpdate(ctx.db, { ids: b.ids.map(Number), reset: true });
  });
}
