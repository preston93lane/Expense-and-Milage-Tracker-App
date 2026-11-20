import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  confidentMatch,
  htmlToText,
  matchReceipt,
  parseReceiptText,
  receiptSearchWindow,
  type ReceiptMatch,
} from '@et/core';
import { simpleParser } from 'mailparser';
import type { AppPaths } from '../config';
import type { DB } from '../db/database';

type Row = Record<string, any>;

export const RECEIPT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.eml': 'message/rfc822',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
};

export function receiptDirs(paths: AppPaths) {
  const store = join(paths.dataDir, 'receipts');
  const inbox = join(paths.dataDir, 'receipts-inbox');
  for (const d of [store, inbox]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return { store, inbox };
}

async function pdfText(buf: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n') : text;
  } catch {
    return '';
  }
}

interface Extracted {
  text: string;
  emailFrom?: string | null;
  emailSubject?: string | null;
  emailDate?: string | null;
  messageId?: string | null;
}

/** Pull readable text (and email headers) out of a receipt file. */
export async function extractReceipt(fileName: string, buf: Buffer): Promise<Extracted> {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.eml') {
    const mail = await simpleParser(buf);
    const parts: string[] = [];
    if (mail.text) parts.push(mail.text);
    else if (mail.html) parts.push(htmlToText(String(mail.html)));
    for (const a of mail.attachments ?? []) {
      if (a.contentType === 'application/pdf') parts.push(await pdfText(a.content));
    }
    return {
      text: parts.join('\n'),
      emailFrom: mail.from?.text ?? null,
      emailSubject: mail.subject ?? null,
      emailDate: mail.date ? mail.date.toISOString() : null,
      messageId: mail.messageId ?? null,
    };
  }
  if (ext === '.pdf') return { text: await pdfText(buf) };
  if (ext === '.html' || ext === '.htm') return { text: htmlToText(buf.toString('utf8')) };
  if (ext === '.txt') return { text: buf.toString('utf8') };
  return { text: '' }; // images: no text recognition (yet) — enter the amount by hand
}

function candidates(db: DB, receipt: Row): ReceiptMatch[] {
  if (!receipt.total_cents) return [];
  const w = receiptSearchWindow(receipt.receipt_date);
  const txns = db
    .prepare(
      `SELECT id, date, amount_cents, merchant_key, description FROM transactions
        WHERE date BETWEEN ? AND ? AND ABS(amount_cents) BETWEEN ? AND ? AND COALESCE(classification, '') != 'transfer'`,
    )
    .all(w.from, w.to, Math.floor(receipt.total_cents * 0.98) - 100, Math.ceil(receipt.total_cents * 1.02) + 100) as Row[];
  return matchReceipt(
    { merchantKey: receipt.merchant_key, date: receipt.receipt_date, totalCents: receipt.total_cents },
    txns.map((t) => ({ id: t.id, date: t.date, amountCents: t.amount_cents, merchantKey: t.merchant_key, description: t.description })),
  );
}

/** Try to link a receipt to its transaction. Never overrides a match you made. */
export function autoMatch(db: DB, receiptId: number): void {
  const r = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as Row | undefined;
  if (!r || r.match_status === 'matched' || r.match_status === 'ignored') return;
  const matches = candidates(db, r);
  const taken = new Set((db.prepare("SELECT transaction_id FROM receipts WHERE match_status = 'matched' AND transaction_id IS NOT NULL").all() as Row[]).map((x) => x.transaction_id));
  const free = matches.filter((m) => !taken.has(m.transactionId));
  const sure = confidentMatch(free);
  if (sure) {
    db.prepare("UPDATE receipts SET transaction_id = ?, match_status = 'matched', match_score = ? WHERE id = ?").run(sure.transactionId, sure.score, receiptId);
  } else if (free.length) {
    db.prepare("UPDATE receipts SET transaction_id = NULL, match_status = 'suggested', match_score = ? WHERE id = ?").run(free[0].score, receiptId);
  } else {
    db.prepare("UPDATE receipts SET transaction_id = NULL, match_status = 'unmatched', match_score = NULL WHERE id = ?").run(receiptId);
  }
}

export function receiptCandidates(db: DB, receiptId: number) {
  const r = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId) as Row | undefined;
  if (!r) return [];
  return candidates(db, r).slice(0, 5);
}

export interface IngestInput {
  fileName: string;
  buffer: Buffer;
  source: 'upload' | 'email' | 'folder';
  transactionId?: number | null;
}

