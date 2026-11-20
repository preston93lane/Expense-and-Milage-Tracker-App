import { addDays, daysBetween } from './dates';
import type { RecurringSeries } from './recurring';

/**
 * Cash-flow forecast: start from today's cash and walk forward through known
 * money in (retainers, invoices due, recurring income) and money out
 * (subscriptions, bills, estimated taxes, planned purchases, typical spending).
 */
export type CashEventKind =
  | 'subscription'
  | 'bill'
  | 'recurring_income'
  | 'retainer'
  | 'invoice'
  | 'tax'
  | 'planned'
  | 'typical_spending';

export interface CashEvent {
  date: string;
  /** Signed: negative = money out. */
  amountCents: number;
  label: string;
  kind: CashEventKind;
}

function stepDate(d: string, s: Pick<RecurringSeries, 'frequency' | 'periodDays'>): string {
  if (s.frequency === 'monthly' || s.frequency === 'quarterly' || s.frequency === 'yearly') {
    const months = s.frequency === 'monthly' ? 1 : s.frequency === 'quarterly' ? 3 : 12;
    const [y, m, day] = d.split('-').map(Number);
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
  }
  return addDays(d, Math.round(s.periodDays));
}

/** Future occurrences of recurring series between from and to (skips stopped ones). */
export function projectSeries(series: RecurringSeries[], from: string, to: string): CashEvent[] {
  const out: CashEvent[] = [];
  for (const s of series) {
    if (s.status === 'stopped') continue;
    let d = s.nextDate;
    // An overdue charge is assumed to land soon.
    if (d < from) d = from;
    for (let i = 0; i < 400 && d <= to; i++) {
      out.push({
        date: d,
        amountCents: s.direction === 'out' ? -s.amountCents : s.amountCents,
        label: s.merchant,
        kind: s.direction === 'in' ? 'recurring_income' : s.kind === 'bill' ? 'bill' : 'subscription',
      });
      d = stepDate(d, s);
    }
  }
  return out;
}

export interface ForecastWeek {
  weekStart: string;
  inCents: number;
  outCents: number;
  balanceCents: number;
}

export interface Forecast {
  startCents: number;
  endCents: number;
  lowest: { date: string; balanceCents: number };
  weeks: ForecastWeek[];
  events: (CashEvent & { balanceAfterCents: number })[];
}

export function forecast(startCents: number, today: string, horizonDays: number, events: CashEvent[], weeklyTypicalSpendCents = 0): Forecast {
  const end = addDays(today, horizonDays);
  const all: CashEvent[] = events.filter((e) => e.date >= today && e.date <= end);
  if (weeklyTypicalSpendCents > 0) {
    for (let d = addDays(today, 6); d <= end; d = addDays(d, 7)) {
      all.push({ date: d, amountCents: -weeklyTypicalSpendCents, label: 'Typical everyday spending', kind: 'typical_spending' });
    }
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);

  let bal = startCents;
  let lowest = { date: today, balanceCents: startCents };
  const withBal = all.map((e) => {
    bal += e.amountCents;
    if (bal < lowest.balanceCents) lowest = { date: e.date, balanceCents: bal };
    return { ...e, balanceAfterCents: bal };
  });

  const weeks: ForecastWeek[] = [];
  let running = startCents;
  for (let w = 0; w * 7 <= horizonDays; w++) {
    const ws = addDays(today, w * 7);
    const we = addDays(ws, 6);
    const inWeek = all.filter((e) => e.date >= ws && e.date <= we);
    const inCents = inWeek.filter((e) => e.amountCents > 0).reduce((s, e) => s + e.amountCents, 0);
    const outCents = inWeek.filter((e) => e.amountCents < 0).reduce((s, e) => s - e.amountCents, 0);
    running += inCents - outCents;
    weeks.push({ weekStart: ws, inCents, outCents, balanceCents: running });
  }
  return { startCents, endCents: bal, lowest, weeks, events: withBal };
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------
export interface BudgetStatus {
  spentCents: number;
  budgetCents: number;
  pct: number;
  /** Spending pace projected to month end. */
  projectedCents: number;
  status: 'ok' | 'warning' | 'over';
}

export function budgetStatus(budgetCents: number, spentCents: number, today: string): BudgetStatus {
  const [y, m, d] = today.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const projectedCents = d > 0 ? Math.round((spentCents / d) * dim) : spentCents;
  const pct = budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : 0;
  const status: BudgetStatus['status'] = spentCents > budgetCents ? 'over' : pct >= 80 || projectedCents > budgetCents * 1.1 ? 'warning' : 'ok';
  return { spentCents, budgetCents, pct, projectedCents, status };
}

/** Weekly average of everyday (non-recurring, non-transfer) spending over a lookback window. */
export function weeklyAverageSpend(outflowsCents: number[], lookbackDays: number): number {
  const total = outflowsCents.reduce((s, c) => s + Math.abs(c), 0);
  return Math.round((total / Math.max(1, lookbackDays)) * 7);
}

export function daysUntil(today: string, date: string): number {
  return daysBetween(today, date);
}
