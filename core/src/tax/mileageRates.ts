/**
 * IRS standard mileage rates for business use, with effective date ranges.
 * Rates can change mid-year (as reportedly happened in July 2026), so every
 * drive is valued with the rate in effect on its own date.
 *
 * Sources:
 *  - 2024: IR-2023-239 (67¢)
 *  - 2025: IR-2024-312 (70¢)
 *  - 2026 Jan–Jun: IR-2025-128 (72.5¢)
 *  - 2026 Jul–Dec: Announcement 2026-11 as reported by trade press (76¢).
 *    VERIFY on irs.gov before filing; editable in Settings → Mileage rates.
 */
export interface MileageRate {
  effectiveFrom: string; // inclusive ISO date
  effectiveTo: string; // inclusive ISO date
  centsPerMile: number; // may be fractional, e.g. 72.5
  kind: 'business' | 'medical' | 'charity';
  note?: string;
}

export const DEFAULT_MILEAGE_RATES: MileageRate[] = [
  { effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31', centsPerMile: 67, kind: 'business', note: 'IR-2023-239' },
  { effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', centsPerMile: 70, kind: 'business', note: 'IR-2024-312' },
  { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', centsPerMile: 72.5, kind: 'business', note: 'IR-2025-128' },
  {
    effectiveFrom: '2026-07-01',
    effectiveTo: '2026-12-31',
    centsPerMile: 76,
    kind: 'business',
    note: 'Announcement 2026-11 (reported mid-year increase) — verify on irs.gov',
  },
];

export function rateForDate(rates: MileageRate[], isoDate: string, kind: MileageRate['kind'] = 'business'): MileageRate | null {
  return rates.find((r) => r.kind === kind && isoDate >= r.effectiveFrom && isoDate <= r.effectiveTo) ?? null;
}

/** Deduction in cents for a number of miles on a date (rounded to the cent). */
export function mileageDeductionCents(rates: MileageRate[], isoDate: string, miles: number): number | null {
  const r = rateForDate(rates, isoDate);
  if (!r) return null;
  return Math.round(miles * r.centsPerMile);
}
