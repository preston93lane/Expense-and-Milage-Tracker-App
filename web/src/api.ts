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
  clientId: number | null;
  projectId: number | null;
  contractorId: number | null;
  paymentMethod: 'direct' | 'card_or_processor' | null;
  receiptCount?: number;
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
  clientId: number | null;
  projectId: number | null;
  agreedFeeCents: number | null;
  createdAt: string;
}

export interface TripTotals {
  byCategory: { categoryId: number | null; name: string; count: number; totalCents: number; deductibleCents: number }[];
  count: number;
  totalCents: number;
  deductibleCents: number;
}

export interface TripProfitInfo {
  receivedCents: number;
  invoicedOpenCents: number;
  agreedFeeCents: number | null;
  invoices: { id: number; number: string | null; totalCents: number; balanceCents: number; state: string }[];
  days: number;
  incomeCents: number;
  incomeIsEstimate: boolean;
  incomeSource: 'received' | 'received+invoiced' | 'invoiced' | 'agreed_fee' | 'none';
  costCents: number;
  profitCents: number;
  marginPct: number | null;
  costPerDayCents: number;
  profitPerDayCents: number;
  verdict: 'profitable' | 'break_even' | 'lost_money' | 'no_income';
}

export interface TripListItem extends Trip {
  clientName: string | null;
  totals: TripTotals;
  profit: TripProfitInfo;
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
  income: Transaction[];
  incomeCandidates: Transaction[];
  totals: TripTotals;
  profit: TripProfitInfo;
}

export interface TripSuggestion {
  state: string;
  cities: string[];
  startDate: string;
  endDate: string;
  transactionCount: number;
  totalCents: number;
}

export interface Client {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  archived: boolean;
  yearIncomeCents: number;
  allTimeIncomeCents: number;
  lastPaymentDate: string | null;
  outstandingCents: number;
  activeRetainers: number;
}

export interface Project {
  id: number;
  clientId: number | null;
  clientName: string | null;
  name: string;
  status: 'active' | 'completed' | 'archived';
  budgetCents: number | null;
  notes: string | null;
}

export interface Retainer {
  id: number;
  clientId: number;
  clientName?: string;
  name: string;
  amountCents: number;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate: string | null;
  active: boolean;
  notes: string | null;
}

export interface ExpectedPayment {
  retainerId: number;
  clientId: number;
  clientName: string;
  name: string;
  dueDate: string;
  amountCents: number;
  status: 'received' | 'upcoming' | 'late' | 'missed';
  transactionId: number | null;
}

export interface InvoiceLineApi {
  id?: number;
  description: string;
  quantity: number;
  unitCents: number;
}

export interface Invoice {
  id: number;
  clientId: number;
  clientName: string;
  client: { id: number; name: string; email: string | null; address: string | null } | null;
  projectId: number | null;
  tripId: number | null;
  number: string | null;
  issueDate: string;
  dueDate: string | null;
  status: 'draft' | 'sent' | 'void';
  notes: string | null;
  lines: InvoiceLineApi[];
  payments: { id: number; transactionId: number | null; amountCents: number; date: string; note: string | null }[];
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  state: 'draft' | 'void' | 'paid' | 'partial' | 'overdue' | 'open';
  candidates: { id: number; date: string; amountCents: number; clientId: number | null; description: string }[];
  business?: { name: string; address: string; email: string; phone: string; footer: string };
}

export interface ClientDetail {
  client: { id: number; name: string; email: string | null; phone: string | null; address: string | null; notes: string | null; archived: boolean };
  year: number;
  incomeCents: number;
  expenseCents: number;
  profitCents: number;
  monthly: { month: string; incomeCents: number }[];
  invoices: Invoice[];
  projects: { id: number; name: string; status: string; budgetCents: number | null; incomeCents: number; expenseCents: number }[];
  retainers: Retainer[];
  schedule: ExpectedPayment[];
  trips: { id: number; name: string; startDate: string; endDate: string }[];
  transactions: Transaction[];
}

export type EntityType = 'individual' | 'sole_prop' | 'llc' | 'partnership' | 's_corp' | 'c_corp' | 'other';

