import { daysBetween } from './dates';

/**
 * Was a trip worth it? Income is what the trip earned:
 *   - deposits tagged to the trip (money actually received), plus
 *   - unpaid balances of invoices billed for the trip, or
 *   - if neither exists yet, the fee you agreed (marked as an estimate).
 * Costs are the business expenses on the trip plus the mileage deduction value
 * of drives linked to it (once mileage tracking exists).
 */
export interface TripMoney {
  startDate: string;
  endDate: string;
  receivedCents: number;
  invoicedOpenCents: number;
  agreedFeeCents: number | null;
  expenseCents: number;
  mileageCents?: number;
}

export interface TripProfit {
  days: number;
  incomeCents: number;
  incomeIsEstimate: boolean;
  incomeSource: 'received' | 'received+invoiced' | 'invoiced' | 'agreed_fee' | 'none';
  costCents: number;
  profitCents: number;
  /** Profit as a share of income (null when there is no income). */
  marginPct: number | null;
  costPerDayCents: number;
  profitPerDayCents: number;
  verdict: 'profitable' | 'break_even' | 'lost_money' | 'no_income';
}

export function tripProfit(m: TripMoney): TripProfit {
  const days = Math.max(1, daysBetween(m.startDate, m.endDate) + 1);
  let incomeCents = m.receivedCents + m.invoicedOpenCents;
  let incomeSource: TripProfit['incomeSource'] =
    m.receivedCents && m.invoicedOpenCents ? 'received+invoiced' : m.receivedCents ? 'received' : m.invoicedOpenCents ? 'invoiced' : 'none';
  let incomeIsEstimate = m.invoicedOpenCents > 0;
  if (incomeCents === 0 && m.agreedFeeCents) {
    incomeCents = m.agreedFeeCents;
    incomeSource = 'agreed_fee';
    incomeIsEstimate = true;
  }
  const costCents = m.expenseCents + (m.mileageCents ?? 0);
  const profitCents = incomeCents - costCents;
  const marginPct = incomeCents > 0 ? Math.round((profitCents / incomeCents) * 1000) / 10 : null;
  const verdict: TripProfit['verdict'] =
    incomeCents === 0 ? 'no_income' : Math.abs(profitCents) < Math.max(1000, incomeCents * 0.02) ? 'break_even' : profitCents > 0 ? 'profitable' : 'lost_money';
  return {
    days,
    incomeCents,
    incomeIsEstimate,
    incomeSource,
    costCents,
    profitCents,
    marginPct,
    costPerDayCents: Math.round(costCents / days),
    profitPerDayCents: Math.round(profitCents / days),
    verdict,
  };
}
