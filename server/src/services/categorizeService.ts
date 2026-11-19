import {
  categorize,
  findTransferPairs,
  splitByPercents,
  type CategorizeContext,
  type CategorizeResult,
  type Classification,
  type HistoryEntry,
  type Rule,
} from '@et/core';
import type { DB } from '../db/database';
import { inferHomeState } from '@et/core';
import { ruleFromRow, tripToWindow, type RuleRow, type TransactionRow, type TripRow } from '../db/rows';

export function loadRules(db: DB): Rule[] {
  return (db.prepare('SELECT * FROM rules WHERE enabled = 1').all() as RuleRow[]).map(ruleFromRow);
}

/** How each merchant has been treated in reviewed (non-split) transactions. */
export function loadHistory(db: DB): Map<string, HistoryEntry[]> {
  const rows = db
    .prepare(
      `SELECT merchant_key, classification, category_id, COUNT(*) AS n
         FROM transactions
        WHERE status = 'reviewed' AND is_split = 0 AND classification IS NOT NULL
        GROUP BY merchant_key, classification, category_id`,
    )
    .all() as { merchant_key: string; classification: Classification; category_id: number | null; n: number }[];
  const map = new Map<string, HistoryEntry[]>();
  for (const r of rows) {
    const list = map.get(r.merchant_key) ?? [];
    list.push({ classification: r.classification, categoryId: r.category_id, count: r.n });
    map.set(r.merchant_key, list);
  }
  return map;
}

