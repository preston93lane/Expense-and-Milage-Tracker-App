import {
  ACTIVITIES,
  ACTIVITY_LABEL,
  addDays,
  allocation,
  averageRateForYear,
  formatMinutes,
  minutesBetween,
  perHourCents,
  profitability,
  timeValueCents,
  todayIso,
  vehicleComparison,
  type Activity,
  type ProfitInput,
} from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { getSetting, setSetting, type DB } from '../db/database';
import { mileageDeductionCents, scheduleCFor, yearRange } from '../services/taxService';
import { expenseTotal, nextInvoiceNumber, replaceLines } from './income';

type Row = Record<string, any>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `
  SELECT e.*, c.name AS client_name, c.hourly_rate_cents AS client_rate, p.name AS project_name,
         bt.name AS trip_name, bt.client_id AS trip_client_id, i.number AS invoice_number
    FROM time_entries e
    LEFT JOIN clients c ON c.id = e.client_id
    LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN business_trips bt ON bt.id = e.trip_id
    LEFT JOIN invoices i ON i.id = e.invoice_id`;

function settings(db: DB) {
  return {
    targetHourlyCents: getSetting<number | null>(db, 'time_target_hourly_cents', null),
    defaultRateCents: getSetting<number | null>(db, 'time_default_rate_cents', null),
  };
}

function entryToApi(r: Row, defaultRate: number | null, now = new Date().toISOString()) {
  const running = !!r.started_at && !r.ended_at;
  const minutes = running ? minutesBetween(r.started_at, now) : r.minutes;
  const rate = r.billable ? (r.rate_cents ?? r.client_rate ?? defaultRate ?? null) : null;
  return {
    id: r.id as number,
    date: r.date as string,
    startedAt: r.started_at as string | null,
    endedAt: r.ended_at as string | null,
    running,
    minutes,
    clientId: r.client_id as number | null,
    clientName: r.client_name as string | null,
    projectId: r.project_id as number | null,
    projectName: r.project_name as string | null,
    tripId: r.trip_id as number | null,
    tripName: r.trip_name as string | null,
    activity: r.activity as Activity,
    description: r.description as string | null,
    billable: !!r.billable,
    ownRateCents: r.rate_cents as number | null,
    rateCents: rate,
    valueCents: timeValueCents(minutes, rate),
    invoiceId: r.invoice_id as number | null,
    invoiceNumber: r.invoice_number as string | null,
  };
}

function readEntry(b: Row, existing?: Row) {
  const has = (k: string) => k in b;
  const date = has('date') ? optStr(b.date) : existing?.date;
  if (!date || !ISO.test(date)) badRequest('Enter the date');
  let minutes: number = existing?.minutes ?? 0;
  if (has('minutes')) minutes = Math.round(Number(b.minutes));
  else if (has('hours')) minutes = Math.round(Number(b.hours) * 60);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) badRequest('Time must be between 0 and 24 hours');
  const activity = (has('activity') ? optStr(b.activity) : existing?.activity) ?? 'client_work';
  if (!ACTIVITIES.includes(activity as Activity)) badRequest('Unknown activity');
  const id = (k: string, col: string) => (has(k) ? (optInt(b[k]) ?? null) : (existing?.[col] ?? null));
  const rateRaw = has('rateCents') ? b.rateCents : existing?.rate_cents;
  const rate = rateRaw === null || rateRaw === undefined || rateRaw === '' ? null : Math.round(Number(rateRaw));
  if (rate !== null && !(rate >= 0)) badRequest('Rate must be a positive amount');
  return {
    date,
    minutes,
    clientId: id('clientId', 'client_id'),
    projectId: id('projectId', 'project_id'),
    tripId: id('tripId', 'trip_id'),
    activity,
    description: (has('description') ? optStr(b.description) : existing?.description) ?? null,
    billable: (has('billable') ? !!b.billable : existing ? !!existing.billable : true) ? 1 : 0,
    rate,
  };
}

/** Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export function timeRoutes(app: FastifyInstance, ctx: AppContext) {
  const db = ctx.db;
  const running = () => db.prepare(`${SELECT} WHERE e.started_at IS NOT NULL AND e.ended_at IS NULL ORDER BY e.id DESC LIMIT 1`).get() as Row | undefined;

  const stopRunning = () => {
    const r = running();
    if (!r) return null;
    const now = new Date().toISOString();
    db.prepare('UPDATE time_entries SET ended_at = ?, minutes = ? WHERE id = ?').run(now, Math.min(24 * 60, minutesBetween(r.started_at, now)), r.id);
    return r.id as number;
  };

  app.get('/api/time', async (req) => {
    const q = req.query as Row;
    const where: string[] = [];
    const params: unknown[] = [];
    if (optStr(q.from)) {
      where.push('e.date >= ?');
      params.push(q.from);
    }
    if (optStr(q.to)) {
      where.push('e.date <= ?');
      params.push(q.to);
    }
    if (optInt(q.clientId)) {
      where.push('e.client_id = ?');
      params.push(optInt(q.clientId));
    }
    if (q.unbilled === '1') where.push('e.billable = 1 AND e.invoice_id IS NULL');
    const { defaultRateCents } = settings(db);
    const rows = db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.date DESC, e.id DESC LIMIT 500`).all(...params) as Row[];
    const r = running();
    return { entries: rows.map((x) => entryToApi(x, defaultRateCents)), running: r ? entryToApi(r, defaultRateCents) : null };
  });

  app.post('/api/time/start', async (req) => {
    const b = (req.body ?? {}) as Row;
    stopRunning();
    const e = readEntry({ ...b, date: todayIso(), minutes: 0 });
    const info = db
      .prepare(
        `INSERT INTO time_entries (date, started_at, minutes, client_id, project_id, trip_id, activity, description, billable, rate_cents)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.date, new Date().toISOString(), e.clientId, e.projectId, e.tripId, e.activity, e.description, e.billable, e.rate);
    return { id: Number(info.lastInsertRowid) };
  });

  app.post('/api/time/stop', async () => {
    const id = stopRunning();
    if (!id) badRequest('No timer is running');
    const entry = entryToApi(db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as Row, settings(db).defaultRateCents);
    // Started by mistake: don't leave a zero-minute entry behind.
    if (entry.minutes < 1) {
      db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
      return { ...entry, discarded: true };
    }
    return { ...entry, discarded: false };
  });

  app.post('/api/time', async (req) => {
    const e = readEntry((req.body ?? {}) as Row);
    if (!e.minutes) badRequest('Enter how long you worked');
    const info = db
      .prepare(
        `INSERT INTO time_entries (date, minutes, client_id, project_id, trip_id, activity, description, billable, rate_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.date, e.minutes, e.clientId, e.projectId, e.tripId, e.activity, e.description, e.billable, e.rate);
    return { id: Number(info.lastInsertRowid) };
  });

  app.patch('/api/time/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const existing = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id) as Row | undefined;
    if (!existing) notFound('Time entry not found');
    const b = (req.body ?? {}) as Row;
    const e = readEntry(b, existing);
    // Editing the length of a finished timer entry turns it into a plain entry.
    const touchedTime = 'minutes' in b || 'hours' in b;
    db.prepare(
      `UPDATE time_entries SET date=?, minutes=?, client_id=?, project_id=?, trip_id=?, activity=?, description=?, billable=?, rate_cents=?,
              started_at = CASE WHEN ? AND ended_at IS NOT NULL THEN NULL ELSE started_at END,
              ended_at = CASE WHEN ? AND ended_at IS NOT NULL THEN NULL ELSE ended_at END
        WHERE id=?`,
    ).run(e.date, e.minutes, e.clientId, e.projectId, e.tripId, e.activity, e.description, e.billable, e.rate, touchedTime ? 1 : 0, touchedTime ? 1 : 0, id);
    return { ok: true };
  });

  app.delete('/api/time/:id', async (req) => {
    db.prepare('DELETE FROM time_entries WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  app.put('/api/time/settings', async (req) => {
    const b = (req.body ?? {}) as Row;
    for (const [key, setting] of [
      ['targetHourlyCents', 'time_target_hourly_cents'],
      ['defaultRateCents', 'time_default_rate_cents'],
    ] as const) {
      if (!(key in b)) continue;
      const v = b[key] === null || b[key] === '' ? null : Math.round(Number(b[key]));
      if (v !== null && !(v >= 0)) badRequest('Rates must be positive amounts');
      setSetting(db, setting, v);
    }
    return settings(db);
  });

  /** Turn a client's unbilled billable time into a draft invoice. */
  app.post('/api/time/invoice', async (req) => {
    const b = (req.body ?? {}) as Row;
    const clientId = toInt(b.clientId, 'clientId');
    if (!db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) badRequest('Choose a client');
    const { defaultRateCents } = settings(db);
    const ids: number[] | null = Array.isArray(b.entryIds) ? b.entryIds.map(Number) : null;
    const rows = (
      db
        .prepare(`${SELECT} WHERE e.client_id = ? AND e.billable = 1 AND e.invoice_id IS NULL AND (e.ended_at IS NOT NULL OR e.started_at IS NULL) ORDER BY e.date, e.id`)
        .all(clientId) as Row[]
    ).filter((r) => !ids || ids.includes(r.id));
    const entries = rows.map((r) => entryToApi(r, defaultRateCents)).filter((e) => e.minutes > 0);
    if (!entries.length) badRequest('No unbilled time for this client');
    if (entries.some((e) => !e.rateCents)) badRequest('Set an hourly rate for this client (or a default rate) first');
    const id = db.transaction(() => {
      const issue = todayIso();
      const info = db
        .prepare("INSERT INTO invoices (client_id, number, issue_date, due_date, status, notes) VALUES (?, ?, ?, ?, 'draft', ?)")
        .run(clientId, nextInvoiceNumber(db), issue, addDays(issue, 30), 'Created from tracked time.');
      const invId = Number(info.lastInsertRowid);
      replaceLines(
        db,
        invId,
        entries.map((e) => ({
          description: `${e.date} — ${e.description ?? ACTIVITY_LABEL[e.activity]}${e.projectName ? ` (${e.projectName})` : ''} · ${formatMinutes(e.minutes)}`,
          quantity: Math.round((e.minutes / 60) * 100) / 100,
          unitCents: e.rateCents!,
        })),
      );
      const mark = db.prepare('UPDATE time_entries SET invoice_id = ? WHERE id = ?');
      for (const e of entries) mark.run(invId, e.id);
      return invId;
    })();
    return { invoiceId: id, entries: entries.length };
  });

  app.get('/api/time/summary', async (req) => {
    const year = optInt((req.query as Row).year) ?? Number(todayIso().slice(0, 4));
    const today = todayIso();
    const { from, to } = yearRange(year);
    const { defaultRateCents, targetHourlyCents } = settings(db);
    const entries = (db.prepare(`${SELECT} WHERE e.date BETWEEN ? AND ?`).all(from, to) as Row[]).map((r) => entryToApi(r, defaultRateCents));
    const sum = (list: typeof entries) => list.reduce((s, e) => s + e.minutes, 0);
    const wk = weekStart(today);
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(wk, -7 * (11 - i)));
    const recent = (db.prepare(`${SELECT} WHERE e.date >= ?`).all(weeks[0]) as Row[]).map((r) => entryToApi(r, defaultRateCents));
    const unbilled = entries.filter((e) => e.billable && !e.invoiceId && !e.running);
    const sc = scheduleCFor(db, year, today < to ? today : to);
    const total = sum(entries);
    return {
      year,
      settings: { targetHourlyCents, defaultRateCents },
      todayMinutes: sum(recent.filter((e) => e.date === today)),
      weekMinutes: sum(recent.filter((e) => e.date >= wk)),
      totalMinutes: total,
      billableMinutes: sum(entries.filter((e) => e.billable)),
      unbilledMinutes: sum(unbilled),
      unbilledValueCents: unbilled.reduce((s, e) => s + e.valueCents, 0),
      netProfitCents: sc.line31NetProfitCents,
      effectiveHourlyCents: perHourCents(sc.line31NetProfitCents, total),
      byActivity: allocation(entries, (e) => e.activity).map((a) => ({ ...a, label: ACTIVITY_LABEL[a.key as Activity] })),
      byClient: allocation(entries, (e) => e.clientName ?? '(no client)').map((a) => ({ ...a, label: a.key })),
      weekly: weeks.map((w) => {
        const inWeek = recent.filter((e) => e.date >= w && e.date < addDays(w, 7));
        return { weekStart: w, billableMinutes: sum(inWeek.filter((e) => e.billable)), otherMinutes: sum(inWeek.filter((e) => !e.billable)) };
      }),
      unbilledByClient: [...new Set(unbilled.filter((e) => e.clientId).map((e) => e.clientId!))].map((id) => {
        const mine = unbilled.filter((e) => e.clientId === id);
        return { clientId: id, clientName: mine[0].clientName, minutes: sum(mine), valueCents: mine.reduce((s, e) => s + e.valueCents, 0), missingRate: mine.some((e) => !e.rateCents) };
      }),
    };
  });

  // ----- Profitability: what each client and project really pays per hour -----
  app.get('/api/profitability', async (req) => {
    const year = optInt((req.query as Row).year) ?? Number(todayIso().slice(0, 4));
    const { from, to } = yearRange(year);
    const { defaultRateCents, targetHourlyCents } = settings(db);
    const entries = (db.prepare(`${SELECT} WHERE e.date BETWEEN ? AND ?`).all(from, to) as Row[]).map((r) => ({
      ...entryToApi(r, defaultRateCents),
      // Time logged on a client's trip counts for that client.
      effectiveClientId: (r.client_id ?? r.trip_client_id ?? null) as number | null,
    }));
    const incomeFor = (where: string, params: unknown[]) =>
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(l.amount_cents), 0) AS s FROM ledger_lines l JOIN categories c ON c.id = l.category_id
              WHERE c.kind = 'income' AND l.classification = 'business' AND l.status = 'reviewed' AND l.date BETWEEN ? AND ? AND ${where}`,
          )
          .get(from, to, ...params) as { s: number }
      ).s;

    const row = (key: string, name: string, inc: number, cost: number, mine: typeof entries): ProfitInput => {
      const unbilled = mine.filter((e) => e.billable && !e.invoiceId);
      return {
        key,
        name,
        incomeCents: inc,
        directCostCents: cost,
        minutes: mine.reduce((s, e) => s + e.minutes, 0),
        billableMinutes: mine.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0),
        unbilledValueCents: unbilled.reduce((s, e) => s + e.valueCents, 0),
      };
    };

    const clients = (db.prepare('SELECT id, name, hourly_rate_cents FROM clients').all() as Row[])
      .map((c) => {
        const tripWhere = '(l.client_id = ? OR (l.client_id IS NULL AND l.trip_id IN (SELECT id FROM business_trips WHERE client_id = ?)))';
        return {
          ...row(
            `c${c.id}`,
            c.name,
            incomeFor('l.client_id = ?', [c.id]),
            expenseTotal(db, `${tripWhere} AND l.date BETWEEN ? AND ?`, [c.id, c.id, from, to]),
            entries.filter((e) => e.effectiveClientId === c.id),
          ),
          clientId: c.id as number,
          hourlyRateCents: c.hourly_rate_cents as number | null,
        };
      })
      .filter((r) => r.incomeCents || r.directCostCents || r.minutes);

    const projects = (db.prepare('SELECT p.id, p.name, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id').all() as Row[])
      .map((p) => ({
        ...row(
          `p${p.id}`,
          p.client_name ? `${p.name} · ${p.client_name}` : p.name,
          incomeFor('l.project_id = ?', [p.id]),
          expenseTotal(db, 'l.project_id = ? AND l.date BETWEEN ? AND ?', [p.id, from, to]),
          entries.filter((e) => e.projectId === p.id),
        ),
        projectId: p.id as number,
      }))
      .filter((r) => r.incomeCents || r.directCostCents || r.minutes);

    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    const noClientMinutes = entries.filter((e) => !e.effectiveClientId).reduce((s, e) => s + e.minutes, 0);
    const sc = scheduleCFor(db, year, todayIso() < to ? todayIso() : to);
    return {
      year,
      targetHourlyCents,
      clients: profitability(clients, targetHourlyCents).map((r) => ({ ...r, clientId: (r as any).clientId, hourlyRateCents: (r as any).hourlyRateCents })),
      projects: profitability(projects, targetHourlyCents).map((r) => ({ ...r, projectId: (r as any).projectId })),
      overall: {
        netProfitCents: sc.line31NetProfitCents,
        minutes: totalMinutes,
        effectiveHourlyCents: perHourCents(sc.line31NetProfitCents, totalMinutes),
        // Hours not tied to any client: admin, marketing, learning… the cost of running the business.
        overheadMinutes: noClientMinutes,
        overheadPct: totalMinutes ? Math.round((noClientMinutes / totalMinutes) * 1000) / 10 : 0,
      },
    };
  });

  // ----- Car: standard mileage rate vs actual expenses -----
  const vehicleRow = (year: number) => (db.prepare('SELECT * FROM vehicle_years WHERE year = ?').get(year) as Row | undefined) ?? null;

  app.get('/api/vehicle/:year', async (req) => {
    const year = toInt((req.params as Row).year, 'year');
    const { from, to } = yearRange(year);
    const v = vehicleRow(year);
    const operating = db
      .prepare(
        `SELECT COALESCE(SUM(-l.amount_cents), 0) AS s, COUNT(*) AS n FROM ledger_lines l JOIN categories c ON c.id = l.category_id
          WHERE c.key = 'vehicle_actual' AND l.status = 'reviewed' AND COALESCE(l.classification, '') != 'transfer'
            AND l.amount_cents < 0 AND l.date BETWEEN ? AND ?`,
      )
      .get(from, to) as { s: number; n: number };
    const drives = mileageDeductionCents(db, from, to);
    const rates = (db.prepare("SELECT effective_from, effective_to, cents_per_mile FROM mileage_rates WHERE kind = 'business'").all() as Row[]).map((r) => ({
      from: r.effective_from,
      to: r.effective_to,
      centsPerMile: r.cents_per_mile,
    }));
    const avgRate = averageRateForYear(year, rates);
    const fromDrives = drives.miles > 0;
    const businessMiles = fromDrives ? drives.miles : (v?.business_miles ?? 0);
    const standard = fromDrives ? drives.cents : Math.round(businessMiles * avgRate);
    const inputs = {
      vehicleName: v?.vehicle_name ?? null,
      totalMiles: v?.total_miles ?? 0,
      businessMiles: v?.business_miles ?? 0,
      insuranceCents: v?.insurance_cents ?? 0,
      registrationCents: v?.registration_cents ?? 0,
      loanInterestCents: v?.loan_interest_cents ?? 0,
      leaseCents: v?.lease_cents ?? 0,
      depreciationCents: v?.depreciation_cents ?? 0,
      otherCents: v?.other_cents ?? 0,
      firstYearMethod: (v?.first_year_method ?? null) as 'standard' | 'actual' | null,
    };
    return {
      year,
      saved: !!v,
      inputs,
      mileageMethod: getSetting(db, 'mileage_method', 'standard'),
      milesSource: fromDrives ? 'drives' : 'manual',
      averageRateCents: Math.round(avgRate * 1000) / 1000,
      operatingCents: operating.s,
      operatingCount: operating.n,
      comparison: vehicleComparison({ ...inputs, businessMiles, operatingCents: operating.s, standardDeductionCents: standard }),
    };
  });

  app.put('/api/vehicle/:year', async (req) => {
    const year = toInt((req.params as Row).year, 'year');
    const b = (req.body ?? {}) as Row;
    const num = (k: string) => {
      const n = Number(b[k] ?? 0);
      if (!Number.isFinite(n) || n < 0) badRequest('Amounts and miles must be positive numbers');
      return n;
    };
    const cents = (k: string) => Math.round(num(k));
    const total = num('totalMiles');
    const business = num('businessMiles');
    if (business > total && total > 0) badRequest('Business miles can’t be more than total miles');
    const first = optStr(b.firstYearMethod) ?? null;
    if (first && first !== 'standard' && first !== 'actual') badRequest('Unknown method');
    db.prepare(
      `INSERT INTO vehicle_years (year, vehicle_name, total_miles, business_miles, insurance_cents, registration_cents, loan_interest_cents, lease_cents, depreciation_cents, other_cents, first_year_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(year) DO UPDATE SET vehicle_name=excluded.vehicle_name, total_miles=excluded.total_miles, business_miles=excluded.business_miles,
         insurance_cents=excluded.insurance_cents, registration_cents=excluded.registration_cents, loan_interest_cents=excluded.loan_interest_cents,
         lease_cents=excluded.lease_cents, depreciation_cents=excluded.depreciation_cents, other_cents=excluded.other_cents, first_year_method=excluded.first_year_method`,
    ).run(
      year,
      optStr(b.vehicleName) ?? null,
      total,
      business,
      cents('insuranceCents'),
      cents('registrationCents'),
      cents('loanInterestCents'),
      cents('leaseCents'),
      cents('depreciationCents'),
      cents('otherCents'),
      first,
    );
    return { ok: true };
  });
}
