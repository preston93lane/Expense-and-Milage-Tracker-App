import { addDays, daysBetween } from './dates';
import type { Frequency } from './income';

/**
 * Find subscriptions and recurring bills (or recurring income) in transactions:
 * same merchant, a regular interval, and a similar amount.
 */
export interface RecurringInput {
  id: number;
  date: string;
  amountCents: number;
  merchantKey: string;
  merchant: string;
  classification: 'business' | 'personal' | 'transfer' | null;
  categoryId: number | null;
}

export interface RecurringSeries {
  seriesKey: string;
  merchantKey: string;
  merchant: string;
  direction: 'out' | 'in';
  frequency: Frequency;
  periodDays: number;
  /** Positive amount, average of recent charges. */
  amountCents: number;
  lastAmountCents: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  monthlyCents: number;
  yearlyCents: number;
  /** subscription = steady amount; bill = varies (utilities, phone with overages). */
  kind: 'subscription' | 'bill';
  status: 'active' | 'overdue' | 'stopped';
  priceChange: { fromCents: number; toCents: number; date: string } | null;
  classification: 'business' | 'personal' | 'mixed' | 'undecided';
  categoryId: number | null;
  transactionIds: number[];
  confidence: number;
}

const PERIODS: { frequency: Frequency; days: number; min: number; max: number; minCount: number }[] = [
  { frequency: 'weekly', days: 7, min: 5, max: 9, minCount: 4 },
  { frequency: 'biweekly', days: 14, min: 12, max: 17, minCount: 3 },
  { frequency: 'monthly', days: 30.44, min: 26, max: 35, minCount: 2 },
  { frequency: 'quarterly', days: 91.3, min: 80, max: 100, minCount: 2 },
  { frequency: 'yearly', days: 365.25, min: 340, max: 390, minCount: 2 },
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Group amounts that are within 10% of each other (separate Apple $2.99 from Apple $10.99). */
function amountClusters<T extends { amountCents: number }>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => Math.abs(a.amountCents) - Math.abs(b.amountCents));
  const clusters: T[][] = [];
  for (const it of sorted) {
    const last = clusters[clusters.length - 1];
    const ref = last ? Math.abs(last[last.length - 1].amountCents) : 0;
    if (last && Math.abs(Math.abs(it.amountCents) - ref) <= Math.max(100, ref * 0.1)) last.push(it);
    else clusters.push([it]);
  }
  return clusters;
}

function nextDue(last: string, freq: Frequency, periodDays: number): string {
  if (freq === 'monthly' || freq === 'quarterly' || freq === 'yearly') {
    const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12;
    const [y, m, d] = last.split('-').map(Number);
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
  }
  return addDays(last, Math.round(periodDays));
}

/** Longest run of charges whose consecutive gaps all fit the period (skips one-off extras). */
function longestChain(sorted: RecurringInput[], min: number, max: number): RecurringInput[] {
  const n = sorted.length;
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const g = daysBetween(sorted[j].date, sorted[i].date);
      if (g >= min && g <= max && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i++) if (len[i] >= len[end]) end = i;
  const chain: RecurringInput[] = [];
  for (let k = end; k !== -1; k = prev[k]) chain.unshift(sorted[k]);
  return chain;
}

