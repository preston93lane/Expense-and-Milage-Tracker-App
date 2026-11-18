import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from './merchant';

describe('normalizeMerchant', () => {
  it.each([
    ['DEBIT CARD PURCHASE - STARBUCKS STORE 12345 ANN ARBOR MI', 'Starbucks', 'Ann Arbor', 'MI'],
    ['TST* SLOWS BAR BQ DETROIT MI', 'Slows Bar Bq', 'Detroit', 'MI'],
    ['SHELL OIL 57444212345 DETROIT MI', 'Shell', 'Detroit', 'MI'],
    ['MARRIOTT DETROIT DOWNTOWN DETROIT MI', 'Marriott', 'Detroit', 'MI'],
    ['HERTZ RENT-A-CAR ROMULUS MI', 'Hertz', 'Romulus', 'MI'],
    ['SQ *BLUE BOTTLE COFFEE SAN FRANCISCO CA', 'Blue Bottle Coffee', 'San Francisco', 'CA'],
    ['PURCHASE AUTHORIZED ON 09/30 OFFICE DEPOT #123 DEARBORN MI S386285123456 CARD 1234', 'Office Depot', 'Dearborn', 'MI'],
    ['KROGER #0456 YPSILANTI MI', 'Kroger', 'Ypsilanti', 'MI'],
  ])('%s', (raw, merchant, city, state) => {
    const m = normalizeMerchant(raw);
    expect(m.merchant).toBe(merchant);
    expect(m.city).toBe(city);
    expect(m.state).toBe(state);
  });

  it('treats web merchants as online (state is HQ, not you)', () => {
    const amazon = normalizeMerchant('AMAZON.COM*2K3L45 AMZN.COM/BILLWA');
    expect(amazon.merchant).toBe('Amazon');
    expect(amazon.state).toBe('WA');
    expect(amazon.city).toBeNull();
    expect(amazon.online).toBe(true);

    const uber = normalizeMerchant('UBER *TRIP HELP.UBER.COMCA');
    expect(uber.merchantKey).toBe('UBER');
    expect(uber.online).toBe(true);
  });

  it('keeps meaningful words after a star and canonicalises known brands', () => {
    expect(normalizeMerchant('UBER *EATS PENDING').merchantKey).toBe('UBER EATS');
    expect(normalizeMerchant('DELTA AIR LINES ATLANTA GA').merchantKey).toBe('DELTA AIR LINES');
    expect(normalizeMerchant('IRS USATAXPYMT 270000000000001').merchantKey).toBe('IRS');
    expect(normalizeMerchant('ADOBE *CREATIVE CLD 408-536-6000 CA').merchantKey).toBe('ADOBE');
  });

  it('is stable for the same merchant across descriptions', () => {
    const a = normalizeMerchant('POS PURCHASE STARBUCKS STORE 999 DETROIT MI');
    const b = normalizeMerchant('STARBUCKS #12 CHICAGO IL');
    expect(a.merchantKey).toBe(b.merchantKey);
  });
});
