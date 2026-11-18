import type { Classification, CsvMapping, ReviewStatus, RuleActions, RuleConditions, TaxLineInfo } from '@et/core';

export class ApiError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (method !== 'GET') {
    // The server only accepts JSON for writes (blocks cross-site requests).
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
};

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash' | 'other';

export interface Account {
  id: number;
  name: string;
  institution: string | null;
  type: AccountType;
  last4: string | null;
  hasSavedMapping: boolean;
  ofxAccountId: string | null;
  archived: boolean;
  transactionCount?: number;
  lastTransactionDate?: string | null;
  lastImportAt?: string | null;
}

export interface Category {
  id: number;
  key: string | null;
  name: string;
  kind: 'expense' | 'income' | 'other';
  taxLine: string;
  deductiblePct: number;
  description: string | null;
  aliases: string[];
  sortOrder: number;
  isSystem: boolean;
  archived: boolean;
  usageCount?: number;
}

export interface Split {
  id: number;
  amountCents: number;
  classification: Classification;
  categoryId: number | null;
  note: string | null;
}

export interface Transaction {
  id: number;
  accountId: number;
  batchId: number | null;
  date: string;
  amountCents: number;
  description: string;
  memo: string | null;
  merchant: string;
  merchantKey: string;
  city: string | null;
  state: string | null;
  isOnline: boolean;
  checkNumber: string | null;
  status: ReviewStatus;
  classification: Classification | null;
  categoryId: number | null;
  isSplit: boolean;
  splits: Split[];
  source: string | null;
  confidence: number | null;
  ruleId: number | null;
  transferPairId: number | null;
  tripId: number | null;
  notes: string | null;
}

export interface TransactionList {
  rows: Transaction[];
  total: number;
  totals: { outCents: number; inCents: number };
}

export interface Rule {
  id: number;
  name: string;
  priority: number;
  enabled: boolean;
  autoConfirm: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
  matchCount: number;
  lastMatchedAt: string | null;
  createdAt: string;
}

export interface PreviewRow {
  date: string;
  amountCents: number;
  description: string;
  merchant: string;
  city: string | null;
  state: string | null;
  duplicate: 'exact' | 'possible' | null;
  status: ReviewStatus;
  classification: Classification | null;
  categoryId: number | null;
  source: string | null;
  categoryLabel: string | null;
  classificationLabel: string | null;
}

export interface ImportPreview {
  kind: 'csv' | 'ofx';
  mapping: CsvMapping | null;
  headers: string[] | null;
  sampleRows: string[][];
  ofx: { accountId: string | null; accountType: string } | null;
  suggestedAccountId: number | null;
  warnings: string[];
  errors: { row: number; message: string }[];
  rows: PreviewRow[];
  counts: { total: number; new: number; duplicates: number; possibleDuplicates: number };
  dateRange: { from: string; to: string } | null;
  categoryLabels: { label: string; count: number; categoryId: number | null }[];
}

export interface ImportResult {
  batchId: number;
  newCount: number;
  duplicateCount: number;
  possibleDuplicatesSkipped: number;
  errorCount: number;
  autoReviewed: number;
  suggested: number;
  needsReview: number;
  transfersPaired: number;
}

export interface ImportBatch {
  id: number;
  accountId: number;
  accountName: string;
  kind: string;
  fileName: string;
  historyMode: boolean;
  rowCount: number;
  newCount: number;
  duplicateCount: number;
  errorCount: number;
  currentCount: number;
  dateFrom: string | null;
  dateTo: string | null;
  createdAt: string;
}

export interface Dashboard {
  year: number;
  years: number[];
  mileageMethod: 'standard' | 'actual';
  review: { unreviewed: number; suggested: number; reviewed: number; yearNeedsReview: number };
  incomeCents: number;
  expenseCents: number;
  deductibleCents: number;
  netProfitCents: number;
  uncategorizedBusiness: number;
  categories: {
    categoryId: number;
    name: string;
    kind: string;
    taxLine: string;
    totalCents: number;
    deductibleCents: number;
    count: number;
    countsTowardScheduleC: boolean;
  }[];
  monthly: { month: string; incomeCents: number; expenseCents: number }[];
}

export interface ActionEntry {
  id: number;
  createdAt: string;
  summary: string;
  undoneAt: string | null;
  count: number;
}

export interface BulkResult {
  updated: number;
  actionId: number | null;
  relearned: number;
}

export interface Trip {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  destCity: string | null;
  destState: string | null;
  beforeDays: number;
  afterDays: number;
  purpose: string | null;
  createdAt: string;
}

export interface TripTotals {
  byCategory: { categoryId: number | null; name: string; count: number; totalCents: number; deductibleCents: number }[];
  count: number;
  totalCents: number;
  deductibleCents: number;
}

export interface TripListItem extends Trip {
  totals: TripTotals;
  suggestedCount: number;
}

export interface TripCandidate {
  transaction: Transaction;
  reason: 'during' | 'booked_before' | 'posted_after';
  why: string;
  preselect: boolean;
  suggestedCategoryId: number | null;
}

export interface TripDetail {
  trip: Trip;
  homeState: string | null;
  candidates: TripCandidate[];
  assigned: Transaction[];
  totals: TripTotals;
}

export interface TripSuggestion {
  state: string;
  cities: string[];
  startDate: string;
  endDate: string;
  transactionCount: number;
  totalCents: number;
}

export type { TaxLineInfo };