/** Save a receipt privately in the data folder, read it, and match it. */
export async function ingestReceipt(db: DB, paths: AppPaths, input: IngestInput): Promise<{ id: number; duplicate: boolean }> {
  const sha = createHash('sha256').update(input.buffer).digest('hex');
  const existing = db.prepare('SELECT id FROM receipts WHERE sha256 = ?').get(sha) as Row | undefined;
  if (existing) {
    if (input.transactionId) {
      db.prepare("UPDATE receipts SET transaction_id = ?, match_status = 'matched' WHERE id = ?").run(input.transactionId, existing.id);
    }
    return { id: existing.id, duplicate: true };
  }
  const ext = extname(input.fileName).toLowerCase();
  if (!RECEIPT_TYPES[ext]) throw new Error('Receipts can be PDF, image (JPG/PNG/HEIC), saved email (.eml), web page (.html) or text files.');
  const ex = await extractReceipt(input.fileName, input.buffer);
  if (ex.messageId) {
    const dupMsg = db.prepare('SELECT id FROM receipts WHERE email_message_id = ?').get(ex.messageId) as Row | undefined;
    if (dupMsg) return { id: dupMsg.id, duplicate: true };
  }
  const facts = parseReceiptText(ex.text, { from: ex.emailFrom, subject: ex.emailSubject, date: ex.emailDate });
  const { store } = receiptDirs(paths);
  const year = (facts.date ?? new Date().toISOString()).slice(0, 4);
  const dir = join(store, year);
  mkdirSync(dir, { recursive: true });
  const safe = basename(input.fileName).replace(/[^\w.\- ]+/g, '_').slice(-80);
  const rel = join(year, `${sha.slice(0, 10)}-${safe}`);
  writeFileSync(join(store, rel), input.buffer);
  const info = db
    .prepare(
      `INSERT INTO receipts (file_name, stored_path, mime, size_bytes, sha256, source, email_from, email_subject, email_date, email_message_id,
                             merchant, merchant_key, receipt_date, total_cents, text, transaction_id, match_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.fileName,
      rel,
      RECEIPT_TYPES[ext],
      input.buffer.length,
      sha,
      input.source,
      ex.emailFrom ?? null,
      ex.emailSubject ?? null,
      ex.emailDate ?? null,
      ex.messageId ?? null,
      facts.merchant,
      facts.merchantKey,
      facts.date,
      facts.totalCents,
      ex.text.slice(0, 20000),
      input.transactionId ?? null,
      input.transactionId ? 'matched' : 'unmatched',
    );
  const id = Number(info.lastInsertRowid);
  if (!input.transactionId) autoMatch(db, id);
  return { id, duplicate: false };
}

/** Import every file dropped into the receipts-inbox folder (then move it into storage). */
export async function scanInbox(db: DB, paths: AppPaths): Promise<{ imported: number; duplicates: number; skipped: string[] }> {
  const { inbox } = receiptDirs(paths);
  let imported = 0;
  let duplicates = 0;
  const skipped: string[] = [];
  const done = join(inbox, 'imported');
  for (const name of readdirSync(inbox)) {
    const full = join(inbox, name);
    if (!statSync(full).isFile()) continue;
    if (!RECEIPT_TYPES[extname(name).toLowerCase()]) {
      skipped.push(name);
      continue;
    }
    const r = await ingestReceipt(db, paths, { fileName: name, buffer: readFileSync(full), source: 'folder' });
    if (r.duplicate) duplicates++;
    else imported++;
    mkdirSync(done, { recursive: true });
    renameSync(full, join(done, `${Date.now()}-${name}`));
  }
  return { imported, duplicates, skipped };
}

export function receiptToApi(r: Row) {
  return {
    id: r.id as number,
    fileName: r.file_name as string,
    mime: r.mime as string | null,
    sizeBytes: r.size_bytes as number | null,
    source: r.source as string,
    emailFrom: r.email_from as string | null,
    emailSubject: r.email_subject as string | null,
    merchant: r.merchant as string | null,
    receiptDate: r.receipt_date as string | null,
    totalCents: r.total_cents as number | null,
    transactionId: r.transaction_id as number | null,
    matchStatus: r.match_status as 'unmatched' | 'suggested' | 'matched' | 'ignored',
    matchScore: r.match_score as number | null,
    hasText: !!r.text,
    createdAt: r.created_at as string,
  };
}
