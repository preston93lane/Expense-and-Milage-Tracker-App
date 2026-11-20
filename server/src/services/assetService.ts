import {
  assetReminders,
  assetWarnings,
  depreciationSchedule,
  type AssetType,
  type DepreciationMethod,
  type Reminder,
} from '@et/core';
import { getSetting, type DB } from '../db/database';

type Row = Record<string, any>;

export const ASSET_TYPES: AssetType[] = ['camera', 'lens', 'audio', 'lighting', 'drone', 'computer', 'phone_tablet', 'software', 'furniture', 'vehicle', 'other'];
export const METHODS: DepreciationMethod[] = ['de_minimis', 'section179', 'bonus', 'macrs5', 'macrs7', 'straight_line'];

function facts(r: Row) {
  return {
    costCents: r.cost_cents as number,
    businessUsePct: r.business_use_pct as number,
    placedInService: r.placed_in_service as string,
    method: r.method as DepreciationMethod,
    lifeYears: r.life_years as number | null,
    disposedDate: r.disposed_date as string | null,
  };
}

/**
 * A vehicle on the standard mileage rate can't also be depreciated — the
 * per-mile rate already includes depreciation. Those are left out of line 13.
 */
function countsForTaxes(r: Row, mileageMethod: string): boolean {
  return !(r.type === 'vehicle' && mileageMethod === 'standard');
}

export function assetToApi(r: Row, year: number, today: string, mileageMethod: string) {
  const f = facts(r);
  const schedule = depreciationSchedule(f);
  const counts = countsForTaxes(r, mileageMethod);
  const thisYear = counts ? (schedule.find((s) => s.year === year)?.deductionCents ?? 0) : 0;
  const throughYear = counts ? schedule.filter((s) => s.year <= year).reduce((t, s) => t + s.deductionCents, 0) : 0;
  const basis = Math.round((f.costCents * f.businessUsePct) / 100);
  const warnings = assetWarnings({ ...f, type: r.type });
  if (!counts) warnings.unshift('Not depreciated: you use the standard mileage rate, which already covers the car’s wear and tear.');
  return {
    id: r.id as number,
    name: r.name as string,
    type: r.type as AssetType,
    purchaseDate: r.purchase_date as string,
    placedInService: r.placed_in_service as string,
    costCents: f.costCents,
    businessUsePct: f.businessUsePct,
    method: f.method,
    lifeYears: f.lifeYears,
    vendor: r.vendor as string | null,
    serialNumber: r.serial_number as string | null,
    warrantyUntil: r.warranty_until as string | null,
    replaceAfterYears: r.replace_after_years as number | null,
    transactionId: r.transaction_id as number | null,
    transaction: r.t_date ? { date: r.t_date as string, description: r.t_description as string, amountCents: r.t_amount as number } : null,
    disposedDate: f.disposedDate,
    disposedAmountCents: r.disposed_amount_cents as number | null,
    notes: r.notes as string | null,
    basisCents: basis,
    schedule: counts ? schedule : [],
    countsForTaxes: counts,
    deductionThisYearCents: thisYear,
    deductedThroughYearCents: throughYear,
    remainingAfterYearCents: counts ? basis - throughYear : 0,
    warnings,
    reminders: assetReminders(
      { name: r.name, purchaseDate: r.purchase_date, warrantyUntil: r.warranty_until, replaceAfterYears: r.replace_after_years, disposedDate: r.disposed_date },
      today,
    ),
  };
}

export type ApiAsset = ReturnType<typeof assetToApi>;

export function loadAssets(db: DB, year: number, today: string): ApiAsset[] {
  const mileageMethod = getSetting(db, 'mileage_method', 'standard') as string;
  const rows = db
    .prepare(
      `SELECT a.*, t.date AS t_date, COALESCE(t.merchant, t.description) AS t_description, t.amount_cents AS t_amount
         FROM assets a LEFT JOIN transactions t ON t.id = a.transaction_id
        ORDER BY a.disposed_date IS NOT NULL, a.purchase_date DESC, a.id DESC`,
    )
    .all() as Row[];
  return rows.map((r) => assetToApi(r, year, today, mileageMethod));
}

