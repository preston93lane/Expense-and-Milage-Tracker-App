import { createReadStream, existsSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { transactionToApi, type TransactionRow } from '../db/rows';
import { emailSettings, PROVIDERS, saveEmailSettings, syncEmailReceipts } from '../services/emailSync';
import { autoMatch, ingestReceipt, receiptCandidates, receiptDirs, receiptToApi, RECEIPT_TYPES, scanInbox } from '../services/receiptService';

type Row = Record<string, any>;

/** Re-run matching for receipts still waiting (e.g. after importing a new bank file). */
export function rematchReceipts(ctx: AppContext): number {
  const ids = (ctx.db.prepare("SELECT id FROM receipts WHERE match_status IN ('unmatched','suggested')").all() as Row[]).map((r) => r.id as number);
  for (const id of ids) autoMatch(ctx.db, id);
  return (ctx.db.prepare(`SELECT COUNT(*) AS n FROM receipts WHERE match_status = 'matched' AND id IN (${ids.map(() => '?').join(',') || 'NULL'})`).get(...ids) as Row).n;
}

export function receiptRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/receipts', async (req) => {
    const q = req.query as Row;
    const where: string[] = [];
    const params: unknown[] = [];
    if (optStr(q.status)) {
      where.push('r.match_status = ?');
      params.push(q.status);
    }
    if (optInt(q.transactionId)) {
      where.push("r.transaction_id = ? AND r.match_status = 'matched'");
      params.push(optInt(q.transactionId));
    }
    const rows = ctx.db
      .prepare(`SELECT r.* FROM receipts r ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(r.receipt_date, r.created_at) DESC LIMIT 500`)
      .all(...params) as Row[];
    const txIds = rows.map((r) => r.transaction_id).filter(Boolean);
    const txs = new Map(
      (txIds.length ? (ctx.db.prepare(`SELECT * FROM transactions WHERE id IN (${txIds.map(() => '?').join(',')})`).all(...txIds) as TransactionRow[]) : []).map((t) => [t.id, transactionToApi(t)]),
    );
    const counts = Object.fromEntries((ctx.db.prepare('SELECT match_status, COUNT(*) AS n FROM receipts GROUP BY match_status').all() as Row[]).map((r) => [r.match_status, r.n]));
    return { receipts: rows.map((r) => ({ ...receiptToApi(r), transaction: r.transaction_id ? txs.get(r.transaction_id) ?? null : null })), counts };
  });

  app.post('/api/receipts', async (req) => {
    const b = (req.body ?? {}) as Row;
    const files = Array.isArray(b.files) ? (b.files as { fileName: string; contentBase64: string }[]) : [];
    if (files.length === 0) badRequest('Choose at least one file');
    const transactionId = optInt(b.transactionId) ?? null;
    const results = [];
    for (const f of files) {
      try {
        const r = await ingestReceipt(ctx.db, ctx.paths, { fileName: f.fileName, buffer: Buffer.from(f.contentBase64, 'base64'), source: 'upload', transactionId });
        const row = ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(r.id) as Row;
        results.push({ fileName: f.fileName, ok: true, duplicate: r.duplicate, receipt: receiptToApi(row) });
      } catch (e) {
        results.push({ fileName: f.fileName, ok: false, error: (e as Error).message });
      }
    }
    return { results };
  });

  app.get('/api/receipts/missing', async (req) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    const rows = ctx.db
      .prepare(
        `SELECT t.* FROM transactions t JOIN categories c ON c.id = t.category_id
          WHERE t.classification = 'business' AND t.amount_cents < 0 AND c.kind = 'expense' AND t.date BETWEEN ? AND ?
            AND (t.amount_cents <= -7500 OR c.key = 'travel_lodging')
            AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.transaction_id = t.id AND r.match_status = 'matched')
          ORDER BY t.amount_cents ASC LIMIT 300`,
      )
      .all(`${year}-01-01`, `${year}-12-31`) as TransactionRow[];
    return rows.map((t) => transactionToApi(t));
  });

  app.post('/api/receipts/scan-inbox', async () => ({ ...(await scanInbox(ctx.db, ctx.paths)), folder: receiptDirs(ctx.paths).inbox }));

  app.post('/api/receipts/rematch', async () => ({ matched: rematchReceipts(ctx) }));

  app.get('/api/receipts/email-settings', async () => ({ ...emailSettings(ctx.db), providers: PROVIDERS, inboxFolder: receiptDirs(ctx.paths).inbox }));

  app.put('/api/receipts/email-settings', async (req) => {
    const b = (req.body ?? {}) as Row;
    const port = b.port === undefined ? undefined : toInt(b.port, 'port');
    if (port !== undefined && (port < 1 || port > 65535)) badRequest('Port must be 1–65535');
    const host = optStr(b.host);
    if (host && !/^[a-z0-9.-]+$/i.test(host)) badRequest('Enter a server name like imap.gmail.com');
    saveEmailSettings(ctx.db, {
      host: b.host !== undefined ? host ?? '' : undefined,
      port,
      secure: b.secure === undefined ? undefined : !!b.secure,
      user: b.user !== undefined ? optStr(b.user) ?? '' : undefined,
      mailbox: b.mailbox !== undefined ? optStr(b.mailbox) ?? 'INBOX' : undefined,
      lookbackDays: b.lookbackDays === undefined ? undefined : Math.min(730, Math.max(7, toInt(b.lookbackDays, 'lookbackDays'))),
      rememberPassword: b.rememberPassword === undefined ? undefined : !!b.rememberPassword,
    });
    return emailSettings(ctx.db);
  });

  app.post('/api/receipts/email-sync', async (req) => {
    const b = (req.body ?? {}) as Row;
    try {
      return await syncEmailReceipts(ctx.db, ctx.paths, optStr(b.password) ?? null);
    } catch (e) {
      badRequest((e as Error).message);
    }
  });

  app.get('/api/receipts/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const r = ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as Row | undefined;
    if (!r) notFound('Receipt not found');
    const cands = receiptCandidates(ctx.db, id);
    const txs = new Map(
      (cands.length
        ? (ctx.db.prepare(`SELECT * FROM transactions WHERE id IN (${cands.map(() => '?').join(',')})`).all(...cands.map((c) => c.transactionId)) as TransactionRow[])
        : []
      ).map((t) => [t.id, transactionToApi(t)]),
    );
    const linked = r.transaction_id ? (ctx.db.prepare('SELECT * FROM transactions WHERE id = ?').get(r.transaction_id) as TransactionRow | undefined) : undefined;
    return {
      ...receiptToApi(r),
      text: (r.text as string | null)?.slice(0, 4000) ?? null,
      transaction: linked ? transactionToApi(linked) : null,
      candidates: cands.map((c) => ({ ...c, transaction: txs.get(c.transactionId) })),
    };
  });

  app.patch('/api/receipts/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const r = ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as Row | undefined;
    if (!r) notFound('Receipt not found');
    const b = (req.body ?? {}) as Row;
    const date = b.receiptDate !== undefined ? optStr(b.receiptDate) ?? null : r.receipt_date;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) badRequest('Date must be YYYY-MM-DD');
    const total = b.totalCents !== undefined ? (b.totalCents === null ? null : Math.round(Number(b.totalCents))) : r.total_cents;
    const status = optStr(b.matchStatus) ?? r.match_status;
    if (!['unmatched', 'suggested', 'matched', 'ignored'].includes(status)) badRequest('Unknown status');
    const merchant = b.merchant !== undefined ? optStr(b.merchant) ?? null : r.merchant;
    ctx.db
      .prepare('UPDATE receipts SET merchant = ?, merchant_key = ?, receipt_date = ?, total_cents = ?, match_status = ? WHERE id = ?')
      .run(merchant, merchant ? merchant.toUpperCase() : null, date, total, status, id);
    if (status !== 'ignored' && status !== 'matched') autoMatch(ctx.db, id);
    return receiptToApi(ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as Row);
  });

  app.post('/api/receipts/:id/link', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const txId = optInt(((req.body ?? {}) as Row).transactionId) ?? null;
    if (txId && !ctx.db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(txId)) badRequest('Transaction not found');
    ctx.db
      .prepare('UPDATE receipts SET transaction_id = ?, match_status = ?, match_score = NULL WHERE id = ?')
      .run(txId, txId ? 'matched' : 'unmatched', id);
    if (!txId) autoMatch(ctx.db, id);
    return receiptToApi(ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/receipts/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const r = ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as Row | undefined;
    if (!r) notFound('Receipt not found');
    const file = join(receiptDirs(ctx.paths).store, r.stored_path);
    ctx.db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
    if (file.startsWith(receiptDirs(ctx.paths).store) && existsSync(file)) rmSync(file);
    return { ok: true };
  });

  /** The receipt file itself. Web pages/emails are sent as downloads so their code can never run inside the app. */
  app.get('/api/receipts/:id/file', async (req, reply) => {
    const id = toInt((req.params as Row).id, 'id');
    const r = ctx.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as Row | undefined;
    if (!r) notFound('Receipt not found');
    const store = receiptDirs(ctx.paths).store;
    const file = join(store, r.stored_path);
    if (!file.startsWith(store) || !existsSync(file)) notFound('File is missing from the receipts folder');
    const ext = extname(r.file_name).toLowerCase();
    const inline = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    reply.header('Content-Type', inline ? RECEIPT_TYPES[ext] : 'application/octet-stream');
    reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${String(r.file_name).replace(/[^\w.\- ]+/g, '_')}"`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(createReadStream(file));
  });
}
