import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  applyCsvMapping,
  categorize,
  computeDedupeKeys,
  detectCsv,
  detectFileKind,
  looseKey,
  matchCategoryLabel,
  normalizeMerchant,
  parseCsvRows,
  parseOfx,
  rowsForMapping,
  type CategorizeResult,
  type Classification,
  type CsvMapping,
  type ParsedTransaction,
  type RowError,
} from '@et/core';
import type { AppPaths } from '../config';
import type { DB } from '../db/database';
import type { AccountRow, CategoryRow } from '../db/rows';
import { applyResult, buildContext, pairTransfers } from './categorizeService';

export type AccountType = AccountRow['type'];

export interface ImportInput {
  fileName: string;
  content: string;
  accountId?: number | null;
  accountType?: AccountType;
  mapping?: CsvMapping | null;
  /** The file contains your own past categorisations (e.g. a QuickBooks Self-Employed export). */
  historyMode?: boolean;
  /** Category label in the file → category id (history mode). */
  categoryMap?: Record<string, number | null>;
  skipPossibleDuplicates?: boolean;
  saveMapping?: boolean;
}

interface SavedMapping {
  mapping: CsvMapping;
  headerSignature: string;
}

interface Parsed {
  kind: 'csv' | 'ofx';
  transactions: ParsedTransaction[];
  errors: RowError[];
  warnings: string[];
  mapping?: CsvMapping;
  headers?: string[] | null;
  sampleRows?: string[][];
  headerSignature?: string;
  ofx?: { accountId: string | null; accountType: string };
}

function headerSignature(text: string, mapping: CsvMapping): string {
  const rows = parseCsvRows(text);
  const header = mapping.hasHeader ? rows[mapping.skipRows] ?? [] : [`cols:${(rows[0] ?? []).length}`];
  return header.map((h) => h.trim().toLowerCase()).join('|');
}

function parseFile(db: DB, input: ImportInput): Parsed {
  const kind = detectFileKind(input.fileName, input.content);
  if (kind === 'timeline') {
    throw new Error('This looks like a Google Maps Timeline file. Timeline import arrives with the Mileage feature.');
  }
  if (kind === 'ofx') {
    const st = parseOfx(input.content);
    return {
      kind: 'ofx',
      transactions: st.transactions,
      errors: st.errors,
      warnings: [],
      ofx: { accountId: st.accountId, accountType: st.accountType },
    };
  }
  if (kind !== 'csv') throw new Error('Unsupported file. Use a CSV, OFX, QFX or QBO export from your bank.');

  const account = input.accountId
    ? (db.prepare('SELECT * FROM accounts WHERE id = ?').get(input.accountId) as AccountRow | undefined)
    : undefined;
  const accountType = account?.type ?? input.accountType;
  const warnings: string[] = [];
  let mapping: CsvMapping;
  let headers: string[] | null = null;

  if (input.mapping) {
    mapping = input.mapping;
    const all = parseCsvRows(input.content);
    headers = mapping.hasHeader ? all[mapping.skipRows] ?? null : null;
  } else {
    let detected: ReturnType<typeof detectCsv> | null = null;
    let detectError: Error | null = null;
    try {
      detected = detectCsv(input.content, { accountType });
    } catch (e) {
      detectError = e as Error;
    }
    const saved: SavedMapping | null = account?.csv_mapping ? JSON.parse(account.csv_mapping) : null;
    if (saved && (!detected || headerSignature(input.content, saved.mapping) === saved.headerSignature)) {
      mapping = saved.mapping;
      warnings.push('Using the column layout saved for this account.');
      const all = parseCsvRows(input.content);
      headers = mapping.hasHeader ? all[mapping.skipRows] ?? null : null;
    } else if (detected) {
      mapping = detected.mapping;
      headers = detected.headers;
      warnings.push(...detected.warnings);
    } else {
      throw detectError ?? new Error('Could not read this CSV.');
    }
  }
  const rows = rowsForMapping(input.content, mapping);
  const { transactions, errors } = applyCsvMapping(rows, mapping);
  return {
    kind: 'csv',
    transactions,
    errors,
    warnings,
    mapping,
    headers,
    sampleRows: rows.slice(0, 8),
    headerSignature: headerSignature(input.content, mapping),
  };
}