/** Line 13 (Form 4562) total for a year, from the equipment register. */
export function assetDepreciationForYear(db: DB, year: number): { totalCents: number; byMethod: Record<string, number> } {
  const mileageMethod = getSetting(db, 'mileage_method', 'standard') as string;
  const rows = db.prepare('SELECT * FROM assets WHERE placed_in_service <= ?').all(`${year}-12-31`) as Row[];
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    if (!countsForTaxes(r, mileageMethod)) continue;
    const d = depreciationSchedule(facts(r)).find((s) => s.year === year)?.deductionCents ?? 0;
    if (!d) continue;
    byMethod[r.method] = (byMethod[r.method] ?? 0) + d;
    total += d;
  }
  return { totalCents: total, byMethod };
}

/**
 * When a bank transaction is in the register, its cost is written off through
 * depreciation instead — so take it out of the expense categories (Equipment
 * first) to avoid counting it twice. Anything left over (cables, tax, shipping
 * not in the register) stays as a normal expense.
 */
export function linkedAssetAdjustments(db: DB, from: string, to: string): Map<number, number> {
  const adj = new Map<number, number>();
  const linked = db
    .prepare('SELECT transaction_id, SUM(cost_cents) AS cost FROM assets WHERE transaction_id IS NOT NULL GROUP BY transaction_id')
    .all() as { transaction_id: number; cost: number }[];
  if (!linked.length) return adj;
  const lines = db.prepare(
    `SELECT l.category_id, l.amount_cents FROM ledger_lines l JOIN categories c ON c.id = l.category_id
      WHERE l.transaction_id = ? AND l.status = 'reviewed' AND l.classification = 'business' AND l.date BETWEEN ? AND ?
        AND c.kind = 'expense' AND l.amount_cents < 0
      ORDER BY (c.tax_line = 'C-13') DESC, l.amount_cents ASC`,
  );
  for (const { transaction_id, cost } of linked) {
    let remaining = cost;
    for (const l of lines.all(transaction_id, from, to) as { category_id: number; amount_cents: number }[]) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, -l.amount_cents);
      adj.set(l.category_id, (adj.get(l.category_id) ?? 0) + take);
      remaining -= take;
    }
  }
  return adj;
}

/** Guess what kind of gear a purchase is from its description (just a starting point). */
export function guessAssetType(text: string): AssetType {
  const t = text.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has('lens', 'sigma', 'tamron')) return 'lens';
  if (has('dji', 'drone', 'skydio')) return 'drone';
  if (has('iphone', 'ipad', 'galaxy', 'pixel', 'tablet')) return 'phone_tablet';
  if (has('macbook', 'imac', 'mac mini', 'laptop', 'dell', 'lenovo', 'monitor', 'computer', 'surface', 'apple store', 'apple.com', 'microcenter', 'micro center')) return 'computer';
  if (has('rode', 'shure', 'sennheiser', 'zoom h', 'microphone', 'mic ', 'audio', 'tascam')) return 'audio';
  if (has('godox', 'aputure', 'profoto', 'nanlite', 'light')) return 'lighting';
  if (has('camera', 'canon', 'nikon', 'sony', 'fujifilm', 'blackmagic', 'gopro', 'b&h', 'b & h', 'bhphoto', 'adorama')) return 'camera';
  if (has('desk', 'chair', 'ikea', 'herman miller', 'steelcase', 'furniture', 'wayfair')) return 'furniture';
  if (has('adobe', 'software', 'license')) return 'software';
  return 'other';
}

/** Equipment-category purchases that aren't in the register yet. */
export function unregisteredPurchases(db: DB, year: number) {
  return (
    db
      .prepare(
        `SELECT t.id, t.date, COALESCE(t.merchant, t.description) AS description, -l.amount_cents AS cost
           FROM ledger_lines l JOIN transactions t ON t.id = l.transaction_id JOIN categories c ON c.id = l.category_id
          WHERE c.tax_line = 'C-13' AND l.classification = 'business' AND l.amount_cents < 0 AND l.date BETWEEN ? AND ?
            AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.transaction_id = t.id)
          ORDER BY l.amount_cents ASC LIMIT 100`,
      )
      .all(`${year}-01-01`, `${year}-12-31`) as Row[]
  ).map((r) => ({ transactionId: r.id as number, date: r.date as string, description: r.description as string, costCents: r.cost as number, overDeMinimis: r.cost > 250_000 }));
}

export function allReminders(assets: ApiAsset[]): (Reminder & { assetId: number })[] {
  return assets.flatMap((a) => a.reminders.map((r) => ({ ...r, assetId: a.id }))).sort((x, y) => x.date.localeCompare(y.date));
}
