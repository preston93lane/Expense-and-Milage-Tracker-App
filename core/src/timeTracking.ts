/**
 * Time tracking & resource allocation: where your hours go, what each client
 * really pays you per hour once costs are counted, and whether your car is
 * cheaper to deduct with the standard mileage rate or actual costs.
 */

export type Activity = 'client_work' | 'travel' | 'editing' | 'admin' | 'sales_marketing' | 'learning' | 'other';

export const ACTIVITY_LABEL: Record<Activity, string> = {
  client_work: 'Client work',
  travel: 'Travel',
  editing: 'Editing / delivery',
  admin: 'Admin & bookkeeping',
  sales_marketing: 'Sales & marketing',
  learning: 'Learning',
  other: 'Other',
};

export const ACTIVITIES = Object.keys(ACTIVITY_LABEL) as Activity[];

/** Whole minutes between two ISO timestamps (never negative). */
export function minutesBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : 0;
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Value of billable time at an hourly rate, rounded to the cent. */
export function timeValueCents(minutes: number, rateCents: number | null | undefined): number {
  return rateCents ? Math.round((minutes * rateCents) / 60) : 0;
}

/** Money per hour, or null when there's no time to divide by. */
export function perHourCents(cents: number, minutes: number): number | null {
  return minutes > 0 ? Math.round((cents * 60) / minutes) : null;
}

export interface ProfitInput {
  key: string;
  name: string;
  incomeCents: number;
  directCostCents: number;
  minutes: number;
  billableMinutes: number;
  unbilledValueCents: number;
}

export interface ProfitRow extends ProfitInput {
  profitCents: number;
  effectiveHourlyCents: number | null;
  verdict: 'no_time' | 'above_target' | 'near_target' | 'below_target' | 'no_target';
}

/**
 * Effective hourly rate = (income − direct costs) ÷ hours you put in.
 * Compared with your target: within 10% counts as "near".
 */
export function profitability(rows: ProfitInput[], targetHourlyCents: number | null): ProfitRow[] {
  return rows
    .map((r) => {
      const profit = r.incomeCents - r.directCostCents;
      const eff = perHourCents(profit, r.minutes);
      let verdict: ProfitRow['verdict'] = 'no_target';
      if (eff === null) verdict = 'no_time';
      else if (targetHourlyCents) verdict = eff >= targetHourlyCents ? 'above_target' : eff >= targetHourlyCents * 0.9 ? 'near_target' : 'below_target';
      return { ...r, profitCents: profit, effectiveHourlyCents: eff, verdict };
    })
    .sort((a, b) => (b.effectiveHourlyCents ?? -Infinity) - (a.effectiveHourlyCents ?? -Infinity) || b.profitCents - a.profitCents);
}

/** Share of hours per group (largest first). */
export function allocation<T extends { minutes: number }>(entries: T[], keyOf: (e: T) => string): { key: string; minutes: number; pct: number }[] {
  const by = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    by.set(keyOf(e), (by.get(keyOf(e)) ?? 0) + e.minutes);
    total += e.minutes;
  }
  return [...by.entries()]
    .map(([key, minutes]) => ({ key, minutes, pct: total ? Math.round((minutes / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.minutes - a.minutes);
}

// ---------------------------------------------------------------------------
// Car: standard mileage rate vs actual expenses
// ---------------------------------------------------------------------------

export interface VehicleInput {
  businessMiles: number;
  totalMiles: number;
  /** Business miles × the IRS rate(s) for the year. */
  standardDeductionCents: number;
  /** Gas, oil, repairs, tires, washes… from your transactions (full amounts, before business %). */
  operatingCents: number;
  insuranceCents: number;
  registrationCents: number;
  loanInterestCents: number;
  leaseCents: number;
  depreciationCents: number;
  otherCents: number;
  /** Which method you used the first year this car was used for business. */
  firstYearMethod: 'standard' | 'actual' | null;
}

export interface VehicleComparison {
  businessPct: number;
  actualTotalCents: number;
  actualDeductionCents: number;
  standardDeductionCents: number;
  better: 'standard' | 'actual' | 'same' | 'unknown';
  differenceCents: number;
  notes: string[];
}

export function vehicleComparison(v: VehicleInput): VehicleComparison {
  const notes: string[] = [];
  const businessPct = v.totalMiles > 0 ? Math.min(100, Math.round((v.businessMiles / v.totalMiles) * 1000) / 10) : 0;
  const actualTotal = v.operatingCents + v.insuranceCents + v.registrationCents + v.loanInterestCents + v.leaseCents + v.depreciationCents + v.otherCents;
  const actualDeduction = Math.round((actualTotal * businessPct) / 100);
  if (!v.totalMiles || !v.businessMiles) notes.push('Enter total and business miles for the year to compare.');
  let better: VehicleComparison['better'] = 'unknown';
  if (v.totalMiles && v.businessMiles) {
    better = actualDeduction > v.standardDeductionCents ? 'actual' : actualDeduction < v.standardDeductionCents ? 'standard' : 'same';
  }
  if (v.firstYearMethod === 'actual') {
    notes.push('You used actual expenses the first year, so this car has to stay on actual expenses.');
  } else if (v.firstYearMethod === 'standard') {
    notes.push('You started this car on the standard rate, so you may switch to actual expenses (with straight-line depreciation) in a later year.');
  } else {
    notes.push('Your first business year with a car decides your options: start with the standard rate to keep the freedom to switch later.');
  }
  if (v.leaseCents > 0) notes.push('Leased car: if you pick the standard rate, you must keep it for the whole lease.');
  notes.push('Parking and tolls are deductible under both methods, so they’re left out of this comparison.');
  return {
    businessPct,
    actualTotalCents: actualTotal,
    actualDeductionCents: actualDeduction,
    standardDeductionCents: v.standardDeductionCents,
    better,
    differenceCents: Math.abs(actualDeduction - v.standardDeductionCents),
    notes,
  };
}

/** Average business rate for a year, weighted by how many days each rate applied (for manual mile totals). */
export function averageRateForYear(year: number, rates: { from: string; to: string; centsPerMile: number }[]): number {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, 11, 31);
  let weighted = 0;
  let days = 0;
  for (const r of rates) {
    const a = Math.max(start, Date.parse(`${r.from}T00:00:00Z`));
    const b = Math.min(end, Date.parse(`${r.to}T00:00:00Z`));
    if (b < a) continue;
    const d = (b - a) / 86_400_000 + 1;
    weighted += r.centsPerMile * d;
    days += d;
  }
  return days ? weighted / days : 0;
}