function classificationFromLabel(label: string | null | undefined): Classification | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  if (l.startsWith('bus')) return 'business';
  if (l.startsWith('per')) return 'personal';
  if (l.includes('transfer')) return 'transfer';
  return null;
}

type DupState = 'exact' | 'possible' | null;

/** Mark rows that are already in this account (exact key) or look like they are (loose match). */
function findDuplicates(db: DB, accountId: number, txns: ParsedTransaction[], keys: string[]): DupState[] {
  const exact = db.prepare('SELECT 1 FROM transactions WHERE account_id = ? AND dedupe_key = ?');
  const loose = db.prepare(
    'SELECT id, description FROM transactions WHERE account_id = ? AND date = ? AND amount_cents = ? AND dedupe_key != ?',
  );
  const claimed = new Set<number>();
  return txns.map((t, i) => {
    if (exact.get(accountId, keys[i])) return 'exact';
    const candidates = loose.all(accountId, t.date, t.amountCents, keys[i]) as { id: number; description: string }[];
    const lk = looseKey(t);
    const hit = candidates.find((c) => !claimed.has(c.id) && looseKey({ ...t, description: c.description }) === lk);
    if (hit) {
      claimed.add(hit.id);
      return 'possible';
    }
    return null;
  });
}

function suggestAccount(db: DB, parsed: Parsed): number | null {
  const acctId = parsed.ofx?.accountId;
  if (!acctId) return null;
  const last4 = acctId.replace(/\D/g, '').slice(-4);
  const rows = db.prepare('SELECT * FROM accounts WHERE archived = 0').all() as AccountRow[];
  const exact = rows.find((a) => a.ofx_account_id === acctId);
  if (exact) return exact.id;
  const byLast4 = rows.filter((a) => last4 && a.last4 === last4);
  return byLast4.length === 1 ? byLast4[0].id : null;
}

function historyResult(
  t: ParsedTransaction,
  categoryMap: Record<string, number | null>,
  categories: CategoryRow[],
): CategorizeResult | null {
  const cls = classificationFromLabel(t.classificationLabel) ??
    (t.categoryLabel && /^personal$/i.test(t.categoryLabel) ? 'personal' : null);
  const catId = t.categoryLabel
    ? t.categoryLabel in categoryMap
      ? categoryMap[t.categoryLabel]
      : matchCategoryLabel(t.categoryLabel, categories.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases ? JSON.parse(c.aliases) : [] })))
    : null;
  const classification: Classification | null = cls ?? (catId ? 'business' : null);
  if (!classification) return null;
  const complete = classification !== 'business' || catId !== null;
  return {
    status: complete ? 'reviewed' : 'suggested',
    classification,
    categoryId: classification === 'business' ? catId ?? null : null,
    source: 'import',
    confidence: 1,
  };
}

