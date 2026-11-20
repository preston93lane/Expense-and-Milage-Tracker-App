import type { Classification, ReviewStatus, Rule } from '@et/core';
import type { DB } from './database';

export interface AccountRow {
  id: number;
  name: string;
  institution: string | null;
  type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'other';
  last4: string | null;
  csv_mapping: string | null;
  ofx_account_id: string | null;
  archived: number;
  created_at: string;
}

export interface CategoryRow {
  id: number;
  key: string | null;
  name: string;
  kind: 'expense' | 'income' | 'other';
  tax_line: string;
  deductible_pct: number;
  description: string | null;
  aliases: string | null;
  sort_order: number;
  is_system: number;
  archived: number;
}

export interface TransactionRow {
  id: number;
  account_id: number;
  batch_id: number | null;
  date: string;
  amount_cents: number;
  description: string;
  memo: string | null;
  merchant: string;
  merchant_key: string;
  city: string | null;
  state: string | null;
  is_online: number;
  external_id: string | null;
  check_number: string | null;
  dedupe_key: string;
  status: ReviewStatus;
  classification: Classification | null;
  category_id: number | null;
  is_split: number;
  source: string | null;
  confidence: number | null;
  rule_id: number | null;
  transfer_pair_id: number | null;
  trip_id: number | null;
  client_id: number | null;
  project_id: number | null;
  contractor_id: number | null;
  payment_method: 'direct' | 'card_or_processor' | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SplitRow {
  id: number;
  transaction_id: number;
  amount_cents: number;
  classification: Classification;
  category_id: number | null;
  note: string | null;
}

export interface RuleRow {
  id: number;
  name: string;
  priority: number;
  enabled: number;
  auto_confirm: number;
  conditions: string;
  actions: string;
  match_count: number;
  last_matched_at: string | null;
  created_at: string;
}

export function ruleFromRow(r: RuleRow): Rule & { matchCount: number; lastMatchedAt: string | null; createdAt: string } {
  return {
    id: r.id,
    name: r.name,
    priority: r.priority,
    enabled: !!r.enabled,
    autoConfirm: !!r.auto_confirm,
    conditions: JSON.parse(r.conditions),
    actions: JSON.parse(r.actions),
    matchCount: r.match_count,
    lastMatchedAt: r.last_matched_at,
    createdAt: r.created_at,
  };
}

export function categoryToApi(c: CategoryRow) {
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    kind: c.kind,
    taxLine: c.tax_line,
    deductiblePct: c.deductible_pct,
    description: c.description,
    aliases: c.aliases ? (JSON.parse(c.aliases) as string[]) : [],
    sortOrder: c.sort_order,
    isSystem: !!c.is_system,
    archived: !!c.archived,
  };
}

export function accountToApi(a: AccountRow) {
  return {
    id: a.id,
    name: a.name,
    institution: a.institution,
    type: a.type,
    last4: a.last4,
    hasSavedMapping: !!a.csv_mapping,
    ofxAccountId: a.ofx_account_id,
    archived: !!a.archived,
    createdAt: a.created_at,
  };
}

export function splitToApi(s: SplitRow) {
  return {
    id: s.id,
    amountCents: s.amount_cents,
    classification: s.classification,
    categoryId: s.category_id,
    note: s.note,
  };
}

export function transactionToApi(t: TransactionRow, splits: SplitRow[] = []) {
  return {
    id: t.id,
    accountId: t.account_id,
    batchId: t.batch_id,
    date: t.date,
    amountCents: t.amount_cents,
    description: t.description,
    memo: t.memo,
    merchant: t.merchant,
    merchantKey: t.merchant_key,
    city: t.city,
    state: t.state,
    isOnline: !!t.is_online,
    checkNumber: t.check_number,
    status: t.status,
    classification: t.classification,
    categoryId: t.category_id,
    isSplit: !!t.is_split,
    splits: splits.map(splitToApi),
    source: t.source,
    confidence: t.confidence,
    ruleId: t.rule_id,
    transferPairId: t.transfer_pair_id,
    tripId: t.trip_id,
    clientId: t.client_id,
    projectId: t.project_id,
    contractorId: t.contractor_id,
    paymentMethod: t.payment_method,
    notes: t.notes,
  };
}

export interface TripRow {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  dest_city: string | null;
  dest_state: string | null;
  purpose: string | null;
  before_days: number;
  after_days: number;
  client_id: number | null;
  project_id: number | null;
  agreed_fee_cents: number | null;
  created_at: string;
}

export function tripToWindow(t: TripRow) {
  return {
    id: t.id,
    name: t.name,
    startDate: t.start_date,
    endDate: t.end_date,
    destCity: t.dest_city,
    destState: t.dest_state,
    beforeDays: t.before_days,
    afterDays: t.after_days,
  };
}

export function tripToApi(t: TripRow) {
  return {
    ...tripToWindow(t),
    purpose: t.purpose,
    clientId: t.client_id,
    projectId: t.project_id,
    agreedFeeCents: t.agreed_fee_cents,
    createdAt: t.created_at,
  };
}

export type ApiTransaction = ReturnType<typeof transactionToApi>;

export function splitsFor(db: DB, ids: number[]): Map<number, SplitRow[]> {
  const map = new Map<number, SplitRow[]>();
  if (ids.length === 0) return map;
  const chunk = 500;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const rows = db
      .prepare(`SELECT * FROM splits WHERE transaction_id IN (${part.map(() => '?').join(',')}) ORDER BY id`)
      .all(...part) as SplitRow[];
    for (const s of rows) {
      const list = map.get(s.transaction_id) ?? [];
      list.push(s);
      map.set(s.transaction_id, list);
    }
  }
  return map;
}
