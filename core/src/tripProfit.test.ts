import { describe, expect, it } from 'vitest';
import { tripProfit } from './tripProfit';

const base = { startDate: '2026-10-12', endDate: '2026-10-16', receivedCents: 0, invoicedOpenCents: 0, agreedFeeCents: null, expenseCents: 150_000 };

describe('tripProfit', () => {
  it('uses received money first and reports per-day numbers', () => {
    const p = tripProfit({ ...base, receivedCents: 400_000 });
    expect(p).toMatchObject({ days: 5, incomeCents: 400_000, incomeSource: 'received', profitCents: 250_000, marginPct: 62.5, costPerDayCents: 30_000, profitPerDayCents: 50_000, verdict: 'profitable', incomeIsEstimate: false });
  });

  it('adds unpaid invoice balances (still owed) and flags them as not yet received', () => {
    const p = tripProfit({ ...base, receivedCents: 100_000, invoicedOpenCents: 100_000 });
    expect(p).toMatchObject({ incomeCents: 200_000, incomeSource: 'received+invoiced', incomeIsEstimate: true });
  });

  it('falls back to the agreed fee as an estimate', () => {
    const p = tripProfit({ ...base, agreedFeeCents: 120_000 });
    expect(p).toMatchObject({ incomeCents: 120_000, incomeSource: 'agreed_fee', incomeIsEstimate: true, verdict: 'lost_money' });
  });

  it('includes mileage in costs and handles no income', () => {
    const p = tripProfit({ ...base, mileageCents: 10_000 });
    expect(p).toMatchObject({ costCents: 160_000, verdict: 'no_income', marginPct: null });
  });

  it('calls near-zero profit break-even', () => {
    expect(tripProfit({ ...base, receivedCents: 151_000 }).verdict).toBe('break_even');
  });
});