export function previewImport(db: DB, input: ImportInput) {
  const parsed = parseFile(db, input);
  const accountId = input.accountId ?? suggestAccount(db, parsed);
  const keys = computeDedupeKeys(parsed.transactions);
  const dups: DupState[] = accountId ? findDuplicates(db, accountId, parsed.transactions, keys) : parsed.transactions.map(() => null);
  const ctx = buildContext(db);
  const categories = db.prepare('SELECT * FROM categories').all() as CategoryRow[];
  const categoryMap = input.categoryMap ?? {};

  const rows = parsed.transactions.map((t, i) => {
    const m = normalizeMerchant(t.description);
    const res =
      (input.historyMode ? historyResult(t, categoryMap, categories) : null) ??
      categorize(
        { description: t.description, merchant: m.merchant, merchantKey: m.merchantKey, amountCents: t.amountCents,
          accountId: accountId ?? 0, state: m.state, city: m.city, date: t.date, isOnline: m.online },
        ctx,
      );
    return {
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      merchant: m.merchant,
      city: m.city,
      state: m.state,
      duplicate: dups[i],
      status: res.status,
      classification: res.classification,
      categoryId: res.categoryId,
      source: res.source,
      categoryLabel: t.categoryLabel ?? null,
      classificationLabel: t.classificationLabel ?? null,
    };
  });

  const dates = parsed.transactions.map((t) => t.date).sort();
  const sha = createHash('sha256').update(input.content).digest('hex');
  const previous = accountId
    ? (db.prepare('SELECT created_at FROM import_batches WHERE account_id = ? AND file_sha256 = ? ORDER BY id DESC').get(accountId, sha) as
        | { created_at: string }
        | undefined)
    : undefined;
  const warnings = [...parsed.warnings];
  if (previous) warnings.push(`You already imported this exact file on ${previous.created_at.slice(0, 10)}. Duplicates will be skipped.`);

  // Distinct category labels (history mode) with our best match.
  const labelCounts = new Map<string, number>();
  for (const t of parsed.transactions) if (t.categoryLabel) labelCounts.set(t.categoryLabel, (labelCounts.get(t.categoryLabel) ?? 0) + 1);
  const catList = categories.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases ? JSON.parse(c.aliases) : [] }));
  const categoryLabels = [...labelCounts.entries()].map(([label, count]) => ({
    label,
    count,
    categoryId: label in categoryMap ? categoryMap[label] : /^personal$/i.test(label) ? null : matchCategoryLabel(label, catList),
  }));

  return {
    kind: parsed.kind,
    mapping: parsed.mapping ?? null,
    headers: parsed.headers ?? null,
    sampleRows: parsed.sampleRows ?? [],
    ofx: parsed.ofx ?? null,
    suggestedAccountId: accountId ?? null,
    warnings,
    errors: parsed.errors,
    rows,
    counts: {
      total: rows.length,
      new: rows.filter((r) => r.duplicate === null).length,
      duplicates: rows.filter((r) => r.duplicate === 'exact').length,
      possibleDuplicates: rows.filter((r) => r.duplicate === 'possible').length,
    },
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    categoryLabels,
  };
}

