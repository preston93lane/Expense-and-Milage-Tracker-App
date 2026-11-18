import { addDays, suggestTrips, tripCandidates, type TripTxn } from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { getSetting } from '../db/database';
import { splitsFor, transactionToApi, tripToApi, tripToWindow, type TransactionRow, type TripRow } from '../db/rows';
import { loadCategoryIdByKey, loadHomeState, recategorize } from '../services/categorizeService';
import { assignToTrip, bulkUpdate } from '../services/transactionService';

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
  };
}

function tripTotals(ctx: AppContext, tripId: number) {
  const rows = ctx.db
    .prepare(
      `SELECT l.category_id, c.name, c.deductible_pct, COUNT(*) AS n, SUM(l.amount_cents) AS total
         FROM ledger_lines l LEFT JOIN categories c ON c.id = l.category_id
        WHERE l.trip_id = ? AND l.classification = 'business' AND l.status = 'reviewed'
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
    return trips.map((t) => ({ ...tripToApi(t), totals: tripTotals(ctx, t.id), suggestedCount: pendingBy.get(t.id) ?? 0 }));
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
        `INSERT INTO business_trips (name, start_date, end_date, dest_city, dest_state, purpose, before_days, after_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(t.name, t.start, t.end, t.city, t.state, t.purpose, t.before, t.after);
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
        `UPDATE business_trips SET name=?, start_date=?, end_date=?, dest_city=?, dest_state=?, purpose=?, before_days=?, after_days=?
          WHERE id=?`,
      )
      .run(t.name, t.start, t.end, t.city, t.state, t.purpose, t.before, t.after, id);
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
    const candidates = cands
      .filter((c) => !confirmedOnTrip(byId.get(c.id)!))
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
    return { trip: tripToApi(row), homeState: home, candidates, assigned, totals: tripTotals(ctx, id) };
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
