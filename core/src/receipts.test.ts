import { describe, expect, it } from 'vitest';
import { confidentMatch, htmlToText, matchReceipt, merchantFromSender, parseReceiptText } from './receipts';
import { fixture } from './test/fixtures';

describe('receipt parsing', () => {
  it('reads an airline e-receipt (HTML email body)', () => {
    const raw = fixture('receipts/delta-receipt.eml');
    const html = raw.slice(raw.indexOf('<html>'));
    const r = parseReceiptText(htmlToText(html), { from: '"Delta Air Lines" <DeltaAirLines@t.delta.com>', date: '2026-09-20T18:02:11Z' });
    expect(r).toMatchObject({ merchantKey: 'DELTA AIR LINES', date: '2026-09-20', totalCents: 41230 });
  });

  it('prefers TOTAL over subtotal and reads text receipts', () => {
    const r = parseReceiptText(fixture('receipts/hertz-receipt.txt'));
    expect(r.totalCents).toBe(21560);
    expect(r.merchantKey).toBe('HERTZ');
  });

  it('uses "amount paid" and a written date', () => {
    const r = parseReceiptText(htmlToText(fixture('receipts/airbnb-receipt.html')), { from: 'Airbnb <automated@airbnb.com>' });
    expect(r).toMatchObject({ merchantKey: 'AIRBNB', totalCents: 19600, date: '2026-11-01' });
  });

  it('maps senders to merchants', () => {
    expect(merchantFromSender('Uber Receipts <noreply@uber.com>')).toBe('UBER');
    expect(merchantFromSender('"Acme Studio Rentals" <billing@acmestudio.example>')).toBe('ACME STUDIO RENTALS');
    expect(merchantFromSender('orders@smallshop.example')).toBe('SMALLSHOP');
  });
});

describe('receipt matching', () => {
  const txns = [
    { id: 1, date: '2026-09-21', amountCents: -41230, merchantKey: 'DELTA AIR LINES', description: 'DELTA AIR LINES ATLANTA GA' },
    { id: 2, date: '2026-09-21', amountCents: -41230, merchantKey: 'BEST BUY', description: 'BEST BUY 123' },
    { id: 3, date: '2026-09-25', amountCents: -1200, merchantKey: 'STARBUCKS', description: 'STARBUCKS' },
    { id: 4, date: '2026-12-20', amountCents: -41230, merchantKey: 'DELTA AIR LINES', description: 'DELTA AIR LINES' },
  ];

  it('prefers same amount + close date + matching merchant', () => {
    const m = matchReceipt({ merchantKey: 'DELTA AIR LINES', date: '2026-09-20', totalCents: 41230 }, txns);
    expect(m.map((x) => x.transactionId)).toEqual([1, 2]);
    expect(m[0].score).toBeGreaterThanOrEqual(95);
    expect(confidentMatch(m)?.transactionId).toBe(1);
  });

  it('does not auto-link when two candidates are equally good', () => {
    const m = matchReceipt({ merchantKey: null, date: '2026-09-20', totalCents: 41230 }, txns);
    expect(confidentMatch(m)).toBeNull();
  });

  it('allows hotel-style charges up to ~a month later', () => {
    const m = matchReceipt({ merchantKey: 'MARRIOTT', date: '2026-10-01', totalCents: 68910 }, [
      { id: 9, date: '2026-10-18', amountCents: -68910, merchantKey: 'MARRIOTT', description: 'MARRIOTT DETROIT' },
    ]);
    expect(m[0]).toMatchObject({ transactionId: 9 });
    expect(confidentMatch(m)?.transactionId).toBe(9);
  });
});
