import Papa from 'papaparse';
import { detectDateFormat, looksLikeDate, parseDateWithFormat } from '../dates';
import { parseAmountToCents } from '../money';
import type { CsvDetection, CsvMapping, ParsedTransaction, RowError } from './types';

/** Parse CSV text into rows of strings (handles quotes, BOM, CRLF). */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' });
  return (result.data as string[][]).map((r) => r.map((c) => (c ?? '').toString().trim()));
}

const H = {
  txDate: /^(trans(action)?\.?\s*date|date of transaction|purchase date)$/i,
  postDate: /^(post(ed|ing)?\s*date|settle(ment|d)?\s*date|date posted)$/i,
  date: /^(date|day)$/i,
  description: /^description$/i,
  descriptionAlt: /^(transaction description|original description|desc|payee|merchant( name)?|name|details|transaction)$/i,
  extraDescription: /^(extended details|additional info|appears on your statement as)$/i,
  memo: /^(memo|extended description|reference description)$/i,
  amount: /^(amount|transaction amount|amount \(usd\)|amt|net amount|value)$/i,
  debit: /^(debit|debits|withdrawals?|withdrawal amount|charges?|money out|outflow|debit amount|amount debit)$/i,
  credit: /^(credit|credits|deposits?|deposit amount|money in|inflow|credit amount|amount credit|payments?)$/i,
  type: /^(type|transaction type|debit\/credit|cr\/dr|dr\/cr|credit\/debit|indicator)$/i,
  check: /^(check|check ?(no|num|number|#)\.?|check or slip ?#?|cheque|chk ?(no|#)?)$/i,
  id: /^(reference( number| no\.?| #)?|ref( #| no)?|transaction id|fitid|confirmation)$/i,
  category: /^(category|categories|tax category|expense category)$/i,
  classification: /^(business\/personal|business or personal|classification|bus\/pers|transaction type \(business\/personal\))$/i,
  notes: /^(notes?|receipt notes|memo\/notes)$/i,
  balance: /balance/i,
};

function findHeader(rows: string[][]): number {
  const limit = Math.min(rows.length - 1, 20);
  for (let i = 0; i <= limit; i++) {
    const row = rows[i];
    const hasDate = row.some((c) => H.txDate.test(c) || H.postDate.test(c) || H.date.test(c));
    const hasAmount = row.some((c) => H.amount.test(c) || H.debit.test(c) || H.credit.test(c));
    const hasDesc = row.some((c) => H.description.test(c) || H.descriptionAlt.test(c));
    if (hasDate && (hasAmount || hasDesc)) return i;
  }
  return -1;
}

function colIndex(headers: string[], re: RegExp, exclude: Set<number> = new Set()): number | undefined {
  const i = headers.findIndex((h, idx) => !exclude.has(idx) && re.test(h.trim()));
  return i >= 0 ? i : undefined;
}

function columnValues(rows: string[][], col: number, max = 200): string[] {
  return rows.slice(0, max).map((r) => r[col] ?? '').filter((v) => v !== '');
}

function isNumericColumn(rows: string[][], col: number): boolean {
  const vals = columnValues(rows, col);
  if (vals.length === 0) return false;
  const ok = vals.filter((v) => parseAmountToCents(v) !== null && /\d/.test(v));
  return ok.length / vals.length > 0.9;
}

function inferHeaderless(rows: string[][], warnings: string[]): CsvMapping | null {
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  let dateCol = -1;
  for (let c = 0; c < width; c++) {
    const vals = columnValues(rows, c);
    if (vals.length && vals.filter(looksLikeDate).length / vals.length > 0.9) {
      dateCol = c;
      break;
    }
  }
  if (dateCol < 0) return null;
  const numeric: number[] = [];
  for (let c = 0; c < width; c++) if (c !== dateCol && isNumericColumn(rows, c)) numeric.push(c);
  if (numeric.length === 0) return null;
  let descCol = -1;
  let bestLen = 0;
  for (let c = 0; c < width; c++) {
    if (c === dateCol || numeric.includes(c)) continue;
    const vals = columnValues(rows, c);
    const avg = vals.reduce((s, v) => s + v.length, 0) / Math.max(1, vals.length);
    if (avg > bestLen) {
      bestLen = avg;
      descCol = c;
    }
  }
  if (descCol < 0) return null;
  const dateFormat = detectDateFormat(columnValues(rows, dateCol));
  if (!dateFormat) return null;
  warnings.push('No header row found; columns were guessed from their contents. Please check the preview.');
  return {
    skipRows: 0,
    hasHeader: false,
    dateColumn: dateCol,
    dateFormat,
    descriptionColumn: descCol,
    amountMode: 'single',
    amountColumn: numeric[0],
    invertSign: false,
  };
}

export interface DetectOptions {
  /** Helps guess the sign convention for card exports. */
  accountType?: 'checking' | 'savings' | 'credit_card' | 'cash' | 'other';
}

/** Look at a CSV export and guess how to read it. */
export function detectCsv(text: string, opts: DetectOptions = {}): CsvDetection {
  const all = parseCsvRows(text);
  const warnings: string[] = [];
  if (all.length === 0) throw new Error('The file is empty.');

  const headerIdx = findHeader(all);
  let mapping: CsvMapping | null = null;
  let headers: string[] | null = null;
  let rows: string[][];

  if (headerIdx >= 0) {
    headers = all[headerIdx];
    rows = all.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ''));
    const used = new Set<number>();
    const take = (re: RegExp) => {
      const i = colIndex(headers!, re, used);
      if (i !== undefined) used.add(i);
      return i;
    };
    const dateColumn = take(H.txDate) ?? take(H.date) ?? take(H.postDate);
    take(H.postDate); // reserve so it isn't mistaken for something else
    const amountColumn = take(H.amount);
    const debitColumn = amountColumn === undefined ? take(H.debit) : undefined;
    const creditColumn = amountColumn === undefined ? take(H.credit) : undefined;
    const categoryColumn = take(H.category);
    const classificationColumn = take(H.classification);
    const typeColumn = take(H.type);
    const descriptionColumn = take(H.description) ?? take(H.descriptionAlt);
    const extra = take(H.extraDescription);
    const memoColumn = take(H.memo);
    const checkColumn = take(H.check);
    const idColumn = take(H.id);
    const notesColumn = take(H.notes);

    if (dateColumn === undefined) throw new Error('Could not find a date column.');
    if (descriptionColumn === undefined) throw new Error('Could not find a description column.');
    if (amountColumn === undefined && debitColumn === undefined && creditColumn === undefined) {
      throw new Error('Could not find an amount column (or debit/credit columns).');
    }
    const dateFormat = detectDateFormat(columnValues(rows, dateColumn));
    if (!dateFormat) throw new Error(`Could not understand the dates in column "${headers[dateColumn]}".`);

    mapping = {
      skipRows: headerIdx,
      hasHeader: true,
      dateColumn,
      dateFormat,
      descriptionColumn,
      extraDescriptionColumns: extra !== undefined ? [extra] : undefined,
      amountMode: amountColumn !== undefined ? 'single' : 'debit_credit',
      amountColumn,
      debitColumn,
      creditColumn,
      typeColumn,
      invertSign: false,
      memoColumn,
      checkColumn,
      idColumn,
      categoryColumn,
      classificationColumn,
      notesColumn,
    };
  } else {
    rows = all;
    mapping = inferHeaderless(rows, warnings);
    if (!mapping) throw new Error('Could not recognise this CSV layout. Map the columns manually.');
  }

  // Sign convention guess for single-amount files.
  if (mapping.amountMode === 'single' && mapping.amountColumn !== undefined) {
    const vals = columnValues(rows, mapping.amountColumn)
      .map(parseAmountToCents)
      .filter((v): v is number => v !== null);
    const positive = vals.filter((v) => v > 0).length;
    const allPositive = vals.length > 0 && positive === vals.length;
    if (mapping.typeColumn !== undefined && allPositive) {
      // Signs come from the type column; nothing to invert.
    } else if (opts.accountType === 'credit_card' && vals.length > 0 && positive / vals.length > 0.6) {
      mapping.invertSign = true;
      warnings.push('Purchases appear as positive numbers, so signs were flipped (purchases = money out). Check the preview.');
    }
  }
  return { mapping, headers, rows, warnings };
}

/** Re-split the raw file with a (possibly user-edited) mapping. */
export function rowsForMapping(text: string, mapping: CsvMapping): string[][] {
  const all = parseCsvRows(text);
  return all.slice(mapping.skipRows + (mapping.hasHeader ? 1 : 0)).filter((r) => r.some((c) => c !== ''));
}

const DEBIT_WORDS = /^(debit|dr|d|withdrawal|sale|purchase|payment out|charge|fee|outflow|-)$/i;

/** Apply a mapping to data rows and produce normalised transactions. */
export function applyCsvMapping(
  rows: string[][],
  mapping: CsvMapping,
): { transactions: ParsedTransaction[]; errors: RowError[] } {
  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];
  const firstDataRow = mapping.skipRows + (mapping.hasHeader ? 1 : 0) + 1; // 1-based, for messages

  rows.forEach((row, i) => {
    const rowNo = firstDataRow + i;
    const get = (c?: number) => (c === undefined ? '' : (row[c] ?? '').trim());
    const rawDate = get(mapping.dateColumn);
    if (!rawDate && row.every((c) => !c)) return;
    const date = parseDateWithFormat(rawDate, mapping.dateFormat);
    if (!date) {
      // Footer lines like "Total" are common; only report rows that look like data.
      if (row.filter(Boolean).length > 1) errors.push({ row: rowNo, message: `Unreadable date "${rawDate}"` });
      return;
    }

    let amount: number | null = null;
    if (mapping.amountMode === 'single') {
      amount = parseAmountToCents(get(mapping.amountColumn));
      if (amount !== null && mapping.typeColumn !== undefined) {
        const t = get(mapping.typeColumn);
        if (amount > 0 && DEBIT_WORDS.test(t)) amount = -amount;
      }
    } else {
      const debit = parseAmountToCents(get(mapping.debitColumn));
      const credit = parseAmountToCents(get(mapping.creditColumn));
      if (debit === null && credit === null) amount = null;
      else amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount === null) {
      // Balance lines ("Beginning balance as of …") have no amount; skip quietly.
      if (!/\b(beginning|ending|opening|closing) balance\b/i.test(get(mapping.descriptionColumn))) {
        errors.push({ row: rowNo, message: 'Missing or unreadable amount' });
      }
      return;
    }
    if (mapping.invertSign) amount = -amount;

    const descParts = [get(mapping.descriptionColumn)];
    for (const c of mapping.extraDescriptionColumns ?? []) {
      const v = get(c);
      if (v && !descParts[0].includes(v)) descParts.push(v);
    }
    const description = descParts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!description) {
      errors.push({ row: rowNo, message: 'Missing description' });
      return;
    }

    transactions.push({
      date,
      amountCents: amount,
      description,
      memo: get(mapping.memoColumn) || null,
      checkNumber: get(mapping.checkColumn) || null,
      externalId: get(mapping.idColumn) || null,
      categoryLabel: get(mapping.categoryColumn) || null,
      classificationLabel: get(mapping.classificationColumn) || null,
      notes: get(mapping.notesColumn) || null,
    });
  });
  return { transactions, errors };
}
