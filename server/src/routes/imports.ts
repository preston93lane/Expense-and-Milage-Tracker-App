import type { FastifyInstance } from 'fastify';
import { badRequest, toInt, type AppContext } from '../context';
import { commitImport, previewImport, undoImport, type ImportInput } from '../services/importService';

function readInput(body: unknown): ImportInput {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.content !== 'string' || b.content.length === 0) badRequest('The file is empty.');
  if (typeof b.fileName !== 'string') badRequest('fileName is required');
  return {
    fileName: b.fileName,
    content: b.content,
    accountId: b.accountId ? Number(b.accountId) : null,
    accountType: (b.accountType as ImportInput['accountType']) ?? undefined,
    mapping: (b.mapping as ImportInput['mapping']) ?? null,
    historyMode: b.historyMode === true,
    categoryMap: (b.categoryMap as ImportInput['categoryMap']) ?? undefined,
    skipPossibleDuplicates: b.skipPossibleDuplicates !== false,
    saveMapping: b.saveMapping !== false,
  };
}

export function importRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/import/preview', async (req) => {
    try {
      return previewImport(ctx.db, readInput(req.body));
    } catch (e) {
      badRequest((e as Error).message);
    }
  });

  app.post('/api/import/commit', async (req) => {
    try {
      return commitImport(ctx.db, ctx.paths, readInput(req.body));
    } catch (e) {
      badRequest((e as Error).message);
    }
  });

  app.get('/api/import/batches', async () => {
    return (
      ctx.db
        .prepare(
          `SELECT b.*, a.name AS account_name,
                  (SELECT COUNT(*) FROM transactions t WHERE t.batch_id = b.id) AS current_count
             FROM import_batches b JOIN accounts a ON a.id = b.account_id
            ORDER BY b.id DESC LIMIT 200`,
        )
        .all() as Record<string, unknown>[]
    ).map((b) => ({
      id: b.id,
      accountId: b.account_id,
      accountName: b.account_name,
      kind: b.kind,
      fileName: b.file_name,
      historyMode: !!b.history_mode,
      rowCount: b.row_count,
      newCount: b.new_count,
      duplicateCount: b.duplicate_count,
      errorCount: b.error_count,
      currentCount: b.current_count,
      dateFrom: b.date_from,
      dateTo: b.date_to,
      createdAt: b.created_at,
    }));
  });

  app.delete('/api/import/batches/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    return undoImport(ctx.db, id);
  });
}