function analyse(items: RecurringInput[], today: string, allowVarying: boolean): Omit<RecurringSeries, 'seriesKey'> | null {
  if (items.length < 2) return null;
  let sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
  if (gaps.some((g) => g === 0)) {
    // Several charges on the same day — not a simple subscription pattern.
    if (gaps.filter((g) => g === 0).length > gaps.length / 3) return null;
  }
  const med = median(gaps.filter((g) => g > 0));
  const period = PERIODS.find((p) => med >= p.min && med <= p.max);
  if (!period || sorted.length < period.minCount) return null;
  let regular = gaps.filter((g) => g >= period.min && g <= period.max).length / gaps.length;
  if (regular < 0.7) {
    // An extra one-off charge from the same merchant can break the rhythm; use the regular chain.
    const chain = longestChain(sorted, period.min, period.max);
    if (chain.length < Math.max(period.minCount, 3) || chain.length < sorted.length * 0.6) return null;
    sorted = chain;
    regular = 1;
  }

  const amounts = sorted.map((s) => Math.abs(s.amountCents));
  const minA = Math.min(...amounts);
  const maxA = Math.max(...amounts);
  // Steady = same price every time, or one price change (an increase) and then steady again.
  let changes = 0;
  for (let i = 1; i < amounts.length; i++) if (Math.abs(amounts[i] - amounts[i - 1]) > Math.max(50, amounts[i - 1] * 0.02)) changes++;
  const steady = maxA <= minA * 1.06 + 50 || (changes === 1 && amounts.length >= 3 && maxA <= minA * 1.3);
  // Two-occurrence monthly series must be the same amount (otherwise too easy to mistake).
  if (sorted.length === 2 && !steady) return null;
  if (!steady && (!allowVarying || maxA > minA * 2.5)) return null;

  const recent = amounts.slice(-3);
  // Subscriptions: the current price. Bills: the recent average.
  const amountCents = steady ? amounts[amounts.length - 1] : Math.round(recent.reduce((s, a) => s + a, 0) / recent.length);
  const last = sorted[sorted.length - 1];
  const nextDate = nextDue(last.date, period.frequency, period.days);
  const late = daysBetween(nextDate, today);
  const status: RecurringSeries['status'] = late > Math.max(10, period.days * 0.5) + period.days ? 'stopped' : late > Math.max(5, period.days * 0.25) ? 'overdue' : 'active';

  let priceChange: RecurringSeries['priceChange'] = null;
  for (let i = sorted.length - 1; i > 0; i--) {
    const a = Math.abs(sorted[i - 1].amountCents);
    const b = Math.abs(sorted[i].amountCents);
    if (Math.abs(b - a) > Math.max(50, a * 0.02)) {
      priceChange = { fromCents: a, toCents: b, date: sorted[i].date };
      break;
    }
  }

  const classes = new Set(sorted.map((s) => s.classification).filter((c) => c && c !== 'transfer'));
  const classification: RecurringSeries['classification'] =
    classes.size === 0 ? 'undecided' : classes.size > 1 ? 'mixed' : ([...classes][0] as 'business' | 'personal');
  const catCounts = new Map<number, number>();
  for (const s of sorted) if (s.categoryId) catCounts.set(s.categoryId, (catCounts.get(s.categoryId) ?? 0) + 1);
  const categoryId = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const monthlyCents = Math.round((amountCents * 30.44) / period.days);
  return {
    merchantKey: last.merchantKey,
    merchant: last.merchant,
    direction: last.amountCents < 0 ? 'out' : 'in',
    frequency: period.frequency,
    periodDays: period.days,
    amountCents,
    lastAmountCents: Math.abs(last.amountCents),
    firstDate: sorted[0].date,
    lastDate: last.date,
    nextDate,
    occurrences: sorted.length,
    monthlyCents,
    yearlyCents: Math.round((amountCents * 365.25) / period.days),
    kind: steady ? 'subscription' : 'bill',
    status,
    priceChange,
    classification,
    categoryId,
    transactionIds: sorted.map((s) => s.id),
    confidence: Math.min(1, Math.round((regular * (sorted.length >= 3 ? 1 : 0.7) * (steady ? 1 : 0.8)) * 100) / 100),
  };
}

export function detectRecurring(txns: RecurringInput[], today: string): RecurringSeries[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const t of txns) {
    if (t.classification === 'transfer' || t.amountCents === 0) continue;
    const key = `${t.merchantKey}|${t.amountCents < 0 ? 'out' : 'in'}`;
    const g = groups.get(key) ?? [];
    g.push(t);
    groups.set(key, g);
  }
  const out: RecurringSeries[] = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const found: Omit<RecurringSeries, 'seriesKey'>[] = [];
    const clusters = amountClusters(items);
    for (const c of clusters) {
      const s = analyse(c, today, false);
      if (s) found.push(s);
    }
    if (found.length === 0) {
      // Bills that vary month to month (utilities, phone).
      const s = analyse(items, today, true);
      if (s) found.push(s);
    }
    for (const s of found) {
      const key =
        found.length > 1
          ? `${s.merchantKey}|${s.direction}|${s.frequency}|${Math.round(s.amountCents / 100)}`
          : `${s.merchantKey}|${s.direction}|${s.frequency}`;
      out.push({ ...s, seriesKey: key });
    }
  }
  return out.sort((a, b) => b.yearlyCents - a.yearlyCents);
}
