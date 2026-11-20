import { REPLACE_AFTER_YEARS, suggestMethod, todayIso, type AssetType, type DepreciationMethod } from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { getSetting } from '../db/database';
import {
  ASSET_TYPES,
  METHODS,
  allReminders,
  assetDepreciationForYear,
  guessAssetType,
  loadAssets,
  unregisteredPurchases,
} from '../services/assetService';
import { scheduleCFor } from '../services/taxService';

type Row = Record<string, any>;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isoOrNull(v: unknown, label: string): string | null {
  const s = optStr(v);
  if (!s) return null;
  if (!ISO.test(s)) badRequest(`${label} must be a date (YYYY-MM-DD)`);
  return s;
}

function readAsset(b: Row, existing: Row | undefined, txn: Row | undefined) {
  const pick = <T>(key: string, col: string, fallback: T): T => (key in b ? b[key] : existing ? existing[col] : fallback);
  const name = optStr(pick('name', 'name', txn?.merchant ?? '')) ?? '';
  if (!name) badRequest('Give the item a name');
  const type = (optStr(pick('type', 'type', txn ? guessAssetType(`${txn.merchant} ${txn.description}`) : 'other')) ?? 'other') as AssetType;
  if (!ASSET_TYPES.includes(type)) badRequest('Unknown equipment type');
  const purchaseDate = isoOrNull(pick('purchaseDate', 'purchase_date', txn?.date ?? null), 'Purchase date');
  if (!purchaseDate) badRequest('Enter the purchase date');
  const placedInService = isoOrNull(pick('placedInService', 'placed_in_service', null), 'In-service date') ?? purchaseDate;
  if (placedInService < purchaseDate) badRequest('The in-service date can’t be before the purchase date');
  const costRaw = pick('costCents', 'cost_cents', txn ? Math.abs(txn.amount_cents) : null);
  const cost = Math.round(Number(costRaw));
  if (!Number.isFinite(cost) || cost <= 0) badRequest('Enter what it cost');
  const pct = Number(pick('businessUsePct', 'business_use_pct', 100));
  if (!(pct >= 0 && pct <= 100)) badRequest('Business use must be 0–100%');
  const method = (optStr(pick('method', 'method', null)) ?? suggestMethod(cost)) as DepreciationMethod;
  if (!METHODS.includes(method)) badRequest('Unknown write-off method');
  let life = optInt(pick('lifeYears', 'life_years', null)) ?? null;
  if (method === 'straight_line') {
    life = life ?? 5;
    if (life < 1 || life > 40) badRequest('Useful life must be 1–40 years');
  }
  const replaceRaw = pick<unknown>('replaceAfterYears', 'replace_after_years', existing ? null : REPLACE_AFTER_YEARS[type]);
  const replace = replaceRaw === null || replaceRaw === '' ? null : Number(replaceRaw);
  if (replace !== null && !(replace > 0 && replace <= 50)) badRequest('Replace-after must be 1–50 years');
  const disposedDate = isoOrNull(pick('disposedDate', 'disposed_date', null), 'Sold/disposed date');
  if (disposedDate && disposedDate < placedInService) badRequest('The sold date can’t be before it was put in service');
  const disposedRaw = pick<unknown>('disposedAmountCents', 'disposed_amount_cents', null);
  const disposedAmount = disposedRaw === null || disposedRaw === '' ? null : Math.round(Number(disposedRaw));
  if (disposedAmount !== null && !(disposedAmount >= 0)) badRequest('Sale amount must be a number');
  return {
    name,
    type,
    purchaseDate,
    placedInService,
    cost,
    pct,
    method,
    life,
    vendor: optStr(pick('vendor', 'vendor', txn?.merchant ?? null)) ?? null,
    serial: optStr(pick('serialNumber', 'serial_number', null)) ?? null,
    warranty: isoOrNull(pick('warrantyUntil', 'warranty_until', null), 'Warranty date'),
    replace,
    disposedDate,
    disposedAmount: disposedDate ? disposedAmount : null,
    notes: optStr(pick('notes', 'notes', null)) ?? null,
  };
}

