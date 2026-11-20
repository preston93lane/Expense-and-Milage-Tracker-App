import { describe, expect, it } from 'vitest';
import { budgetStatus, forecast, projectSeries } from './cashflow';
import { detectRecurring, type RecurringInput } from './recurring';
import { replacementIdea } from './replacements';

let id = 1;
const tx = (date: string, merchantKey: string, amountCents: number, extra: Partial<RecurringInput> = {}): RecurringInput => ({
  id: id++,
  date,
  amountCents,
  merchantKey,
  merchant: merchantKey,
  classification: null,
  categoryId: null,
  ...extra,
});

const TODAY = '2026-11-20';

const data: RecurringInput[] = [
  // Adobe monthly, price went up in September
  ...['2026-06-22', '2026-07-22', '2026-08-22'].map((d) => tx(d, 'ADOBE', -5499, { classification: 'business', categoryId: 30 })),
  ...['2026-09-22', '2026-10-22'].map((d) => tx(d, 'ADOBE', -5999, { classification: 'business', categoryId: 30 })),
  // Two Apple subscriptions on the same merchant
  ...['2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03'].map((d) => tx(d, 'APPLE.COM', -299)),
  ...['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15'].map((d) => tx(d, 'APPLE.COM', -1099)),
  // Phone bill that varies
  tx('2026-07-05', 'VERIZON', -8500),
  tx('2026-08-05', 'VERIZON', -9120),
  tx('2026-09-05', 'VERIZON', -8750),
  tx('2026-10-05', 'VERIZON', -10400),
  // Yearly domain
  tx('2025-03-10', 'NAMECHEAP', -1598),
  tx('2026-03-10', 'NAMECHEAP', -1698),
  // Cancelled gym (stopped in July)
  ...['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((d) => tx(d, 'PLANET FITNESS', -2500, { classification: 'personal' })),
  // Coffee: frequent but irregular amounts — NOT a subscription
  tx('2026-10-01', 'STARBUCKS', -545),
  tx('2026-10-03', 'STARBUCKS', -1210),
  tx('2026-10-09', 'STARBUCKS', -645),
  tx('2026-10-21', 'STARBUCKS', -380),
  // Monthly retainer income
  ...['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((d) => tx(d, 'ACME CORP', 150000)),
  // Card payment (transfer) ignored
  ...['2026-08-07', '2026-09-07', '2026-10-07'].map((d) => tx(d, 'CAPITAL ONE AUTOPAY', 81240, { classification: 'transfer' })),
];

describe('detectRecurring', () => {
  const found = detectRecurring(data, TODAY);
  const by = (k: string) => found.filter((s) => s.merchantKey === k);

  it('finds monthly subscriptions and reports the price increase', () => {
    const adobe = by('ADOBE')[0];
    expect(adobe).toMatchObject({ frequency: 'monthly', kind: 'subscription', status: 'active', nextDate: '2026-11-22', classification: 'business', categoryId: 30 });
    expect(adobe.priceChange).toEqual({ fromCents: 5499, toCents: 5999, date: '2026-09-22' });
    expect(adobe.lastAmountCents).toBe(5999);
  });

  it('separates two subscriptions from the same merchant by amount', () => {
    expect(by('APPLE.COM').map((s) => s.amountCents).sort((a, b) => a - b)).toEqual([299, 1099]);
    expect(new Set(by('APPLE.COM').map((s) => s.seriesKey)).size).toBe(2);
  });

  it('recognises varying bills, yearly charges, stopped subscriptions and recurring income', () => {
    expect(by('VERIZON')[0]).toMatchObject({ kind: 'bill', frequency: 'monthly', status: 'overdue' });
    expect(by('NAMECHEAP')[0]).toMatchObject({ frequency: 'yearly', nextDate: '2027-03-10', yearlyCents: 1698 });
    expect(by('PLANET FITNESS')[0].status).toBe('stopped');
    expect(by('ACME CORP')[0]).toMatchObject({ direction: 'in', amountCents: 150000 });
  });

  it('ignores a one-off extra charge from a subscription merchant', () => {
    const extra = [
      ...['2026-07-18', '2026-08-17', '2026-09-16', '2026-10-16', '2026-11-15'].map((d) => tx(d, 'ADOBE STOCK', -5999)),
      tx('2026-10-22', 'ADOBE STOCK', -5999),
    ];
    const s = detectRecurring(extra, TODAY);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ frequency: 'monthly', occurrences: 5, nextDate: '2026-12-15' });
  });

  it('ignores irregular spending and transfers', () => {
    expect(by('STARBUCKS')).toHaveLength(0);
    expect(by('CAPITAL ONE AUTOPAY')).toHaveLength(0);
  });

  it('projects future charges for the cash-flow forecast', () => {
    const events = projectSeries(found, TODAY, '2026-12-31');
    const adobe = events.filter((e) => e.label === 'ADOBE');
    expect(adobe.map((e) => e.date)).toEqual(['2026-11-22', '2026-12-22']);
    expect(events.some((e) => e.label === 'PLANET FITNESS')).toBe(false);
  });
});

describe('forecast', () => {
  it('walks the balance forward and finds the lowest point', () => {
    const f = forecast(
      300000,
      TODAY,
      30,
      [
        { date: '2026-11-25', amountCents: -250000, label: 'Rent', kind: 'bill' },
        { date: '2026-12-01', amountCents: 150000, label: 'Acme', kind: 'retainer' },
        { date: '2027-02-01', amountCents: -99999, label: 'Outside window', kind: 'planned' },
      ],
      10000,
    );
    expect(f.lowest).toEqual({ date: '2026-11-26', balanceCents: 40000 });
    expect(f.endCents).toBe(300000 - 250000 + 150000 - 4 * 10000);
    expect(f.weeks[0]).toMatchObject({ outCents: 260000, balanceCents: 40000 });
  });
});

describe('budgets', () => {
  it('warns on pace and flags overspending', () => {
    expect(budgetStatus(50000, 15000, '2026-11-10').status).toBe('ok');
    expect(budgetStatus(50000, 30000, '2026-11-10')).toMatchObject({ status: 'warning', projectedCents: 90000 });
    expect(budgetStatus(50000, 51000, '2026-11-25').status).toBe('over');
  });
});

describe('replacement ideas', () => {
  it('knows common tools', () => {
    expect(replacementIdea('INTUIT').approach).toBe('already_replaced');
    expect(replacementIdea('CALENDLY').approach).toBe('agent_workflow');
    expect(replacementIdea('SQUARESPACE').approach).toBe('self_built_app');
    expect(replacementIdea('NETFLIX').approach).toBe('personal');
    expect(replacementIdea('ZZZ UNKNOWN SAAS').idea).toMatch(/agent workflow/);
  });
});
