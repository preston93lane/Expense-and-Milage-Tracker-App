import { normalizeMerchant, type Classification } from '@et/core';
import type { DB } from '../db/database';
import { splitsFor, transactionToApi, type SplitRow, type TransactionRow } from '../db/rows';
import { recategorize } from './categorizeService';

export interface TransactionFilters {
  from?: string;
  to?: string;
  accountId?: number;
  status?: 'unreviewed' | 'suggested' | 'reviewed' | 'needs_review';
  classification?: Classification | 'none';
  categoryId?: number;
  q?: string;
  direction?: 'in' | 'out';
  batchId?: number;
  ids?: number[];
  limit?: number;
  offset?: number;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'merchant';
}

function buildWhere(f: TransactionFilters): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    where.push('t.date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('t.date <= ?');
    params.push(f.to);
  }
  if (f.accountId) {
    where.push('t.account_id = ?');
    params.push(f.accountId);
  }
  if (f.batchId) {
    where.push('t.batch_id = ?');
    params.push(f.batchId);
  }
  if (f.status === 'needs_review') where.push("t.status != 'reviewed'");
  else if (f.status) {
    where.push('t.status = ?');
    params.push(f.status);
  }
  if (f.classification === 'none') where.push('t.classification IS NULL');
  else if (f.classification) {
    where.push('(t.classification = ? OR EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id AND s.classification = ?))');
    params.push(f.classification, f.classification);
  }
  if (f.categoryId) {
    where.push('(t.category_id = ? OR EXISTS (SELECT 1 FROM splits s WHERE s.transaction_id = t.id AND s.category_id = ?))');
    params.push(f.categoryId, f.categoryId);
  }
  if (f.direction === 'in') where.push('t.amount_cents > 0');
  if (f.direction === 'out') where.push('t.amount_cents < 0');
  if (f.q) {
    const q = `%${f.q.trim()}%`;
    where.push('(t.description LIKE ? OR t.merchant LIKE ? OR t.notes LIKE ? OR t.city LIKE ? OR CAST(ABS(t.amount_cents) / 100.0 AS TEXT) LIKE ?)');
    params.push(q, q, q, q, `${f.q.trim().replace(/[$,]/g, '')}%`);
  }
  if (f.ids?.length) {
    where.push(`t.id IN (${f.ids.map(() => '?').join(',')})`);
    params.push(...f.ids);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const SORTS: Record<NonNullable<TransactionFilters['sort']>, string> = {
  date_desc: 't.date DESC, t.id DESC',
  date_asc: 't.date ASC, t.id ASC',
  amount_desc: 'ABS(t.amount_cents) DESC',
  amount_asc: 'ABS(t.amount_cents) ASC',
  merchant: 't.merchant COLLATE NOCASE ASC, t.date DESC',
};

export function listTransactions(db: DB, f: TransactionFilters) {
  const { sql, params } = buildWhere(f);
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 5000);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT t.* FROM transactions t ${sql} ORDER BY ${SORTS[f.sort ?? 'date_desc']} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as TransactionRow[];
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0) AS out_cents,
              COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS in_cents
         FROM transactions t ${sql}`,
    )
    .get(...params) as { n: number; out_cents: number; in_cents: number };
  const splits = splitsFor(db, rows.filter((r) => r.is_split).map((r) => r.id));
  return {
    rows: rows.map((r) => transactionToApi(r, splits.get(r.id))),
    total: agg.n,
    totals: { outCents: agg.out_cents, inCents: agg.in_cents },
  };
}

export function listIds(db: DB, f: TransactionFilters): number[] {
  const { sql, params } = buildWhere(f);
  return (db.prepare(`SELECT t.id FROM transactions t ${sql}`).all(...params) as { id: number }[]).map((r) => r.id);
}

export function getTransaction(db: DB, id: number) {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
  if (!row) return null;
  return transactionToApi(row, splitsFor(db, [id]).get(id));
}

// ---------------------------------------------------------------------------
// Undo support: snapshot rows before bulk changes.
// ---------------------------------------------------------------------------
interface Snapshot {
  id: number;
  status: string;
  classification: string | null;
  category_id: number | null;
  is_split: number;
  source: string | null;
  confidence: number | null;
  rule_id: number | null;
  notes: string | null;
  splits: SplitRow[];
}

function snapshot(db: DB, ids: number[]): Snapshot[] {
  if (ids.length === 0) return [];
  const rows: TransactionRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    rows.push(...(db.prepare(`SELECT * FROM transactions WHERE id IN (${part.map(() => '?').join(',')})`).all(...part) as TransactionRow[]));
  }
  const splits = splitsFor(db, rows.filter((r) => r.is_split).map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    classification: r.classification,
    category_id: r.category_id,
    is_split: r.is_split,
    source: r.source,
    confidence: r.confidence,
    rule_id: r.rule_id,
    notes: r.notes,
    splits: splits.get(r.id) ?? [],
  }));
}

function logAction(db: DB, summary: string, snaps: Snapshot[]): number {
  const info = db.prepare('INSERT INTO action_log (summary, undo_json) VALUES (?, ?)').run(summary, JSON.stringify(snaps));
  return Number(info.lastInsertRowid);
}

export function undoAction(db: DB, actionId: number): { restored: number } {
  const row = db.prepare('SELECT * FROM action_log WHERE id = ?').get(actionId) as
    | { id: number; undo_json: string; undone_at: string | null }
    | undefined;
  if (!row) throw new Error('Nothing to undo.');
  if (row.undone_at) throw new Error('That change was already undone.');
  const snaps = JSON.parse(row.undo_json) as Snapshot[];
  const upd = db.prepare(
    `UPDATE transactions SET status=@status, classification=@classification, category_id=@category_id, is_split=@is_split,
            source=@source, confidence=@confidence, rule_id=@rule_id, notes=@notes, updated_at=datetime('now')
      WHERE id=@id`,
  );
  const delSplits = db.prepare('DELETE FROM splits WHERE transaction_id = ?');
  const insSplit = db.prepare(
    'INSERT INTO splits (transaction_id, amount_cents, classification, category_id, note) VALUES (?, ?, ?, ?, ?)',
  );
  let restored = 0;
  db.transaction(() => {
    for (const s of snaps) {
      const res = upd.run({ ...s });
      if (res.changes === 0) continue; // transaction was deleted since
      delSplits.run(s.id);
      for (const sp of s.splits) insSplit.run(s.id, sp.amount_cents, sp.classification, sp.category_id, sp.note);
      restored++;
    }
    db.prepare("UPDATE action_log SET undone_at = datetime('now') WHERE id = ?").run(actionId);
  })();
  return { restored };
}

export function listActions(db: DB, limit = 20) {
  return (
    db.prepare('SELECT id, created_at, summary, undone_at, json_array_length(undo_json) AS n FROM action_log ORDER BY id DESC LIMIT ?').all(limit) as {
      id: number;
      created_at: string;
      summary: string;
      undone_at: string | null;
      n: number;
    }[]
  ).map((a) => ({ id: a.id, createdAt: a.created_at, summary: a.summary, undoneAt: a.undone_at, count: a.n }));
}

// ---------------------------------------------------------------------------
// Bulk changes
// ---------------------------------------------------------------------------
export interface BulkChange {
  ids: number[];
  /** Set business / personal / transfer. */
  classification?: Classification;
  /** Set a category (implies business when no classification is given). */
  categoryId?: number | null;
  /** Accept the current suggestion as-is. */
  approve?: boolean;
  /** Put back into Needs Review. */
  reset?: boolean;
  notes?: string | null;
}

export function bulkUpdate(db: DB, change: BulkChange): { updated: number; actionId: number | null; relearned: number } {
  const ids = [...new Set(change.ids)].filter((n) => Number.isInteger(n));
  if (ids.length === 0) return { updated: 0, actionId: null, relearned: 0 };
  const snaps = snapshot(db, ids);
  let updated = 0;
  const summaryParts: string[] = [];

  db.transaction(() => {
    for (const s of snaps) {
      let status = s.status;
      let classification = s.classification as Classification | null;
      let categoryId = s.category_id;
      let source = s.source;
      let confidence = s.confidence;
      let isSplit = s.is_split;
      let notes = s.notes;

      if (change.reset) {
        status = 'unreviewed';
        classification = null;
        source = null;
        confidence = null;
        isSplit = 0;
      }
      if (change.approve) {
        if (classification) {
          status = 'reviewed';
        }
      }
      if (change.classification) {
        classification = change.classification;
        if (classification !== 'business') categoryId = null;
        status = 'reviewed';
        source = 'manual';
        confidence = null;
        isSplit = 0;
      }
      if (change.categoryId !== undefined) {
        categoryId = change.categoryId;
        if (!change.classification) {
          classification = categoryId === null ? classification : 'business';
          if (classification === 'business' && categoryId === null) {
            // clearing the category leaves it business-but-uncategorised
          }
        }
        status = classification ? 'reviewed' : status;
        source = 'manual';
        confidence = null;
        isSplit = 0;
      }
      if (change.notes !== undefined) notes = change.notes;

      if (isSplit === 0 && s.is_split === 1) db.prepare('DELETE FROM splits WHERE transaction_id = ?').run(s.id);
      const res = db
        .prepare(
          `UPDATE transactions SET status=?, classification=?, category_id=?, source=?, confidence=?, is_split=?, notes=?,
                  updated_at=datetime('now') WHERE id=?`,
        )
        .run(status, classification, categoryId, source, confidence, isSplit, notes, s.id);
      updated += res.changes;
    }
  })();

  if (change.reset) summaryParts.push('moved back to Needs Review');
  if (change.approve) summaryParts.push('approved suggestions');
  if (change.classification) summaryParts.push(`marked ${change.classification}`);
  if (change.categoryId !== undefined) {
    const name = change.categoryId
      ? (db.prepare('SELECT name FROM categories WHERE id = ?').get(change.categoryId) as { name: string } | undefined)?.name
      : 'no category';
    summaryParts.push(`category → ${name}`);
  }
  if (change.notes !== undefined) summaryParts.push('edited note');
  const actionId = logAction(db, `${updated} transaction${updated === 1 ? '' : 's'}: ${summaryParts.join(', ')}`, snaps);

  // Learn as you go: refresh suggestions for other undecided transactions from the same merchants.
  let relearned = 0;
  if (!change.reset && (change.classification || change.categoryId !== undefined || change.approve)) {
    const keys = (
      db.prepare(`SELECT DISTINCT merchant_key FROM transactions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as {
        merchant_key: string;
      }[]
    ).map((r) => r.merchant_key);
    relearned = recategorize(db, { merchantKeys: keys });
  }
  return { updated, actionId, relearned };
}