export function commitImport(db: DB, paths: AppPaths, input: ImportInput) {
  if (!input.accountId) throw new Error('Choose which account this file belongs to.');
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(input.accountId) as AccountRow | undefined;
  if (!account) throw new Error('Account not found.');
  const parsed = parseFile(db, input);
  const keys = computeDedupeKeys(parsed.transactions);
  const dups = findDuplicates(db, account.id, parsed.transactions, keys);
  const skipPossible = input.skipPossibleDuplicates !== false;
  const ctx = buildContext(db);
  const categories = db.prepare('SELECT * FROM categories').all() as CategoryRow[];
  const categoryMap = input.categoryMap ?? {};
  const sha = createHash('sha256').update(input.content).digest('hex');
  const dates = parsed.transactions.map((t) => t.date).sort();

  // Keep a private copy of the original file for your records (audit trail).
  const month = new Date().toISOString().slice(0, 7);
  const dir = join(paths.importsDir, month);
  mkdirSync(dir, { recursive: true });
  const storedName = `${Date.now()}-${basename(input.fileName).replace(/[^\w.\- ]+/g, '_')}`;
  writeFileSync(join(dir, storedName), input.content, 'utf8');

  let newCount = 0;
  let duplicateCount = 0;
  let possibleSkipped = 0;
  const counts = { reviewed: 0, suggested: 0, unreviewed: 0 };

  const batchId = db.transaction(() => {
    const batch = db
      .prepare(
        `INSERT INTO import_batches (account_id, kind, file_name, file_sha256, stored_file, history_mode, row_count, error_count, date_from, date_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        account.id,
        parsed.kind,
        input.fileName,
        sha,
        join(month, storedName),
        input.historyMode ? 1 : 0,
        parsed.transactions.length,
        parsed.errors.length,
        dates[0] ?? null,
        dates[dates.length - 1] ?? null,
      );
    const bId = Number(batch.lastInsertRowid);
    const insert = db.prepare(
      `INSERT INTO transactions (account_id, batch_id, date, amount_cents, description, memo, merchant, merchant_key,
                                 city, state, is_online, external_id, check_number, dedupe_key, notes)
       VALUES (@accountId, @batchId, @date, @amountCents, @description, @memo, @merchant, @merchantKey,
               @city, @state, @isOnline, @externalId, @checkNumber, @dedupeKey, @notes)`,
    );
    parsed.transactions.forEach((t, i) => {
      if (dups[i] === 'exact' || (dups[i] === 'possible' && skipPossible)) {
        if (dups[i] === 'exact') duplicateCount++;
        else possibleSkipped++;
        return;
      }
      const m = normalizeMerchant(t.description);
      const info = insert.run({
        accountId: account.id,
        batchId: bId,
        date: t.date,
        amountCents: t.amountCents,
        description: t.description,
        memo: t.memo ?? null,
        merchant: m.merchant,
        merchantKey: m.merchantKey,
        city: m.city,
        state: m.state,
        isOnline: m.online ? 1 : 0,
        externalId: t.externalId ?? null,
        checkNumber: t.checkNumber ?? null,
        // A "possible duplicate" the user chose to keep needs a unique key.
        dedupeKey: dups[i] === 'possible' ? `${keys[i]}~b${bId}` : keys[i],
        notes: t.notes ?? null,
      });
      const id = Number(info.lastInsertRowid);
      const res =
        (input.historyMode ? historyResult(t, categoryMap, categories) : null) ??
        categorize(
          { description: t.description, merchant: m.merchant, merchantKey: m.merchantKey, amountCents: t.amountCents,
            accountId: account.id, state: m.state, city: m.city, date: t.date, isOnline: m.online },
          ctx,
        );
      applyResult(db, id, t.amountCents, res);
      counts[res.status]++;
      newCount++;
    });
    db.prepare('UPDATE import_batches SET new_count = ?, duplicate_count = ? WHERE id = ?').run(
      newCount,
      duplicateCount + possibleSkipped,
      bId,
    );

    if (parsed.kind === 'csv' && parsed.mapping && input.saveMapping !== false) {
      const saved: SavedMapping = { mapping: parsed.mapping, headerSignature: parsed.headerSignature ?? '' };
      db.prepare('UPDATE accounts SET csv_mapping = ? WHERE id = ?').run(JSON.stringify(saved), account.id);
    }
    if (parsed.kind === 'ofx' && parsed.ofx?.accountId && !account.ofx_account_id) {
      db.prepare('UPDATE accounts SET ofx_account_id = ? WHERE id = ?').run(parsed.ofx.accountId, account.id);
    }
    return bId;
  })();

  const transfersPaired = dates.length ? pairTransfers(db, dates[0], dates[dates.length - 1]) : 0;

  return {
    batchId,
    newCount,
    duplicateCount,
    possibleDuplicatesSkipped: possibleSkipped,
    errorCount: parsed.errors.length,
    errors: parsed.errors,
    autoReviewed: counts.reviewed,
    suggested: counts.suggested,
    needsReview: counts.unreviewed,
    transfersPaired,
  };
}

/** Undo an import: removes every transaction that came from that file. */
export function undoImport(db: DB, batchId: number): { removed: number } {
  return db.transaction(() => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE batch_id = ?').get(batchId) as { n: number }).n;
    // Unlink transfer partners that pointed at rows we're removing.
    db.prepare(
      `UPDATE transactions SET transfer_pair_id = NULL
        WHERE transfer_pair_id IN (SELECT id FROM transactions WHERE batch_id = ?)`,
    ).run(batchId);
    db.prepare('DELETE FROM transactions WHERE batch_id = ?').run(batchId);
    db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId);
    return { removed: n };
  })();
}