export function loadCategoryIdByKey(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT id, key FROM categories WHERE key IS NOT NULL').all() as { id: number; key: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

export function loadTrips(db: DB) {
  return (db.prepare('SELECT * FROM business_trips ORDER BY start_date').all() as TripRow[]).map(tripToWindow);
}

/** Most common state among in-person card purchases ("where you live"). */
export function loadHomeState(db: DB): string | null {
  const rows = db
    .prepare('SELECT state, is_online FROM transactions WHERE state IS NOT NULL AND is_online = 0 ORDER BY id DESC LIMIT 5000')
    .all() as { state: string; is_online: number }[];
  return inferHomeState(rows.map((r) => ({ state: r.state, isOnline: !!r.is_online })));
}

/** transaction id → rule ids that should be ignored for it. */
export function loadExceptions(db: DB): Map<number, Set<number>> {
  const rows = db.prepare('SELECT rule_id, transaction_id FROM rule_exceptions').all() as { rule_id: number; transaction_id: number }[];
  const map = new Map<number, Set<number>>();
  for (const r of rows) {
    const set = map.get(r.transaction_id) ?? new Set<number>();
    set.add(r.rule_id);
    map.set(r.transaction_id, set);
  }
  return map;
}

export function buildContext(db: DB): CategorizeContext {
  return {
    exceptions: loadExceptions(db),
    rules: loadRules(db),
    history: loadHistory(db),
    categoryIdByKey: loadCategoryIdByKey(db),
    trips: loadTrips(db),
    homeState: loadHomeState(db),
  };
}

export function categorizeRow(t: TransactionRow, fullCtx: CategorizeContext): CategorizeResult {
  const skipped = fullCtx.exceptions?.get(t.id);
  const ctx = skipped ? { ...fullCtx, rules: fullCtx.rules.filter((r) => !skipped.has(r.id)) } : fullCtx;
  return categorize(
    {
      description: t.description,
      merchant: t.merchant,
      merchantKey: t.merchant_key,
      amountCents: t.amount_cents,
      accountId: t.account_id,
      state: t.state,
      city: t.city,
      date: t.date,
      isOnline: !!t.is_online,
    },
    ctx,
  );
}

/** Write a categorisation result onto a transaction (and its split lines, for rule splits). */
export function applyResult(db: DB, txId: number, amountCents: number, r: CategorizeResult): void {
  db.prepare('DELETE FROM splits WHERE transaction_id = ?').run(txId);
  const isSplit = r.businessPct !== undefined && r.classification === 'business';
  db.prepare(
    `UPDATE transactions
        SET status = @status, classification = @classification, category_id = @categoryId,
            source = @source, confidence = @confidence, rule_id = @ruleId, is_split = @isSplit, trip_id = @tripId,
            notes = COALESCE(notes, @note), updated_at = datetime('now')
      WHERE id = @id`,
  ).run({
    id: txId,
    status: r.status,
    classification: r.classification,
    categoryId: r.categoryId,
    source: r.source,
    confidence: r.confidence,
    ruleId: r.ruleId ?? null,
    isSplit: isSplit ? 1 : 0,
    note: r.note ?? null,
    tripId: r.tripId ?? null,
  });
  if (isSplit) {
    const [biz, pers] = splitByPercents(amountCents, [r.businessPct!, 100 - r.businessPct!]);
    const ins = db.prepare(
      'INSERT INTO splits (transaction_id, amount_cents, classification, category_id, note) VALUES (?, ?, ?, ?, ?)',
    );
    ins.run(txId, biz, 'business', r.categoryId, `${r.businessPct}% business`);
    ins.run(txId, pers, 'personal', null, `${100 - r.businessPct!}% personal`);
  }
  if (r.ruleId) {
    db.prepare("UPDATE rules SET match_count = match_count + 1, last_matched_at = datetime('now') WHERE id = ?").run(r.ruleId);
  }
}

/**
 * Re-run auto-categorisation on transactions you haven't decided on yet
 * (unreviewed or suggested). Reviewed transactions are never touched.
 */
export function recategorize(db: DB, opts: { merchantKeys?: string[]; ids?: number[] } = {}): number {
  const ctx = buildContext(db);
  const where = ["status != 'reviewed'"];
  const params: unknown[] = [];
  if (opts.merchantKeys?.length) {
    where.push(`merchant_key IN (${opts.merchantKeys.map(() => '?').join(',')})`);
    params.push(...opts.merchantKeys);
  }
  if (opts.ids?.length) {
    where.push(`id IN (${opts.ids.map(() => '?').join(',')})`);
    params.push(...opts.ids);
  }
  const rows = db.prepare(`SELECT * FROM transactions WHERE ${where.join(' AND ')}`).all(...params) as TransactionRow[];
  let changed = 0;
  db.transaction(() => {
    for (const t of rows) {
      if (t.transfer_pair_id && t.classification === 'transfer') continue; // keep paired transfers
      const r = categorizeRow(t, ctx);
      if (
        r.status !== t.status ||
        r.classification !== t.classification ||
        r.categoryId !== t.category_id ||
        r.source !== t.source ||
        (r.tripId ?? null) !== t.trip_id ||
        (r.ruleId ?? null) !== t.rule_id
      ) {
        applyResult(db, t.id, t.amount_cents, r);
        changed++;
      }
    }
  })();
  return changed;
}

/** Find card payments / transfers between your accounts and mark both sides. */
export function pairTransfers(db: DB, from: string, to: string): number {
  const rows = db
    .prepare(
      `SELECT id, account_id, date, amount_cents, description FROM transactions
        WHERE date BETWEEN date(?, '-7 day') AND date(?, '+7 day')
          AND transfer_pair_id IS NULL AND is_split = 0
          AND (status != 'reviewed' OR classification = 'transfer')`,
    )
    .all(from, to) as { id: number; account_id: number; date: string; amount_cents: number; description: string }[];
  const pairs = findTransferPairs(
    rows.map((r) => ({ id: r.id, accountId: r.account_id, date: r.date, amountCents: r.amount_cents, description: r.description })),
  );
  const upd = db.prepare(
    `UPDATE transactions
        SET transfer_pair_id = @pair,
            classification = CASE WHEN status = 'reviewed' THEN classification ELSE 'transfer' END,
            category_id = CASE WHEN status = 'reviewed' THEN category_id ELSE NULL END,
            status = CASE WHEN status = 'reviewed' THEN status ELSE 'suggested' END,
            source = CASE WHEN status = 'reviewed' THEN source ELSE 'transfer' END,
            confidence = CASE WHEN status = 'reviewed' THEN confidence ELSE 0.95 END,
            updated_at = datetime('now')
      WHERE id = @id`,
  );
  db.transaction(() => {
    for (const [a, b] of pairs) {
      upd.run({ id: a, pair: b });
      upd.run({ id: b, pair: a });
    }
  })();
  return pairs.length;
}