export interface SplitInput {
  amountCents: number;
  classification: Classification;
  categoryId: number | null;
  note?: string | null;
}

/** Split one transaction into several lines (e.g. phone bill 60% business / 40% personal). */
export function setSplits(db: DB, id: number, splits: SplitInput[]): void {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
  if (!t) throw new Error('Transaction not found.');
  if (splits.length < 2) throw new Error('A split needs at least two lines.');
  const sum = splits.reduce((s, x) => s + x.amountCents, 0);
  if (sum !== t.amount_cents) {
    throw new Error(`Split lines add up to ${sum / 100} but the transaction is ${t.amount_cents / 100}.`);
  }
  const snaps = snapshot(db, [id]);
  db.transaction(() => {
    db.prepare('DELETE FROM splits WHERE transaction_id = ?').run(id);
    const ins = db.prepare(
      'INSERT INTO splits (transaction_id, amount_cents, classification, category_id, note) VALUES (?, ?, ?, ?, ?)',
    );
    for (const s of splits) {
      ins.run(id, s.amountCents, s.classification, s.classification === 'business' ? s.categoryId : null, s.note ?? null);
    }
    const biz = splits.find((s) => s.classification === 'business');
    db.prepare(
      `UPDATE transactions SET is_split = 1, status = 'reviewed', classification = ?, category_id = ?, source = 'manual',
              confidence = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(biz ? 'business' : splits[0].classification, biz?.categoryId ?? null, id);
    logAction(db, `Split "${t.merchant}" into ${splits.length} lines`, snaps);
  })();
}

export function removeSplits(db: DB, id: number): void {
  const snaps = snapshot(db, [id]);
  db.transaction(() => {
    db.prepare('DELETE FROM splits WHERE transaction_id = ?').run(id);
    db.prepare("UPDATE transactions SET is_split = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    logAction(db, 'Removed split', snaps);
  })();
}

export interface ManualTransactionInput {
  accountId: number;
  date: string;
  amountCents: number;
  description: string;
  classification?: Classification | null;
  categoryId?: number | null;
  notes?: string | null;
}

/** Cash purchases and anything else that never shows up in a bank file. */
export function createManualTransaction(db: DB, input: ManualTransactionInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Date must be YYYY-MM-DD.');
  if (!input.description?.trim()) throw new Error('Description is required.');
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new Error('Amount is required.');
  const m = normalizeMerchant(input.description);
  const classification = input.classification ?? (input.categoryId ? 'business' : null);
  const info = db
    .prepare(
      `INSERT INTO transactions (account_id, date, amount_cents, description, merchant, merchant_key, city, state,
                                 dedupe_key, status, classification, category_id, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    )
    .run(
      input.accountId,
      input.date,
      input.amountCents,
      input.description.trim(),
      m.merchant,
      m.merchantKey,
      m.city,
      m.state,
      `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      classification ? 'reviewed' : 'unreviewed',
      classification,
      classification === 'business' ? input.categoryId ?? null : null,
      input.notes ?? null,
    );
  return getTransaction(db, Number(info.lastInsertRowid));
}

export function deleteManualTransaction(db: DB, id: number): void {
  const t = db.prepare('SELECT batch_id FROM transactions WHERE id = ?').get(id) as { batch_id: number | null } | undefined;
  if (!t) throw new Error('Transaction not found.');
  if (t.batch_id !== null) throw new Error('Imported transactions can only be removed by undoing their import.');
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
}
