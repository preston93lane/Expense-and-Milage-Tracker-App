import { describe, expect, it } from 'vitest';
import { fixture } from '../test/fixtures';
import { applyCsvMapping, detectCsv } from './csv';
import { computeDedupeKeys } from './dedupe';
import { detectFileKind } from './detect';
import { parseOfx } from './ofx';

function importCsv(name: string, accountType?: 'checking' | 'credit_card') {
  const det = detectCsv(fixture(`bank/${name}`), { accountType });
  const res = applyCsvMapping(det.rows, det.mapping);
  return { det, ...res };
}

describe('CSV detection and import', () => {
  it('reads a single-amount checking export (Chase style)', () => {
    const { det, transactions, errors } = importCsv('checking-chase-style.csv', 'checking');
    expect(det.mapping.amountMode).toBe('single');
    expect(det.mapping.dateFormat).toBe('MM/DD/YYYY');
    expect(det.mapping.invertSign).toBe(false);
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(8);
    expect(transactions[0]).toMatchObject({ date: '2026-10-01', amountCents: -545 });
    expect(transactions[2].amountCents).toBe(250000);
    expect(transactions[7].checkNumber).toBe('1043');
  });

  it('reads debit/credit columns and prefers the transaction date (Capital One style)', () => {
    const { det, transactions, errors } = importCsv('card-capitalone-style.csv', 'credit_card');
    expect(det.mapping.amountMode).toBe('debit_credit');
    expect(det.headers?.[det.mapping.dateColumn]).toBe('Transaction Date');
    expect(errors).toEqual([]);
    const delta = transactions.find((t) => t.description.startsWith('DELTA'))!;
    expect(delta).toMatchObject({ date: '2026-10-10', amountCents: -41230 });
    const payment = transactions.find((t) => t.description.includes('AUTOPAY'))!;
    expect(payment.amountCents).toBe(81240);
    const refund = transactions.filter((t) => t.description.startsWith('MARRIOTT'));
    expect(refund.map((r) => r.amountCents)).toEqual([-68910, 5000]);
  });

  it('flips signs for card exports that show purchases as positive (Amex style)', () => {
    const { det, transactions } = importCsv('card-amex-style.csv', 'credit_card');
    expect(det.mapping.invertSign).toBe(true);
    expect(transactions[0].amountCents).toBe(-1549);
    expect(transactions.find((t) => t.description.startsWith('AUTOPAY'))!.amountCents).toBe(25000);
  });

  it('guesses columns for headerless files (Wells Fargo style)', () => {
    const { det, transactions, errors } = importCsv('checking-wellsfargo-headerless.csv', 'checking');
    expect(det.mapping.hasHeader).toBe(false);
    expect(det.warnings.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(4);
    expect(transactions[0].amountCents).toBe(-4567);
    expect(transactions[0].description).toContain('OFFICE DEPOT');
  });

  it('skips a summary block above the real header (Bank of America style)', () => {
    const { det, transactions, errors } = importCsv('checking-bofa-summary.csv', 'checking');
    expect(det.mapping.skipRows).toBe(5);
    expect(errors).toEqual([]);
    expect(transactions.map((t) => t.amountCents)).toEqual([-8500, 200000, -41500]);
  });

  it('reads category and business/personal columns from history exports', () => {
    const { det, transactions } = importCsv('history-with-categories.csv');
    expect(det.mapping.categoryColumn).toBeDefined();
    expect(det.mapping.classificationColumn).toBeDefined();
    expect(transactions[0]).toMatchObject({ categoryLabel: 'Travel', classificationLabel: 'Business', notes: 'Client kickoff Chicago' });
    expect(transactions[1].classificationLabel).toBe('Personal');
  });
});

describe('OFX / QFX', () => {
  it('reads SGML (OFX 1.x) credit card statements', () => {
    const st = parseOfx(fixture('bank/statement-sgml.qfx'));
    expect(st.accountType).toBe('credit_card');
    expect(st.accountId).toBe('XXXXXXXXXXXX9876');
    expect(st.transactions).toHaveLength(4);
    expect(st.transactions[0]).toMatchObject({
      date: '2026-10-11',
      amountCents: -41230,
      externalId: '2026101124692160000000001',
      description: 'DELTA AIR LINES ATLANTA GA',
    });
    expect(st.transactions[3].description).toBe('AT&T WIRELESS');
  });

  it('reads XML (OFX 2.x) checking statements and prefers DTUSER', () => {
    const st = parseOfx(fixture('bank/statement-xml.ofx'));
    expect(st.accountType).toBe('checking');
    expect(st.transactions[0].date).toBe('2026-10-04');
    expect(st.transactions[1].checkNumber).toBe('1043');
    expect(st.transactions[2].amountCents).toBe(200000);
  });

  it('detects file kinds', () => {
    expect(detectFileKind('x.qfx', fixture('bank/statement-sgml.qfx'))).toBe('ofx');
    expect(detectFileKind('export.csv', fixture('bank/card-amex-style.csv'))).toBe('csv');
    expect(detectFileKind('Timeline.json', '[{"startTime":"x","visit":{}}]')).toBe('timeline');
  });
});

describe('duplicate keys', () => {
  it('are stable across overlapping exports and keep same-day twins', () => {
    const { transactions } = importCsv('checking-chase-style.csv', 'checking');
    const keys1 = computeDedupeKeys(transactions);
    const keys2 = computeDedupeKeys(transactions.slice(3)); // a later, overlapping export
    // The two identical Kroger rows get distinct keys…
    const kroger = keys1.filter((k) => k.includes('KROGER'));
    expect(new Set(kroger).size).toBe(2);
    // …and the overlapping file produces the same keys for the same rows.
    expect(keys2.every((k) => keys1.includes(k))).toBe(true);
  });

  it('use the bank id when present', () => {
    const st = parseOfx(fixture('bank/statement-sgml.qfx'));
    expect(computeDedupeKeys(st.transactions)[0]).toBe('id:2026101124692160000000001');
  });
});
