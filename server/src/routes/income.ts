import {
  contractor1099,
  expectedClient1099s,
  inferPaymentMethod,
  invoicePaymentCandidates,
  invoiceState,
  invoiceTotal,
  necDeadline,
  necThresholdCents,
  retainerSchedule,
  todayIso,
  addDays,
  type ContractorFacts,
  type Deposit,
  type EntityType,
  type Frequency,
  type InvoiceLine,
  type PaymentMethod,
  type RetainerFacts,
} from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { getSetting, setSetting, type DB } from '../db/database';
import { transactionToApi, type TransactionRow } from '../db/rows';
import { bulkUpdate } from '../services/transactionService';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const FREQS: Frequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const ENTITY_TYPES: EntityType[] = ['individual', 'sole_prop', 'llc', 'partnership', 's_corp', 'c_corp', 'other'];

type Row = Record<string, any>;

function yearRange(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function isoOrNull(v: unknown, name: string): string | null {
  const s = optStr(v);
  if (!s) return null;
  if (!ISO.test(s)) badRequest(`${name} must be a date (YYYY-MM-DD)`);
  return s;
}

function cents(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) badRequest(`${name} must be an amount in cents`);
  return Math.round(n);
}

// ---------------------------------------------------------------------------
// Shared queries
// ---------------------------------------------------------------------------

/** Business income lines (reviewed) with the account type for payment-method inference. */
function incomeLines(db: DB, from: string, to: string) {
  return db
    .prepare(
      `SELECT l.transaction_id, l.date, l.amount_cents, l.client_id, l.project_id, l.trip_id,
              t.description, t.payment_method, a.type AS account_type
         FROM ledger_lines l
         JOIN categories c ON c.id = l.category_id
         JOIN transactions t ON t.id = l.transaction_id
         JOIN accounts a ON a.id = l.account_id
        WHERE c.kind = 'income' AND l.classification = 'business' AND l.status = 'reviewed'
          AND l.date BETWEEN ? AND ?`,
    )
    .all(from, to) as {
    transaction_id: number;
    date: string;
    amount_cents: number;
    client_id: number | null;
    project_id: number | null;
    trip_id: number | null;
    description: string;
    payment_method: PaymentMethod | null;
    account_type: string;
  }[];
}

