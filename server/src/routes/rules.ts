import {
  ruleFromTransaction,
  ruleMatches,
  sortRules,
  type Rule,
  type RuleActions,
  type RuleConditions,
} from '@et/core';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optStr, toInt, type AppContext } from '../context';
import { ruleFromRow, transactionToApi, type RuleRow, type TransactionRow } from '../db/rows';
import { applyResult, recategorize } from '../services/categorizeService';

const FIELDS = ['description', 'merchant', 'amount', 'direction', 'account', 'state', 'city', 'date'];
const OPS = ['contains', 'not_contains', 'starts_with', 'equals', 'regex', 'between', 'gte', 'lte', 'in'];

function validateConditions(c: unknown): RuleConditions {
  const cond = c as RuleConditions;
  if (!cond || !Array.isArray(cond.items) || cond.items.length === 0) badRequest('A rule needs at least one condition');
  if (cond.match !== 'all' && cond.match !== 'any') badRequest('match must be "all" or "any"');
  for (const it of cond.items) {
    if (!FIELDS.includes(it.field)) badRequest(`Unknown field "${it.field}"`);
    if (!OPS.includes(it.op)) badRequest(`Unknown operator "${it.op}"`);
    if (it.value === undefined || it.value === null || it.value === '') badRequest('Every condition needs a value');
    if (it.op === 'regex') {
      try {
        new RegExp(String(it.value));
      } catch {
        badRequest(`Invalid pattern: ${it.value}`);
      }
    }
  }
  return cond;
}

function validateActions(a: unknown): RuleActions {
  const act = (a ?? {}) as RuleActions;
  if (act.classification && !['business', 'personal', 'transfer'].includes(act.classification)) badRequest('Unknown classification');
  if (!act.classification && !act.categoryId) badRequest('A rule must set business/personal/transfer or a category');
  if (act.businessPct !== undefined && act.businessPct !== null && !(act.businessPct > 0 && act.businessPct < 100)) {
    badRequest('Business % must be between 1 and 99');
  }
  return act;
}

function allTransactions(ctx: AppContext): TransactionRow[] {
  return ctx.db.prepare('SELECT * FROM transactions ORDER BY date DESC').all() as TransactionRow[];
}

function facts(t: TransactionRow) {
  return {
    description: t.description,
    merchant: t.merchant,
    amountCents: t.amount_cents,
    accountId: t.account_id,
    state: t.state,
    city: t.city,
    date: t.date,
  };
}

