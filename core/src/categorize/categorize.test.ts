import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from '../merchant';
import { categorize, type CategorizeContext } from './pipeline';
import { firstMatchingRule, ruleFromTransaction } from './rules';
import { findTransferPairs, looksLikeTransfer } from './transfers';
import type { Rule, TxnFacts } from './types';
import { merchantTypeOf } from './merchantTypes';

const CAT = { travel_airfare: 10, meals: 20, software: 30, est_tax_federal: 40, travel_lodging: 50 };

function facts(description: string, amountCents: number, extra: Partial<TxnFacts> = {}) {
  const m = normalizeMerchant(description);
  return {
    description,
    merchant: m.merchant,
    merchantKey: m.merchantKey,
    amountCents,
    accountId: 1,
    state: m.state,
    city: m.city,
    date: '2026-10-10',
    ...extra,
  };
}

function ctx(rules: Rule[] = [], history: CategorizeContext['history'] = new Map()): CategorizeContext {
  return { rules, history, categoryIdByKey: CAT };
}

const rule = (over: Partial<Rule>): Rule => ({
  id: 1,
  name: 'r',
  priority: 100,
  enabled: true,
  autoConfirm: true,
  conditions: { match: 'all', items: [] },
  actions: { classification: 'business', categoryId: 10 },
  ...over,
});

describe('rules engine', () => {
  it('matches description, merchant, amount and state conditions', () => {
    const t = facts('DELTA AIR LINES ATLANTA GA', -41230);
    const r = rule({
      conditions: {
        match: 'all',
        items: [
          { field: 'description', op: 'contains', value: 'delta' },
          { field: 'amount', op: 'between', value: 10000, value2: 50000 },
          { field: 'state', op: 'equals', value: 'GA' },
          { field: 'direction', op: 'equals', value: 'out' },
        ],
      },
    });
    expect(firstMatchingRule([r], t)?.id).toBe(1);
    expect(firstMatchingRule([{ ...r, enabled: false }], t)).toBeNull();
  });

  it('respects priority order', () => {
    const t = facts('STARBUCKS STORE 1 DETROIT MI', -500);
    const general = rule({ id: 1, priority: 200, conditions: { match: 'all', items: [{ field: 'merchant', op: 'equals', value: 'STARBUCKS' }] } });
    const specific = rule({ id: 2, priority: 10, conditions: { match: 'all', items: [{ field: 'city', op: 'equals', value: 'Detroit' }] } });
    expect(firstMatchingRule([general, specific], t)?.id).toBe(2);
  });

  it('builds an "always do this" rule from a transaction', () => {
    const t = facts('ADOBE *CREATIVE CLD 408-536-6000 CA', -5999);
    const r = ruleFromTransaction(t, { classification: 'business', categoryId: 30 }, 'Software & subscriptions');
    expect(r.name).toBe('Adobe → Software & subscriptions');
    expect(firstMatchingRule([{ ...r, id: 9 }], facts('ADOBE *ACROPRO 408-536-6000 CA', -2000))?.id).toBe(9);
  });

  it('survives a bad regex', () => {
    const t = facts('X', -1);
    const r = rule({ conditions: { match: 'all', items: [{ field: 'description', op: 'regex', value: '([' }] } });
    expect(firstMatchingRule([r], t)).toBeNull();
  });
});

describe('categorize pipeline', () => {
  it('applies rules first (auto-confirmed)', () => {
    const r = rule({ conditions: { match: 'all', items: [{ field: 'merchant', op: 'equals', value: 'DELTA AIR LINES' }] } });
    const res = categorize(facts('DELTA AIR LINES ATLANTA GA', -41230), ctx([r]));
    expect(res).toMatchObject({ status: 'reviewed', classification: 'business', categoryId: 10, source: 'rule', ruleId: 1 });
  });

  it('suggests (not confirms) when a rule is not auto-confirm, and supports splits', () => {
    const r = rule({
      autoConfirm: false,
      actions: { classification: 'business', categoryId: 30, businessPct: 60 },
      conditions: { match: 'all', items: [{ field: 'description', op: 'contains', value: 'VERIZON' }] },
    });
    const res = categorize(facts('VERIZON WIRELESS PAYMENTS', -8500), ctx([r]));
    expect(res).toMatchObject({ status: 'suggested', businessPct: 60 });
  });

  it('detects card payments and transfers', () => {
    expect(categorize(facts('PAYMENT THANK YOU', 81240), ctx())).toMatchObject({ classification: 'transfer', status: 'suggested' });
    expect(looksLikeTransfer('ONLINE TRANSFER TO SAV XXXXXX1234')).toBe(true);
    expect(looksLikeTransfer('STARBUCKS')).toBe(false);
  });

  it('learns from history when you have been consistent', () => {
    const history = new Map([['KROGER', [{ classification: 'personal' as const, categoryId: null, count: 5 }]]]);
    expect(categorize(facts('KROGER #0456 YPSILANTI MI', -8712), ctx([], history))).toMatchObject({
      status: 'suggested', classification: 'personal', source: 'history', confidence: 1,
    });
    const mixed = new Map([['STARBUCKS', [
      { classification: 'personal' as const, categoryId: null, count: 3 },
      { classification: 'business' as const, categoryId: 20, count: 3 },
    ]]]);
    expect(categorize(facts('STARBUCKS STORE 1 DETROIT MI', -500), ctx([], mixed)).source).not.toBe('history');
  });

  it('falls back to a category hint from built-in merchant knowledge', () => {
    const res = categorize(facts('MARRIOTT DETROIT DOWNTOWN DETROIT MI', -68910), ctx());
    expect(res).toMatchObject({ status: 'unreviewed', classification: null, categoryId: 50, source: 'keyword' });
    expect(categorize(facts('IRS USATAXPYMT 270000000000001', -150000), ctx())).toMatchObject({ categoryId: 40, status: 'suggested' });
  });

  it('leaves unknown merchants for Needs Review', () => {
    expect(categorize(facts('ZQX HOLDINGS 7781', -1000), ctx())).toMatchObject({ status: 'unreviewed', categoryId: null, source: null });
  });
});

describe('merchant types', () => {
  it.each([
    ['DELTA AIR LINES', 'airline'],
    ['HERTZ', 'car_rental'],
    ['MARRIOTT', 'lodging'],
    ['AIRBNB', 'lodging'],
    ['SLOWS BAR BQ', 'restaurant'],
    ['SHELL', 'gas'],
    ['UBER', 'rideshare'],
    ['UBER EATS', 'restaurant'],
    ['PARKMOBILE', 'parking'],
    ['KROGER', 'grocery'],
  ])('%s → %s', (key, type) => {
    expect(merchantTypeOf(key)).toBe(type);
  });
});

describe('transfer pairing', () => {
  it('pairs a checking payment with the card credit', () => {
    const pairs = findTransferPairs([
      { id: 1, accountId: 1, date: '2026-10-05', amountCents: -81240, description: 'PAYMENT TO CHASE CARD ENDING IN 9876' },
      { id: 2, accountId: 2, date: '2026-10-07', amountCents: 81240, description: 'PAYMENT THANK YOU' },
      { id: 3, accountId: 2, date: '2026-10-07', amountCents: 5000, description: 'MARRIOTT REFUND' },
      { id: 4, accountId: 1, date: '2026-10-08', amountCents: -5000, description: 'MARRIOTT' },
    ]);
    expect(pairs).toEqual([[1, 2]]);
  });
});