export interface Contractor1099Summary {
  contractorId: number;
  name: string;
  year: number;
  thresholdCents: number;
  directCents: number;
  processorCents: number;
  totalCents: number;
  needs1099: boolean;
  approaching: boolean;
  exemptCorporation: boolean;
  warnings: string[];
}

export interface Contractor {
  id: number;
  name: string;
  businessName: string | null;
  email: string | null;
  address: string | null;
  tinLast4: string | null;
  entityType: EntityType;
  w9Received: boolean;
  w9Date: string | null;
  notes: string | null;
  archived: boolean;
  summary?: Contractor1099Summary;
  paymentCount?: number;
}

export interface IncomeSummary {
  year: number;
  incomeCents: number;
  goalCents: number | null;
  projectedCents: number | null;
  monthly: { month: string; incomeCents: number }[];
  byClient: { clientId: number | null; name: string; incomeCents: number }[];
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  expectedNext30Cents: number;
  upcomingRetainers: ExpectedPayment[];
}

export interface SubscriptionSeries {
  seriesKey: string;
  merchantKey: string;
  merchant: string;
  direction: 'out' | 'in';
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
  amountCents: number;
  lastAmountCents: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  monthlyCents: number;
  yearlyCents: number;
  kind: 'subscription' | 'bill';
  status: 'active' | 'overdue' | 'stopped';
  priceChange: { fromCents: number; toCents: number; date: string } | null;
  classification: 'business' | 'personal' | 'mixed' | 'undecided';
  categoryId: number | null;
  transactionIds: number[];
  pref: 'keep' | 'replace' | 'cancelled' | 'ignore' | null;
  note: string | null;
  idea: { approach: string; effort: string; idea: string };
}

export interface SubscriptionsResponse {
  series: SubscriptionSeries[];
  recurringIncome: SubscriptionSeries[];
  totals: {
    monthlyCents: number;
    yearlyCents: number;
    businessYearlyCents: number;
    personalYearlyCents: number;
    replaceYearlyCents: number;
    cancelledYearlyCents: number;
    priceIncreases: number;
  };
}

export interface CashFlowResponse {
  today: string;
  days: number;
  balances: { id: number; name: string; type: AccountType; balanceCents: number | null; balanceDate: string | null; currentCents: number | null }[];
  cashCents: number;
  cardCents: number;
  weeklyTypicalCents: number;
  warnings: string[];
  startCents: number;
  endCents: number;
  lowest: { date: string; balanceCents: number };
  weeks: { weekStart: string; inCents: number; outCents: number; balanceCents: number }[];
  events: { date: string; amountCents: number; label: string; kind: string; balanceAfterCents: number }[];
}

export interface BudgetRow {
  id: number;
  scope: 'category' | 'business_total' | 'personal_total';
  categoryId: number | null;
  name: string;
  spentCents: number;
  budgetCents: number;
  pct: number;
  projectedCents: number;
  status: 'ok' | 'warning' | 'over';
}

export interface BudgetsResponse {
  month: string;
  budgets: BudgetRow[];
  typical: { categoryId: number; name: string; avgMonthlyCents: number }[];
  unreviewed: number;
  businessTotalCents: number;
  personalTotalCents: number;
}

export interface Receipt {
  id: number;
  fileName: string;
  mime: string | null;
  sizeBytes: number | null;
  source: 'upload' | 'email' | 'folder';
  emailFrom: string | null;
  emailSubject: string | null;
  merchant: string | null;
  receiptDate: string | null;
  totalCents: number | null;
  transactionId: number | null;
  matchStatus: 'unmatched' | 'suggested' | 'matched' | 'ignored';
  matchScore: number | null;
  hasText: boolean;
  createdAt: string;
  transaction?: Transaction | null;
}

export interface ReceiptDetail extends Receipt {
  text: string | null;
  candidates: { transactionId: number; score: number; reasons: string[]; transaction?: Transaction }[];
}

/** Read browser File objects as base64 for upload. */
export async function filesToPayload(files: File[]): Promise<{ fileName: string; contentBase64: string }[]> {
  return Promise.all(
    files.map(
      (f) =>
        new Promise<{ fileName: string; contentBase64: string }>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve({ fileName: f.name, contentBase64: String(r.result).split(',')[1] ?? '' });
          r.onerror = () => reject(r.error);
          r.readAsDataURL(f);
        }),
    ),
  );
}

export type { TaxLineInfo };