export function ruleRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/rules', async () => {
    const rows = (ctx.db.prepare('SELECT * FROM rules').all() as RuleRow[]).map(ruleFromRow);
    return sortRules(rows) as typeof rows;
  });

  function insertRule(r: Omit<Rule, 'id'>): number {
    const info = ctx.db
      .prepare('INSERT INTO rules (name, priority, enabled, auto_confirm, conditions, actions) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.name, r.priority, r.enabled ? 1 : 0, r.autoConfirm ? 1 : 0, JSON.stringify(r.conditions), JSON.stringify(r.actions));
    return Number(info.lastInsertRowid);
  }

  app.post('/api/rules', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const conditions = validateConditions(b.conditions);
    const actions = validateActions(b.actions);
    const id = insertRule({
      name: optStr(b.name) ?? 'Untitled rule',
      priority: b.priority === undefined ? 100 : toInt(b.priority, 'priority'),
      enabled: b.enabled !== false,
      autoConfirm: b.autoConfirm !== false,
      conditions,
      actions,
    });
    const applied = b.applyNow === false ? 0 : recategorize(ctx.db);
    return { rule: ruleFromRow(ctx.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow), applied };
  });

  /** "Always do this for <merchant>" — builds a rule from a transaction you just categorised. */
  app.post('/api/rules/from-transaction', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = toInt(b.transactionId, 'transactionId');
    const t = ctx.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TransactionRow | undefined;
    if (!t) notFound('Transaction not found');
    const actions = validateActions(
      b.actions ?? {
        classification: t.classification ?? undefined,
        categoryId: t.classification === 'business' ? t.category_id : null,
      },
    );
    const categoryName = actions.categoryId
      ? (ctx.db.prepare('SELECT name FROM categories WHERE id = ?').get(actions.categoryId) as { name: string } | undefined)?.name
      : undefined;
    const draft = ruleFromTransaction({ merchant: t.merchant, amountCents: t.amount_cents }, actions, categoryName);
    const existing = (ctx.db.prepare('SELECT * FROM rules').all() as RuleRow[])
      .map(ruleFromRow)
      .find((r) => JSON.stringify(r.conditions) === JSON.stringify(draft.conditions));
    let ruleId: number;
    if (existing) {
      ctx.db.prepare('UPDATE rules SET actions = ?, name = ?, enabled = 1 WHERE id = ?').run(JSON.stringify(actions), draft.name, existing.id);
      ruleId = existing.id;
    } else {
      ruleId = insertRule(draft);
    }
    const applied = recategorize(ctx.db);
    return { rule: ruleFromRow(ctx.db.prepare('SELECT * FROM rules WHERE id = ?').get(ruleId) as RuleRow), applied, updatedExisting: !!existing };
  });

  app.patch('/api/rules/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const row = ctx.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined;
    if (!row) notFound('Rule not found');
    const cur = ruleFromRow(row);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const conditions = b.conditions !== undefined ? validateConditions(b.conditions) : cur.conditions;
    const actions = b.actions !== undefined ? validateActions(b.actions) : cur.actions;
    ctx.db
      .prepare('UPDATE rules SET name = ?, priority = ?, enabled = ?, auto_confirm = ?, conditions = ?, actions = ? WHERE id = ?')
      .run(
        optStr(b.name) ?? cur.name,
        b.priority !== undefined ? toInt(b.priority, 'priority') : cur.priority,
        b.enabled !== undefined ? (b.enabled ? 1 : 0) : cur.enabled ? 1 : 0,
        b.autoConfirm !== undefined ? (b.autoConfirm ? 1 : 0) : cur.autoConfirm ? 1 : 0,
        JSON.stringify(conditions),
        JSON.stringify(actions),
        id,
      );
    const applied = b.applyNow === false ? 0 : recategorize(ctx.db);
    return { rule: ruleFromRow(ctx.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow), applied };
  });

  app.delete('/api/rules/:id', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    ctx.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    recategorize(ctx.db);
    return { ok: true };
  });

  /** Preview which transactions a rule would match, without saving it. */
  app.post('/api/rules/test', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const conditions = validateConditions(b.conditions);
    const probe: Rule = { id: -1, name: 'test', priority: 0, enabled: true, autoConfirm: true, conditions, actions: {} };
    const matches = allTransactions(ctx).filter((t) => ruleMatches(probe, facts(t)));
    return {
      count: matches.length,
      reviewedCount: matches.filter((t) => t.status === 'reviewed').length,
      sample: matches.slice(0, 25).map((t) => transactionToApi(t)),
    };
  });

  /**
   * Apply a rule now. Undecided transactions are always updated; already
   * reviewed ones only when includeReviewed=true (logged for undo).
   */
  app.post('/api/rules/:id/apply', async (req) => {
    const id = toInt((req.params as { id: string }).id, 'id');
    const row = ctx.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RuleRow | undefined;
    if (!row) notFound('Rule not found');
    const rule = ruleFromRow(row);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const includeReviewed = b.includeReviewed === true;
    const matches = allTransactions(ctx).filter(
      (t) => ruleMatches({ ...rule, enabled: true }, facts(t)) && (includeReviewed || t.status !== 'reviewed'),
    );
    const snaps = matches.map((t) => ({
      id: t.id, status: t.status, classification: t.classification, category_id: t.category_id, is_split: t.is_split,
      source: t.source, confidence: t.confidence, rule_id: t.rule_id, trip_id: t.trip_id, notes: t.notes,
      splits: ctx.db.prepare('SELECT * FROM splits WHERE transaction_id = ?').all(t.id),
    }));
    ctx.db.transaction(() => {
      for (const t of matches) {
        const cls = rule.actions.classification ?? 'business';
        applyResult(ctx.db, t.id, t.amount_cents, {
          status: rule.autoConfirm ? 'reviewed' : 'suggested',
          classification: cls,
          categoryId: cls === 'business' ? rule.actions.categoryId ?? null : null,
          businessPct: rule.actions.businessPct && rule.actions.businessPct < 100 ? rule.actions.businessPct : undefined,
          source: 'rule',
          confidence: 1,
          ruleId: rule.id,
          note: rule.actions.note,
        });
      }
      if (matches.length) {
        ctx.db
          .prepare('INSERT INTO action_log (summary, undo_json) VALUES (?, ?)')
          .run(`Applied rule "${rule.name}" to ${matches.length} transactions`, JSON.stringify(snaps));
      }
    })();
    return { applied: matches.length };
  });
}