/** Business expense lines (reviewed), as positive "spent" numbers. */
export function expenseTotal(db: DB, where: string, params: unknown[]): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(-l.amount_cents), 0) AS spent
         FROM ledger_lines l JOIN categories c ON c.id = l.category_id
        WHERE c.kind = 'expense' AND l.classification = 'business' AND l.status = 'reviewed'
          AND c.tax_line NOT IN ('EST-FED','EST-STATE','NONE') AND ${where}`,
    )
    .get(...params) as { spent: number };
  return r.spent;
}

/** Deposits that could be client payments (any status, money in, not transfers). */
function deposits(db: DB, from: string, to: string): (Deposit & { description: string })[] {
  return (
    db
      .prepare(
        `SELECT id, date, amount_cents, client_id, description FROM transactions
          WHERE amount_cents > 0 AND date BETWEEN ? AND ? AND COALESCE(classification, '') NOT IN ('transfer', 'personal')`,
      )
      .all(from, to) as { id: number; date: string; amount_cents: number; client_id: number | null; description: string }[]
  ).map((d) => ({ id: d.id, date: d.date, amountCents: d.amount_cents, clientId: d.client_id, description: d.description }));
}

function linkedPaymentTxIds(db: DB): Set<number> {
  return new Set(
    (db.prepare('SELECT transaction_id FROM invoice_payments WHERE transaction_id IS NOT NULL').all() as { transaction_id: number }[]).map(
      (r) => r.transaction_id,
    ),
  );
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export function invoiceDetail(db: DB, inv: Row, today = todayIso()) {
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort, id').all(inv.id) as Row[];
  const payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY date, id').all(inv.id) as Row[];
  const apiLines: (InvoiceLine & { id: number })[] = lines.map((l) => ({
    id: l.id,
    description: l.description,
    quantity: l.quantity,
    unitCents: l.unit_cents,
  }));
  const totalCents = invoiceTotal(apiLines);
  const paidCents = payments.reduce((s, p) => s + p.amount_cents, 0);
  const state = invoiceState({ status: inv.status, dueDate: inv.due_date }, totalCents, paidCents, today);
  const client = db.prepare('SELECT id, name, email, address FROM clients WHERE id = ?').get(inv.client_id) as Row | undefined;
  return {
    id: inv.id as number,
    clientId: inv.client_id as number,
    clientName: (client?.name as string) ?? '',
    client: client ?? null,
    projectId: inv.project_id as number | null,
    tripId: inv.trip_id as number | null,
    number: inv.number as string | null,
    issueDate: inv.issue_date as string,
    dueDate: inv.due_date as string | null,
    status: inv.status as 'draft' | 'sent' | 'void',
    notes: inv.notes as string | null,
    lines: apiLines,
    payments: payments.map((p) => ({ id: p.id, transactionId: p.transaction_id, amountCents: p.amount_cents, date: p.date, note: p.note })),
    totalCents,
    paidCents,
    balanceCents: Math.max(0, totalCents - paidCents),
    state,
  };
}

type InvoiceApi = ReturnType<typeof invoiceDetail>;

function withCandidates(db: DB, invs: InvoiceApi[]) {
  const open = invs.filter((i) => i.state === 'open' || i.state === 'overdue' || i.state === 'partial');
  if (open.length === 0) return invs.map((i) => ({ ...i, candidates: [] as (Deposit & { description: string })[] }));
  const minDate = open.map((i) => i.issueDate).sort()[0];
  const linked = linkedPaymentTxIds(db);
  const deps = deposits(db, addDays(minDate, -3), '9999-12-31').filter((d) => !linked.has(d.id));
  return invs.map((i) => ({
    ...i,
    candidates:
      i.state === 'open' || i.state === 'overdue' || i.state === 'partial'
        ? (invoicePaymentCandidates({ clientId: i.clientId, issueDate: i.issueDate, balanceCents: i.balanceCents }, deps) as (Deposit & {
            description: string;
          })[]).slice(0, 3)
        : [],
  }));
}

function readLines(v: unknown): InvoiceLine[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((l: any) => ({
      description: String(l?.description ?? '').trim(),
      quantity: Number(l?.quantity ?? 1),
      unitCents: Math.round(Number(l?.unitCents ?? 0)),
    }))
    .filter((l) => l.description || l.unitCents);
}

function replaceLines(db: DB, invoiceId: number, lines: InvoiceLine[]) {
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId);
  const ins = db.prepare('INSERT INTO invoice_lines (invoice_id, description, quantity, unit_cents, sort) VALUES (?, ?, ?, ?, ?)');
  lines.forEach((l, i) => {
    if (!Number.isFinite(l.quantity) || !Number.isFinite(l.unitCents)) badRequest('Each line needs a quantity and price');
    ins.run(invoiceId, l.description || 'Services', l.quantity, l.unitCents, i);
  });
}

function nextInvoiceNumber(db: DB): string {
  const prefix = getSetting<string>(db, 'invoice_prefix', 'INV-');
  const n = getSetting<number>(db, 'invoice_next_number', 1001);
  setSetting(db, 'invoice_next_number', n + 1);
  return `${prefix}${n}`;
}

// ---------------------------------------------------------------------------
// Contractors / 1099
// ---------------------------------------------------------------------------
function contractorFacts(r: Row): ContractorFacts {
  return {
    id: r.id,
    name: r.name,
    entityType: r.entity_type,
    w9Received: !!r.w9_received,
    tinLast4: r.tin_last4,
    address: r.address,
  };
}

function contractorPayments(db: DB, contractorId: number | null, from?: string, to?: string) {
  const where = ['t.contractor_id IS NOT NULL', 't.amount_cents < 0'];
  const params: unknown[] = [];
  if (contractorId) {
    where.push('t.contractor_id = ?');
    params.push(contractorId);
  }
  if (from) {
    where.push('t.date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('t.date <= ?');
    params.push(to);
  }
  const rows = db
    .prepare(`SELECT t.*, a.type AS account_type FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE ${where.join(' AND ')} ORDER BY t.date DESC`)
    .all(...params) as (TransactionRow & { account_type: string })[];
  return rows.map((t) => ({
    row: t,
    method: (t.payment_method ?? inferPaymentMethod(t.description, t.account_type)) as PaymentMethod,
    methodInferred: !t.payment_method,
  }));
}

function contractorSummaries(db: DB, year: number) {
  const { from, to } = yearRange(year);
  const contractors = db.prepare('SELECT * FROM contractors ORDER BY archived, name COLLATE NOCASE').all() as Row[];
  const pays = contractorPayments(db, null, from, to);
  return contractors.map((c) => {
    const mine = pays.filter((p) => p.row.contractor_id === c.id);
    const summary = contractor1099(
      contractorFacts(c),
      mine.map((p) => ({ date: p.row.date, paidCents: -p.row.amount_cents, method: p.method })),
      year,
    );
    return { ...contractorToApi(c), summary, paymentCount: mine.length };
  });
}

function contractorToApi(c: Row) {
  return {
    id: c.id as number,
    name: c.name as string,
    businessName: c.business_name as string | null,
    email: c.email as string | null,
    address: c.address as string | null,
    tinLast4: c.tin_last4 as string | null,
    entityType: c.entity_type as EntityType,
    w9Received: !!c.w9_received,
    w9Date: c.w9_date as string | null,
    notes: c.notes as string | null,
    archived: !!c.archived,
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Retainers
// ---------------------------------------------------------------------------
function retainerFacts(r: Row): RetainerFacts {
  return {
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    amountCents: r.amount_cents,
    frequency: r.frequency,
    startDate: r.start_date,
    endDate: r.end_date,
    active: !!r.active,
  };
}

function schedule(db: DB, from: string, to: string, clientId?: number) {
  const rows = (
    clientId
      ? db.prepare('SELECT * FROM retainers WHERE client_id = ?').all(clientId)
      : db.prepare('SELECT * FROM retainers').all()
  ) as Row[];
  const deps = deposits(db, addDays(from, -15), addDays(to, 15));
  const names = new Map((db.prepare('SELECT id, name FROM clients').all() as Row[]).map((c) => [c.id as number, c.name as string]));
  return retainerSchedule(rows.map(retainerFacts), deps, from, to, todayIso()).map((e) => ({
    ...e,
    clientName: names.get(e.clientId) ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export function incomeRoutes(app: FastifyInstance, ctx: AppContext) {
  // ----- Clients -----
  app.get('/api/clients', async (req) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    const { from, to } = yearRange(year);
    const db = ctx.db;
    const clients = db.prepare('SELECT * FROM clients ORDER BY archived, name COLLATE NOCASE').all() as Row[];
    const yearLines = incomeLines(db, from, to);
    const allLines = incomeLines(db, '0000-01-01', '9999-12-31');
    const invs = (db.prepare("SELECT * FROM invoices WHERE status = 'sent'").all() as Row[]).map((i) => invoiceDetail(db, i));
    const retainers = db.prepare('SELECT client_id, COUNT(*) AS n FROM retainers WHERE active = 1 GROUP BY client_id').all() as Row[];
    const retBy = new Map(retainers.map((r) => [r.client_id as number, r.n as number]));
    return clients.map((c) => {
      const mine = yearLines.filter((l) => l.client_id === c.id);
      const all = allLines.filter((l) => l.client_id === c.id);
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        notes: c.notes,
        archived: !!c.archived,
        yearIncomeCents: mine.reduce((s, l) => s + l.amount_cents, 0),
        allTimeIncomeCents: all.reduce((s, l) => s + l.amount_cents, 0),
        lastPaymentDate: all.map((l) => l.date).sort().pop() ?? null,
        outstandingCents: invs.filter((i) => i.clientId === c.id).reduce((s, i) => s + i.balanceCents, 0),
        activeRetainers: retBy.get(c.id) ?? 0,
      };
    });
  });

  app.post('/api/clients', async (req) => {
    const b = (req.body ?? {}) as Row;
    const name = optStr(b.name);
    if (!name) badRequest('Client name is required');
    try {
      const info = ctx.db
        .prepare('INSERT INTO clients (name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?)')
        .run(name, optStr(b.email) ?? null, optStr(b.phone) ?? null, optStr(b.address) ?? null, optStr(b.notes) ?? null);
      return ctx.db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
    } catch (e) {
      if (String(e).includes('UNIQUE')) badRequest('A client with that name already exists');
      throw e;
    }
  });

  app.patch('/api/clients/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const c = ctx.db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as Row | undefined;
    if (!c) notFound('Client not found');
    const b = (req.body ?? {}) as Row;
    const pick = (k: string, col: string) => (b[k] !== undefined ? optStr(b[k]) ?? null : c[col]);
    ctx.db
      .prepare('UPDATE clients SET name = ?, email = ?, phone = ?, address = ?, notes = ?, archived = ? WHERE id = ?')
      .run(
        optStr(b.name) ?? c.name,
        pick('email', 'email'),
        pick('phone', 'phone'),
        pick('address', 'address'),
        pick('notes', 'notes'),
        b.archived !== undefined ? (b.archived ? 1 : 0) : c.archived,
        id,
      );
    return ctx.db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  });

  app.delete('/api/clients/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?').get(id) as Row).n;
    if (n > 0) badRequest(`This client has ${n} invoice(s). Archive the client instead.`);
    ctx.db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    return { ok: true };
  });

  app.get('/api/clients/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    const { from, to } = yearRange(year);
    const db = ctx.db;
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as Row | undefined;
    if (!c) notFound('Client not found');
    const lines = incomeLines(db, from, to).filter((l) => l.client_id === id);
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${String(i + 1).padStart(2, '0')}`;
      return { month: m, incomeCents: lines.filter((l) => l.date.startsWith(m)).reduce((s, l) => s + l.amount_cents, 0) };
    });
    const incomeCents = lines.reduce((s, l) => s + l.amount_cents, 0);
    const expenseCents = expenseTotal(db, 'l.client_id = ? AND l.date BETWEEN ? AND ?', [id, from, to]);
    const invoices = withCandidates(
      db,
      (db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY issue_date DESC').all(id) as Row[]).map((i) => invoiceDetail(db, i)),
    );
    const projects = db.prepare('SELECT * FROM projects WHERE client_id = ? ORDER BY status, name').all(id) as Row[];
    const retainers = db.prepare('SELECT * FROM retainers WHERE client_id = ? ORDER BY active DESC, start_date').all(id) as Row[];
    const trips = db.prepare('SELECT id, name, start_date, end_date FROM business_trips WHERE client_id = ? ORDER BY start_date DESC').all(id) as Row[];
    const txs = db
      .prepare('SELECT * FROM transactions WHERE client_id = ? ORDER BY date DESC LIMIT 200')
      .all(id) as TransactionRow[];
    return {
      client: { ...c, archived: !!c.archived },
      year,
      incomeCents,
      expenseCents,
      profitCents: incomeCents - expenseCents,
      monthly,
      invoices,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        budgetCents: p.budget_cents,
        incomeCents: incomeLines(db, '0000-01-01', '9999-12-31').filter((l) => l.project_id === p.id).reduce((s, l) => s + l.amount_cents, 0),
        expenseCents: expenseTotal(db, 'l.project_id = ?', [p.id]),
      })),
      retainers: retainers.map((r) => ({ ...retainerFacts(r), notes: r.notes })),
      schedule: schedule(db, from, to, id),
      trips: trips.map((t) => ({ id: t.id, name: t.name, startDate: t.start_date, endDate: t.end_date })),
      transactions: txs.map((t) => transactionToApi(t)),
    };
  });

  // ----- Projects -----
  app.get('/api/projects', async (req) => {
    const clientId = optInt((req.query as Row).clientId);
    const rows = (
      clientId
        ? ctx.db.prepare('SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.client_id = ? ORDER BY p.name').all(clientId)
        : ctx.db.prepare('SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.status, p.name').all()
    ) as Row[];
    return rows.map((p) => ({ id: p.id, clientId: p.client_id, clientName: p.client_name, name: p.name, status: p.status, budgetCents: p.budget_cents, notes: p.notes }));
  });

  app.post('/api/projects', async (req) => {
    const b = (req.body ?? {}) as Row;
    const name = optStr(b.name);
    if (!name) badRequest('Project name is required');
    const info = ctx.db
      .prepare('INSERT INTO projects (client_id, name, budget_cents, notes) VALUES (?, ?, ?, ?)')
      .run(optInt(b.clientId) ?? null, name, b.budgetCents ? cents(b.budgetCents, 'budget') : null, optStr(b.notes) ?? null);
    return { id: Number(info.lastInsertRowid) };
  });

  app.patch('/api/projects/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const p = ctx.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    if (!p) notFound('Project not found');
    const b = (req.body ?? {}) as Row;
    const status = optStr(b.status) ?? p.status;
    if (!['active', 'completed', 'archived'].includes(status)) badRequest('Unknown status');
    ctx.db
      .prepare('UPDATE projects SET name = ?, status = ?, budget_cents = ?, notes = ?, client_id = ? WHERE id = ?')
      .run(
        optStr(b.name) ?? p.name,
        status,
        b.budgetCents !== undefined ? (b.budgetCents === null ? null : cents(b.budgetCents, 'budget')) : p.budget_cents,
        b.notes !== undefined ? optStr(b.notes) ?? null : p.notes,
        b.clientId !== undefined ? optInt(b.clientId) ?? null : p.client_id,
        id,
      );
    return { ok: true };
  });

  app.delete('/api/projects/:id', async (req) => {
    ctx.db.prepare('DELETE FROM projects WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  // ----- Contractors & 1099-NEC -----
  app.get('/api/contractors', async (req) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    return contractorSummaries(ctx.db, year);
  });

  function readContractor(b: Row, existing?: Row) {
    const entity = optStr(b.entityType) ?? existing?.entity_type ?? 'individual';
    if (!ENTITY_TYPES.includes(entity as EntityType)) badRequest('Unknown business type');
    const tin = b.tinLast4 !== undefined ? optStr(b.tinLast4)?.replace(/\D/g, '').slice(-4) ?? null : existing?.tin_last4 ?? null;
    const pick = (k: string, col: string) => (b[k] !== undefined ? optStr(b[k]) ?? null : existing?.[col] ?? null);
    return {
      name: optStr(b.name) ?? existing?.name,
      businessName: pick('businessName', 'business_name'),
      email: pick('email', 'email'),
      address: pick('address', 'address'),
      tin,
      entity,
      w9: b.w9Received !== undefined ? (b.w9Received ? 1 : 0) : existing?.w9_received ?? 0,
      w9Date: b.w9Date !== undefined ? isoOrNull(b.w9Date, 'W-9 date') : existing?.w9_date ?? null,
      notes: pick('notes', 'notes'),
      archived: b.archived !== undefined ? (b.archived ? 1 : 0) : existing?.archived ?? 0,
    };
  }

  app.post('/api/contractors', async (req) => {
    const c = readContractor((req.body ?? {}) as Row);
    if (!c.name) badRequest('Contractor name is required');
    try {
      const info = ctx.db
        .prepare(
          `INSERT INTO contractors (name, business_name, email, address, tin_last4, entity_type, w9_received, w9_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(c.name, c.businessName, c.email, c.address, c.tin, c.entity, c.w9, c.w9Date, c.notes);
      return contractorToApi(ctx.db.prepare('SELECT * FROM contractors WHERE id = ?').get(info.lastInsertRowid) as Row);
    } catch (e) {
      if (String(e).includes('UNIQUE')) badRequest('A contractor with that name already exists');
      throw e;
    }
  });

  app.patch('/api/contractors/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const existing = ctx.db.prepare('SELECT * FROM contractors WHERE id = ?').get(id) as Row | undefined;
    if (!existing) notFound('Contractor not found');
    const c = readContractor((req.body ?? {}) as Row, existing);
    ctx.db
      .prepare(
        `UPDATE contractors SET name=?, business_name=?, email=?, address=?, tin_last4=?, entity_type=?, w9_received=?, w9_date=?,
                notes=?, archived=? WHERE id=?`,
      )
      .run(c.name, c.businessName, c.email, c.address, c.tin, c.entity, c.w9, c.w9Date, c.notes, c.archived, id);
    return contractorToApi(ctx.db.prepare('SELECT * FROM contractors WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/contractors/:id', async (req) => {
    ctx.db.prepare('DELETE FROM contractors WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  app.get('/api/contractors/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    const c = ctx.db.prepare('SELECT * FROM contractors WHERE id = ?').get(id) as Row | undefined;
    if (!c) notFound('Contractor not found');
    const pays = contractorPayments(ctx.db, id);
    const summary = contractor1099(
      contractorFacts(c),
      pays.map((p) => ({ date: p.row.date, paidCents: -p.row.amount_cents, method: p.method })),
      year,
    );
    return {
      contractor: contractorToApi(c),
      summary,
      payments: pays.map((p) => ({ ...transactionToApi(p.row), method: p.method, methodInferred: p.methodInferred })),
    };
  });

  app.get('/api/reports/1099-nec', async (req) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear() - 1;
    const rows = contractorSummaries(ctx.db, year).filter((c) => c.summary.totalCents > 0);
    return {
      year,
      thresholdCents: necThresholdCents(year),
      deadline: necDeadline(year),
      rows,
      needCount: rows.filter((r) => r.summary.needs1099).length,
    };
  });

  app.get('/api/reports/1099-nec.csv', async (req, reply) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear() - 1;
    const rows = contractorSummaries(ctx.db, year).filter((c) => c.summary.needs1099);
    const header = ['Recipient name', 'Business name', 'Entity type', 'TIN (last 4 only)', 'Address', 'Email', 'Box 1 nonemployee compensation', 'W-9 on file', 'Warnings'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push(
        [r.name, r.businessName, r.entityType, r.tinLast4, r.address, r.email, (r.summary.directCents / 100).toFixed(2), r.w9Received ? 'yes' : 'no', r.summary.warnings.join(' ')]
          .map(csvCell)
          .join(','),
      );
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="1099-NEC-${year}.csv"`);
    return lines.join('\r\n') + '\r\n';
  });

  app.get('/api/reports/client-1099s', async (req) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    const { from, to } = yearRange(year);
    const lines = incomeLines(ctx.db, from, to).filter((l) => l.client_id);
    const names = new Map((ctx.db.prepare('SELECT id, name FROM clients').all() as Row[]).map((c) => [c.id as number, c.name as string]));
    const totals = new Map<number, { clientId: number; name: string; directCents: number; processorCents: number }>();
    for (const l of lines) {
      const t = totals.get(l.client_id!) ?? { clientId: l.client_id!, name: names.get(l.client_id!) ?? '', directCents: 0, processorCents: 0 };
      const method = l.payment_method ?? inferPaymentMethod(l.description, 'checking');
      if (method === 'direct') t.directCents += l.amount_cents;
      else t.processorCents += l.amount_cents;
      totals.set(l.client_id!, t);
    }
    return { year, thresholdCents: necThresholdCents(year), rows: expectedClient1099s([...totals.values()], year) };
  });

  // ----- Invoices -----
  app.get('/api/invoices', async (req) => {
    const q = req.query as Row;
    const where: string[] = [];
    const params: unknown[] = [];
    if (optInt(q.clientId)) {
      where.push('client_id = ?');
      params.push(optInt(q.clientId));
    }
    if (optInt(q.tripId)) {
      where.push('trip_id = ?');
      params.push(optInt(q.tripId));
    }
    const rows = ctx.db
      .prepare(`SELECT * FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY issue_date DESC, id DESC`)
      .all(...params) as Row[];
    let list = withCandidates(ctx.db, rows.map((r) => invoiceDetail(ctx.db, r)));
    const state = optStr(q.state);
    if (state === 'unpaid') list = list.filter((i) => ['open', 'overdue', 'partial'].includes(i.state));
    else if (state) list = list.filter((i) => i.state === state);
    return list;
  });

  app.get('/api/invoices/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const inv = ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Row | undefined;
    if (!inv) notFound('Invoice not found');
    const [detail] = withCandidates(ctx.db, [invoiceDetail(ctx.db, inv)]);
    const business = {
      name: getSetting(ctx.db, 'business_name', ''),
      address: getSetting(ctx.db, 'business_address', ''),
      email: getSetting(ctx.db, 'business_email', ''),
      phone: getSetting(ctx.db, 'business_phone', ''),
      footer: getSetting(ctx.db, 'invoice_footer', ''),
    };
    return { ...detail, business };
  });

  app.post('/api/invoices', async (req) => {
    const b = (req.body ?? {}) as Row;
    const clientId = toInt(b.clientId, 'clientId');
    if (!ctx.db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) badRequest('Choose a client');
    const issue = isoOrNull(b.issueDate, 'Issue date') ?? todayIso();
    const status = optStr(b.status) ?? 'sent';
    if (!['draft', 'sent', 'void'].includes(status)) badRequest('Unknown status');
    const lines = readLines(b.lines);
    const id = ctx.db.transaction(() => {
      const info = ctx.db
        .prepare('INSERT INTO invoices (client_id, project_id, trip_id, number, issue_date, due_date, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          clientId,
          optInt(b.projectId) ?? null,
          optInt(b.tripId) ?? null,
          optStr(b.number) ?? nextInvoiceNumber(ctx.db),
          issue,
          isoOrNull(b.dueDate, 'Due date') ?? addDays(issue, 30),
          status,
          optStr(b.notes) ?? null,
        );
      const newId = Number(info.lastInsertRowid);
      replaceLines(ctx.db, newId, lines);
      return newId;
    })();
    return invoiceDetail(ctx.db, ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Row);
  });

  app.patch('/api/invoices/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const inv = ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Row | undefined;
    if (!inv) notFound('Invoice not found');
    const b = (req.body ?? {}) as Row;
    const status = optStr(b.status) ?? inv.status;
    if (!['draft', 'sent', 'void'].includes(status)) badRequest('Unknown status');
    ctx.db.transaction(() => {
      ctx.db
        .prepare('UPDATE invoices SET client_id=?, project_id=?, trip_id=?, number=?, issue_date=?, due_date=?, status=?, notes=? WHERE id=?')
        .run(
          b.clientId !== undefined ? toInt(b.clientId, 'clientId') : inv.client_id,
          b.projectId !== undefined ? optInt(b.projectId) ?? null : inv.project_id,
          b.tripId !== undefined ? optInt(b.tripId) ?? null : inv.trip_id,
          b.number !== undefined ? optStr(b.number) ?? null : inv.number,
          b.issueDate !== undefined ? isoOrNull(b.issueDate, 'Issue date') ?? inv.issue_date : inv.issue_date,
          b.dueDate !== undefined ? isoOrNull(b.dueDate, 'Due date') : inv.due_date,
          status,
          b.notes !== undefined ? optStr(b.notes) ?? null : inv.notes,
          id,
        );
      if (b.lines !== undefined) replaceLines(ctx.db, id, readLines(b.lines));
    })();
    return invoiceDetail(ctx.db, ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/invoices/:id', async (req) => {
    ctx.db.prepare('DELETE FROM invoices WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  /**
   * Record a payment. With a transactionId the deposit is linked, tagged to
   * the client, and marked as business income.
   */
  app.post('/api/invoices/:id/payments', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const inv = ctx.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Row | undefined;
    if (!inv) notFound('Invoice not found');
    const detail = invoiceDetail(ctx.db, inv);
    const b = (req.body ?? {}) as Row;
    const txId = optInt(b.transactionId);
    let amount: number;
    let date: string;
    if (txId) {
      const t = ctx.db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as TransactionRow | undefined;
      if (!t) badRequest('Deposit not found');
      if (t.amount_cents <= 0) badRequest('That transaction is not a deposit');
      if (ctx.db.prepare('SELECT 1 FROM invoice_payments WHERE transaction_id = ?').get(txId)) badRequest('That deposit is already linked to an invoice');
      amount = b.amountCents !== undefined ? cents(b.amountCents, 'amount') : Math.min(t.amount_cents, detail.balanceCents || t.amount_cents);
      date = t.date;
      const cat = t.category_id ? (ctx.db.prepare('SELECT kind FROM categories WHERE id = ?').get(t.category_id) as Row | undefined) : undefined;
      const incomeCat = (ctx.db.prepare("SELECT id FROM categories WHERE key = 'income'").get() as Row).id as number;
      bulkUpdate(ctx.db, {
        ids: [txId],
        clientId: inv.client_id,
        ...(inv.project_id ? { projectId: inv.project_id } : {}),
        ...(inv.trip_id ? { tripId: inv.trip_id } : {}),
        ...(cat?.kind === 'income' && t.status === 'reviewed' ? {} : { categoryId: cat?.kind === 'income' ? t.category_id : incomeCat }),
      });
    } else {
      amount = cents(b.amountCents, 'amount');
      date = isoOrNull(b.date, 'Payment date') ?? todayIso();
    }
    if (amount <= 0) badRequest('Payment amount must be positive');
    ctx.db
      .prepare('INSERT INTO invoice_payments (invoice_id, transaction_id, amount_cents, date, note) VALUES (?, ?, ?, ?, ?)')
      .run(id, txId ?? null, amount, date, optStr(b.note) ?? null);
    return invoiceDetail(ctx.db, inv);
  });

  app.delete('/api/invoice-payments/:id', async (req) => {
    ctx.db.prepare('DELETE FROM invoice_payments WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  // ----- Retainers -----
  function readRetainer(b: Row, existing?: Row) {
    const freq = optStr(b.frequency) ?? existing?.frequency ?? 'monthly';
    if (!FREQS.includes(freq as Frequency)) badRequest('Unknown frequency');
    const start = b.startDate !== undefined ? isoOrNull(b.startDate, 'Start date') : existing?.start_date;
    if (!start) badRequest('Start date is required');
    return {
      clientId: b.clientId !== undefined ? toInt(b.clientId, 'clientId') : existing?.client_id,
      name: optStr(b.name) ?? existing?.name ?? 'Retainer',
      amount: b.amountCents !== undefined ? cents(b.amountCents, 'amount') : existing?.amount_cents,
      freq,
      start,
      end: b.endDate !== undefined ? isoOrNull(b.endDate, 'End date') : existing?.end_date ?? null,
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing?.active ?? 1,
      notes: b.notes !== undefined ? optStr(b.notes) ?? null : existing?.notes ?? null,
    };
  }

  app.get('/api/retainers', async () =>
    (ctx.db.prepare('SELECT r.*, c.name AS client_name FROM retainers r JOIN clients c ON c.id = r.client_id ORDER BY r.active DESC, c.name').all() as Row[]).map(
      (r) => ({ ...retainerFacts(r), clientName: r.client_name, notes: r.notes }),
    ),
  );

  app.post('/api/retainers', async (req) => {
    const r = readRetainer((req.body ?? {}) as Row);
    if (!r.clientId || !ctx.db.prepare('SELECT 1 FROM clients WHERE id = ?').get(r.clientId)) badRequest('Choose a client');
    if (!r.amount || r.amount <= 0) badRequest('Enter the retainer amount');
    const info = ctx.db
      .prepare('INSERT INTO retainers (client_id, name, amount_cents, frequency, start_date, end_date, active, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.clientId, r.name, r.amount, r.freq, r.start, r.end, r.active, r.notes);
    return { id: Number(info.lastInsertRowid) };
  });

  app.patch('/api/retainers/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const existing = ctx.db.prepare('SELECT * FROM retainers WHERE id = ?').get(id) as Row | undefined;
    if (!existing) notFound('Retainer not found');
    const r = readRetainer((req.body ?? {}) as Row, existing);
    ctx.db
      .prepare('UPDATE retainers SET client_id=?, name=?, amount_cents=?, frequency=?, start_date=?, end_date=?, active=?, notes=? WHERE id=?')
      .run(r.clientId, r.name, r.amount, r.freq, r.start, r.end, r.active, r.notes, id);
    return { ok: true };
  });

  app.delete('/api/retainers/:id', async (req) => {
    ctx.db.prepare('DELETE FROM retainers WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  app.get('/api/retainers/schedule', async (req) => {
    const q = req.query as Row;
    const from = isoOrNull(q.from, 'from') ?? `${new Date().getFullYear()}-01-01`;
    const to = isoOrNull(q.to, 'to') ?? addDays(todayIso(), 90);
    return schedule(ctx.db, from, to, optInt(q.clientId));
  });

  // ----- Income overview -----
  app.put('/api/income/goal/:year', async (req) => {
    const year = toInt((req.params as Row).year, 'year');
    const amount = cents(((req.body ?? {}) as Row).amountCents, 'amount');
    ctx.db
      .prepare('INSERT INTO income_goals (year, amount_cents) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET amount_cents = excluded.amount_cents')
      .run(year, amount);
    return { ok: true };
  });

  app.get('/api/income/summary', async (req) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    const { from, to } = yearRange(year);
    const db = ctx.db;
    const lines = incomeLines(db, from, to);
    const names = new Map((db.prepare('SELECT id, name FROM clients').all() as Row[]).map((c) => [c.id as number, c.name as string]));
    const byClient = new Map<number | null, number>();
    for (const l of lines) byClient.set(l.client_id, (byClient.get(l.client_id) ?? 0) + l.amount_cents);
    const goal = db.prepare('SELECT amount_cents FROM income_goals WHERE year = ?').get(year) as Row | undefined;
    const invs = (db.prepare("SELECT * FROM invoices WHERE status = 'sent'").all() as Row[]).map((i) => invoiceDetail(db, i));
    const today = todayIso();
    const next30 = addDays(today, 30);
    const upcomingRetainers = schedule(db, today, next30).filter((e) => e.status === 'upcoming' || e.status === 'late');
    const incomeCents = lines.reduce((s, l) => s + l.amount_cents, 0);
    const elapsed = today.startsWith(String(year)) ? (Date.parse(today) - Date.parse(from)) / (365 * 86400000) : today > to ? 1 : 0;
    return {
      year,
      incomeCents,
      goalCents: goal?.amount_cents ?? null,
      projectedCents: elapsed > 0.05 && elapsed < 1 ? Math.round(incomeCents / elapsed) : null,
      monthly: Array.from({ length: 12 }, (_, i) => {
        const m = `${year}-${String(i + 1).padStart(2, '0')}`;
        return { month: m, incomeCents: lines.filter((l) => l.date.startsWith(m)).reduce((s, l) => s + l.amount_cents, 0) };
      }),
      byClient: [...byClient.entries()]
        .map(([clientId, c]) => ({ clientId, name: clientId ? names.get(clientId) ?? '' : 'No client tagged', incomeCents: c }))
        .sort((a, b) => b.incomeCents - a.incomeCents),
      outstandingCents: invs.reduce((s, i) => s + i.balanceCents, 0),
      overdueCents: invs.filter((i) => i.state === 'overdue').reduce((s, i) => s + i.balanceCents, 0),
      overdueCount: invs.filter((i) => i.state === 'overdue').length,
      expectedNext30Cents:
        upcomingRetainers.reduce((s, e) => s + e.amountCents, 0) +
        invs.filter((i) => i.dueDate && i.dueDate <= next30 && i.balanceCents > 0).reduce((s, i) => s + i.balanceCents, 0),
      upcomingRetainers,
    };
  });
}
