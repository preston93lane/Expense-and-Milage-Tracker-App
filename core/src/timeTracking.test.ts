import { describe, expect, it } from 'vitest';
import { allocation, averageRateForYear, formatMinutes, minutesBetween, perHourCents, profitability, timeValueCents, vehicleComparison } from './timeTracking';

describe('time math', () => {
  it('measures and formats durations', () => {
    expect(minutesBetween('2026-11-20T09:00:00.000Z', '2026-11-20T11:30:20.000Z')).toBe(150);
    expect(minutesBetween('2026-11-20T11:00:00Z', '2026-11-20T09:00:00Z')).toBe(0);
    expect(formatMinutes(150)).toBe('2h 30m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(timeValueCents(90, 10_000)).toBe(15_000);
    expect(perHourCents(30_000, 0)).toBeNull();
  });

  it('ranks clients by what they really pay per hour', () => {
    const rows = profitability(
      [
        { key: 'a', name: 'Big Co', incomeCents: 1_000_000, directCostCents: 400_000, minutes: 100 * 60, billableMinutes: 6000, unbilledValueCents: 0 },
        { key: 'b', name: 'Small Co', incomeCents: 300_000, directCostCents: 20_000, minutes: 20 * 60, billableMinutes: 1200, unbilledValueCents: 0 },
        { key: 'c', name: 'Near', incomeCents: 95_000, directCostCents: 0, minutes: 10 * 60, billableMinutes: 600, unbilledValueCents: 0 },
        { key: 'd', name: 'No time', incomeCents: 50_000, directCostCents: 0, minutes: 0, billableMinutes: 0, unbilledValueCents: 0 },
      ],
      10_000,
    );
    expect(rows.map((r) => [r.name, r.effectiveHourlyCents, r.verdict])).toEqual([
      ['Small Co', 14_000, 'above_target'],
      ['Near', 9_500, 'near_target'],
      ['Big Co', 6_000, 'below_target'],
      ['No time', null, 'no_time'],
    ]);
  });

  it('splits hours into shares', () => {
    const a = allocation(
      [
        { minutes: 300, k: 'client_work' },
        { minutes: 60, k: 'admin' },
        { minutes: 240, k: 'client_work' },
      ],
      (e) => e.k,
    );
    expect(a).toEqual([
      { key: 'client_work', minutes: 540, pct: 90 },
      { key: 'admin', minutes: 60, pct: 10 },
    ]);
  });
});

describe('car: standard rate vs actual costs', () => {
  const base = { insuranceCents: 120_000, registrationCents: 15_000, loanInterestCents: 0, leaseCents: 0, depreciationCents: 300_000, otherCents: 0, firstYearMethod: 'standard' as const };
  it('picks the bigger deduction and explains the switching rule', () => {
    const c = vehicleComparison({ ...base, businessMiles: 8_000, totalMiles: 16_000, standardDeductionCents: 580_000, operatingCents: 265_000 });
    expect(c.businessPct).toBe(50);
    expect(c.actualDeductionCents).toBe(350_000);
    expect(c.better).toBe('standard');
    expect(c.differenceCents).toBe(230_000);
    expect(c.notes.join(' ')).toMatch(/may switch/);
    const hi = vehicleComparison({ ...base, businessMiles: 3_000, totalMiles: 3_200, standardDeductionCents: 217_500, operatingCents: 200_000 });
    expect(hi.better).toBe('actual');
  });

  it('needs miles to compare', () => {
    expect(vehicleComparison({ ...base, businessMiles: 0, totalMiles: 0, standardDeductionCents: 0, operatingCents: 0 }).better).toBe('unknown');
  });

  it('weights a mid-year rate change by days', () => {
    const r = averageRateForYear(2026, [
      { from: '2026-01-01', to: '2026-06-30', centsPerMile: 72.5 },
      { from: '2026-07-01', to: '2026-12-31', centsPerMile: 76 },
    ]);
    expect(r).toBeCloseTo((72.5 * 181 + 76 * 184) / 365, 5);
  });
});
