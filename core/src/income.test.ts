import { describe, expect, it } from 'vitest';
import {
  contractor1099,
  expectedClient1099s,
  inferPaymentMethod,
  invoicePaymentCandidates,
  invoiceState,
  invoiceTotal,
  necDeadline,
  necThresholdCents,
  retainerDueDates,
  retainerSchedule,
  type ContractorFacts,
} from './income';

const editor: ContractorFacts = { id: 1, name: 'Dana Editor', entityType: 'individual', w9Received: false, tinLast4: null, address: null };

describe('1099-NEC rules', () => {
  it('uses $600 through 2025 and $2,000 from 2026', () => {
    expect(necThresholdCents(2025)).toBe(60_000);
    expect(necThresholdCents(2026)).toBe(200_000);
    expect(necThresholdCents(2027)).toBe(200_000);
  });

  it('counts only direct payments (not card/PayPal) toward the threshold', () => {
    const r = contractor1099(
      editor,
      [
        { date: '2026-02-01', paidCents: 150_000, method: 'direct' },
        { date: '2026-03-01', paidCents: 100_000, method: 'card_or_processor' },
        { date: '2025-12-31', paidCents: 900_000, method: 'direct' },
      ],
      2026,
    );
    expect(r).toMatchObject({ directCents: 150_000, processorCents: 100_000, needs1099: false, approaching: true });
    expect(r.warnings[0]).toMatch(/W-9/);
  });

  it('flags a 1099 and missing details once direct payments reach the threshold', () => {
    const r = contractor1099(editor, [{ date: '2026-05-01', paidCents: 200_000, method: 'direct' }], 2026);
    expect(r.needs1099).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/taxpayer ID/);
  });

  it('exempts corporations', () => {
    const r = contractor1099({ ...editor, entityType: 's_corp' }, [{ date: '2025-05-01', paidCents: 100_000, method: 'direct' }], 2025);
    expect(r.needs1099).toBe(false);
    expect(r.exemptCorporation).toBe(true);
  });

  it('infers payment method from account and description', () => {
    expect(inferPaymentMethod('ZELLE PAYMENT TO DANA', 'checking')).toBe('direct');
    expect(inferPaymentMethod('CHECK 1043', 'checking')).toBe('direct');
    expect(inferPaymentMethod('PAYPAL *DANAEDITS', 'checking')).toBe('card_or_processor');
    expect(inferPaymentMethod('DANA EDITS LLC', 'credit_card')).toBe('card_or_processor');
  });

  it('moves the Jan 31 deadline off weekends', () => {
    expect(necDeadline(2026)).toBe('2027-02-01'); // Jan 31 2027 is a Sunday
    expect(necDeadline(2024)).toBe('2025-01-31');
  });

  it('lists clients likely to send you a 1099-NEC', () => {
    const r = expectedClient1099s(
      [
        { clientId: 1, name: 'Acme', directCents: 250_000, processorCents: 0 },
        { clientId: 2, name: 'Small', directCents: 50_000, processorCents: 0 },
        { clientId: 3, name: 'Stripe client', directCents: 0, processorCents: 400_000 },
      ],
      2026,
    );
    expect(r.map((x) => [x.name, x.expect1099Nec])).toEqual([
      ['Acme', true],
      ['Stripe client', false],
    ]);
  });
});

describe('retainers', () => {
  const r = { id: 1, clientId: 9, name: 'Rotary monthly', amountCents: 150_000, frequency: 'monthly' as const, startDate: '2026-01-31', endDate: null, active: true };

  it('generates month-end dates without drifting', () => {
    expect(retainerDueDates(r, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('matches deposits and marks late/missed/upcoming', () => {
    const s = retainerSchedule(
      [r],
      [
        { id: 100, date: '2026-02-02', amountCents: 150_000, clientId: 9 },
        { id: 101, date: '2026-03-30', amountCents: 150_000, clientId: 8 }, // wrong client
      ],
      '2026-01-01',
      '2026-05-31',
      '2026-05-05',
    );
    expect(s.map((x) => x.status)).toEqual(['received', 'missed', 'missed', 'late', 'upcoming']);
    expect(s[0].transactionId).toBe(100); // paid 2 days after the Jan 31 due date
  });
});

describe('invoices', () => {
  it('totals lines and derives state', () => {
    const total = invoiceTotal([
      { description: 'Shoot day', quantity: 2, unitCents: 90_000 },
      { description: 'Editing', quantity: 3.5, unitCents: 7_500 },
    ]);
    expect(total).toBe(206_250);
    expect(invoiceState({ status: 'sent', dueDate: '2026-11-01' }, total, 0, '2026-11-20')).toBe('overdue');
    expect(invoiceState({ status: 'sent', dueDate: '2026-12-01' }, total, 100, '2026-11-20')).toBe('partial');
    expect(invoiceState({ status: 'sent', dueDate: null }, total, total, '2026-11-20')).toBe('paid');
    expect(invoiceState({ status: 'void', dueDate: null }, total, 0, '2026-11-20')).toBe('void');
  });

  it('finds deposits matching the balance', () => {
    const c = invoicePaymentCandidates({ clientId: 9, issueDate: '2026-10-01', balanceCents: 206_250 }, [
      { id: 1, date: '2026-09-01', amountCents: 206_250, clientId: 9 }, // too early
      { id: 2, date: '2026-10-20', amountCents: 206_250, clientId: null },
      { id: 3, date: '2026-10-25', amountCents: 206_250, clientId: 9 },
      { id: 4, date: '2026-10-25', amountCents: 206_250, clientId: 7 }, // another client
    ]);
    expect(c.map((d) => d.id)).toEqual([3, 2]);
  });
});