export function assetRoutes(app: FastifyInstance, ctx: AppContext) {
  const db = ctx.db;
  const txnById = (id: number) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Row | undefined;

  app.get('/api/assets', async (req) => {
    const year = optInt((req.query as Row).year) ?? Number(todayIso().slice(0, 4));
    const today = todayIso();
    const assets = loadAssets(db, year, today);
    const active = assets.filter((a) => !a.disposedDate);
    const dep = assetDepreciationForYear(db, year);
    return {
      year,
      mileageMethod: getSetting(db, 'mileage_method', 'standard'),
      assets,
      summary: {
        deductionCents: dep.totalCents,
        byMethod: dep.byMethod,
        activeCount: active.length,
        activeCostCents: active.reduce((s, a) => s + a.costCents, 0),
        section179Cents: dep.byMethod.section179 ?? 0,
      },
      // Section 179 can't create a loss; 100% bonus depreciation can.
      section179Warning:
        (dep.byMethod.section179 ?? 0) > 0 && scheduleCFor(db, year).line31NetProfitCents < 0
          ? `Your ${year} business shows a loss after these write-offs. Section 179 can’t be more than your business income — switch those items to 100% bonus depreciation (or carry the rest forward).`
          : null,
      reminders: allReminders(assets),
      unregistered: unregisteredPurchases(db, year),
    };
  });

  /** Pre-filled form values for "Add to equipment register" from a transaction. */
  app.get('/api/assets/suggest', async (req) => {
    const id = toInt((req.query as Row).transactionId, 'transactionId');
    const t = txnById(id);
    if (!t) notFound('Transaction not found');
    const already = db.prepare('SELECT COALESCE(SUM(cost_cents), 0) AS s FROM assets WHERE transaction_id = ?').get(id) as { s: number };
    const cost = Math.max(0, Math.abs(t.amount_cents) - already.s);
    const type = guessAssetType(`${t.merchant} ${t.description}`);
    return {
      transactionId: id,
      name: t.merchant,
      type,
      purchaseDate: t.date,
      placedInService: t.date,
      costCents: cost,
      businessUsePct: 100,
      method: suggestMethod(cost),
      vendor: t.merchant,
      replaceAfterYears: REPLACE_AFTER_YEARS[type],
      alreadyRegisteredCents: already.s,
    };
  });

  app.get('/api/assets/by-transaction/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    return { assets: db.prepare('SELECT id, name, cost_cents AS costCents FROM assets WHERE transaction_id = ? ORDER BY id').all(id) };
  });

  app.post('/api/assets', async (req) => {
    const b = (req.body ?? {}) as Row;
    const txId = optInt(b.transactionId) ?? null;
    const txn = txId ? txnById(txId) : undefined;
    if (txId && !txn) badRequest('Transaction not found');
    const a = readAsset(b, undefined, txn);
    const info = db
      .prepare(
        `INSERT INTO assets (name, type, purchase_date, placed_in_service, cost_cents, business_use_pct, method, life_years, vendor, serial_number,
                             warranty_until, replace_after_years, transaction_id, disposed_date, disposed_amount_cents, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.name, a.type, a.purchaseDate, a.placedInService, a.cost, a.pct, a.method, a.life, a.vendor, a.serial, a.warranty, a.replace, txId, a.disposedDate, a.disposedAmount, a.notes);
    return { id: Number(info.lastInsertRowid) };
  });

  app.patch('/api/assets/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const existing = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;
    if (!existing) notFound('Item not found');
    const b = (req.body ?? {}) as Row;
    let txId: number | null = existing.transaction_id;
    if ('transactionId' in b) {
      txId = optInt(b.transactionId) ?? null;
      if (txId && !txnById(txId)) badRequest('Transaction not found');
    }
    const a = readAsset(b, existing, undefined);
    db.prepare(
      `UPDATE assets SET name=?, type=?, purchase_date=?, placed_in_service=?, cost_cents=?, business_use_pct=?, method=?, life_years=?, vendor=?,
              serial_number=?, warranty_until=?, replace_after_years=?, transaction_id=?, disposed_date=?, disposed_amount_cents=?, notes=? WHERE id=?`,
    ).run(a.name, a.type, a.purchaseDate, a.placedInService, a.cost, a.pct, a.method, a.life, a.vendor, a.serial, a.warranty, a.replace, txId, a.disposedDate, a.disposedAmount, a.notes, id);
    return { ok: true };
  });

  app.delete('/api/assets/:id', async (req) => {
    db.prepare('DELETE FROM assets WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });
}
