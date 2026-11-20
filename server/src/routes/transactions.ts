import type { Classification } from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { recategorize } from '../services/categorizeService';
import {
  bulkUpdate,
  createManualTransaction,
  deleteManualTransaction,
  getTransaction,
  listActions,
  listIds,
  listTransactions,
  removeSplits,
  setSplits,
  undoAction,
  type SplitInput,
  type TransactionFilters,
} from '../services/transactionService';

const CLASSES = ['business', 'personal', 'transfer'];

function filtersFrom(q: Record<string, unknown>): TransactionFilters {
  const status = optStr(q.status);
  const classification = optStr(q.classification);
  const sort = optStr(q.sort);
  const direction = optStr(q.direction);
  return {
    from: optStr(q.from),
    to: optStr(q.to),
    accountId: optInt(q.accountId),
    batchId: optInt(q.batchId),
    tripId: q.tripId === 'none' ? 'none' : optInt(q.tripId),
    clientId: optInt(q.clientId),
    projectId: optInt(q.projectId),
    contractorId: optInt(q.contractorId),
    status: status as TransactionFilters['status'],
    classification: classification as TransactionFilters['classification'],
    categoryId: optInt(q.categoryId),
    q: optStr(q.q),
    direction: direction === 'in' || direction === 'out' ? direction : undefined,
    limit: optInt(q.limit),
    offset: optInt(q.offset),
    sort: sort as TransactionFilters['sort'],
  };
}

export function transactionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/transactions', async (req) => listTransactions(ctx.db, filtersFrom(req.query as Record<string, unknown>)));

  app.get('/api/transactions/:id', async (req) => {
    const t = getTransaction(ctx.db, toInt((req.params as { id: string }).id, 'id'));
    if (!t) notFound('Transaction not found');
    return t;
  });

  /** Manual entry (cash, tips, anything not in a bank file). */
  app.post('/api/transactions', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      return createManualTransaction(ctx.db, {
        accountId: toInt(b.accountId, 'accountId'),
        date: String(b.date ?? ''),
        amountCents: Number(b.amountCents),
        description: String(b.description ?? ''),
        classification: (optStr(b.classification) as Classification) ?? null,
        categoryId: optInt(b.categoryId) ?? null,
        notes: optStr(b.notes) ?? null,
      });
    } catch (e) {
      badRequest((e as Error).message);
    }
  });

  app.delete('/api/transactions/:id', async (req) => {
    try {
      deleteManualTransaction(ctx.db, toInt((req.params as { id: string }).id, 'id'));
      return { ok: true };
    } catch (e) {
      badRequest((e as Error).message);
    }
  });

  /**
   * Bulk change. Pass `ids`, or `filters` to act on everything matching the
   * current filter (e.g. "every transaction Oct 12–16").
   */
  app.post('/api/transactions/bulk', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    let ids: number[] = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter(Number.isInteger) : [];
    if (ids.length === 0 && b.filters) ids = listIds(ctx.db, filtersFrom(b.filters as Record<string, unknown>));
    if (ids.length === 0) badRequest('No transactions selected');
    const classification = optStr(b.classification);
    if (classification && !CLASSES.includes(classification)) badRequest('Unknown classification');
    return bulkUpdate(ctx.db, {
      ids,
      classification: classification as Classification | undefined,
      categoryId: b.categoryId === undefined ? undefined : b.categoryId === null ? null : toInt(b.categoryId, 'categoryId'),
      approve: b.approve === true,
      reset: b.reset === true,
      notes: b.notes === undefined ? undefined : (optStr(b.notes) ?? null),
      tripId: b.tripId === undefined ? undefined : b.tripId === null ? null : toInt(b.tripId, 'tripId'),
      clientId: b.clientId === undefined ? undefined : b.clientId === null ? null : toInt(b.clientId, 'clientId'),
      projectId: b.projectId === undefined ? undefined : b.projectId === null ? null : toInt(b.projectId, 'projectId'),
      contractorId: b.contractorId === undefined ? undefined : b.contractorId === null ? null : toInt(b.contractorId, 'contractorId'),
      paymentMethod:
        b.paymentMethod === undefined
          ? undefined
          : b.paymentMethod === 'direct' || b.paymentMethod === 'card_or_processor'
            ? b.paymentMethod
            : null,
    });
  });

  app.put('/api/transactions/:id/splits', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const b = (req.body ?? {}) as { splits?: SplitInput[] };
    if (!Array.isArray(b.splits)) badRequest('splits is required');
    for (const s of b.splits) {
      if (!CLASSES.includes(s.classification)) badRequest('Each line needs business, personal or transfer');
      if (!Number.isInteger(s.amountCents)) badRequest('Each line needs an amount');
    }
    try {
      setSplits(ctx.db, id, b.splits);
    } catch (e) {
      badRequest((e as Error).message);
    }
    return getTransaction(ctx.db, id);
  });

  app.delete('/api/transactions/:id/splits', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    removeSplits(ctx.db, id);
    return getTransaction(ctx.db, id);
  });

  /** Re-run auto-categorisation on everything still undecided. */
  app.post('/api/transactions/recategorize', async () => ({ changed: recategorize(ctx.db) }));

  /** Skip one rule for one transaction. The transaction goes back to being decided by everything else. */
  app.post('/api/transactions/:id/ignore-rule', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const ruleId = toInt(((req.body ?? {}) as Record<string, unknown>).ruleId, 'ruleId');
    const t = ctx.db.prepare('SELECT id FROM transactions WHERE id = ?').get(id);
    if (!t) badRequest('Transaction not found');
    ctx.db.transaction(() => {
      ctx.db.prepare('INSERT OR IGNORE INTO rule_exceptions (rule_id, transaction_id) VALUES (?, ?)').run(ruleId, id);
      ctx.db
        .prepare("UPDATE transactions SET status='unreviewed', classification=NULL, category_id=NULL, source=NULL, confidence=NULL, rule_id=NULL, is_split=0 WHERE id=?")
        .run(id);
      ctx.db.prepare('DELETE FROM splits WHERE transaction_id = ?').run(id);
      recategorize(ctx.db, { ids: [id] });
    })();
    return getTransaction(ctx.db, id);
  });

  app.get('/api/actions', async (req) => listActions(ctx.db, optInt((req.query as Record<string, unknown>).limit) ?? 20));

  app.post('/api/actions/:id/undo', async (req) => {
    try {
      return undoAction(ctx.db, toInt((req.params as { id: string }).id, 'id'));
    } catch (e) {
      badRequest((e as Error).message);
    }
  });
}
