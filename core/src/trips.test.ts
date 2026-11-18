import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from './merchant';
import { categorize } from './categorize/pipeline';
import { inferHomeState, matchTrip, suggestTrips, tripCandidates, type TripTxn, type TripWindow } from './trips';

let nextId = 1;
function tx(date: string, description: string, amountCents: number, extra: Partial<TripTxn> = {}): TripTxn {
  const m = normalizeMerchant(description);
  return {
    id: nextId++,
    date,
    amountCents,
    description,
    merchantKey: m.merchantKey,
    city: m.city,
    state: m.state,
    isOnline: m.online,
    status: 'unreviewed',
    classification: null,
    categoryId: null,
    tripId: null,
    ...extra,
  };
}

const detroit: TripWindow = {
  id: 7,
  name: 'Detroit — client kickoff',
  startDate: '2026-10-12',
  endDate: '2026-10-16',
  destCity: 'Detroit',
  destState: 'MI',
  beforeDays: 60,
  afterDays: 5,
};

// Home is Illinois in this scenario; the trip is to Michigan.
const ledger = [
  tx('2026-09-01', 'JEWEL OSCO #123 CHICAGO IL', -8000),
  tx('2026-09-03', 'STARBUCKS STORE 1 CHICAGO IL', -500),
  tx('2026-09-20', 'DELTA AIR LINES ATLANTA GA', -41230), // flight booked 22 days before
  tx('2026-09-21', 'MARRIOTT DETROIT DOWNTOWN DETROIT MI', -10000), // hotel deposit
  tx('2026-09-25', 'TARGET 00012 CHICAGO IL', -4500), // unrelated, before trip
  tx('2026-10-12', 'HERTZ RENT-A-CAR ROMULUS MI', -21560),
  tx('2026-10-13', 'TST* SLOWS BAR BQ DETROIT MI', -4875),
  tx('2026-10-13', 'SHELL OIL 57444212345 DETROIT MI', -3820),
  tx('2026-10-14', 'NETFLIX.COM LOS GATOS CA', -1549), // recurring personal
  tx('2026-10-14', 'JEWEL OSCO #123 CHICAGO IL', -6000), // family groceries back home
  tx('2026-10-15', 'PAYMENT THANK YOU', 81240), // card payment
  tx('2026-10-15', 'AMAZON.COM*2K3L45 AMZN.COM/BILLWA', -2599), // online, during trip
  tx('2026-10-18', 'MARRIOTT DETROIT DOWNTOWN DETROIT MI', -68910), // folio posts after checkout
  tx('2026-10-19', 'CHIPOTLE 1234 CHICAGO IL', -1200), // back home
  tx('2026-12-01', 'DELTA AIR LINES ATLANTA GA', -30000), // next trip, out of window
];

describe('trip candidates', () => {
  const home = inferHomeState(ledger);
  const cands = tripCandidates(detroit, ledger, home);
  const byDesc = (d: string) => {
    const t = ledger.find((x) => x.description.startsWith(d))!;
    return cands.filter((c) => c.id === t.id);
  };

  it('infers the home state from in-person purchases', () => {
    expect(home).toBe('IL');
  });

  it('includes flight and hotel booked before the trip, not other pre-trip spending', () => {
    expect(byDesc('DELTA')[0]).toMatchObject({ reason: 'booked_before', preselect: true, suggestedCategoryKey: 'travel_airfare' });
    expect(byDesc('DELTA')[0].why).toBe('Flight booked 22 days before');
    expect(byDesc('MARRIOTT')[0]).toMatchObject({ reason: 'booked_before', preselect: true });
    expect(byDesc('TARGET')).toHaveLength(0);
    expect(byDesc('STARBUCKS')).toHaveLength(0);
  });

  it('pre-ticks spending during the trip with trip-aware categories', () => {
    expect(byDesc('HERTZ')[0]).toMatchObject({ reason: 'during', preselect: true, suggestedCategoryKey: 'travel_car' });
    expect(byDesc('TST* SLOWS')[0]).toMatchObject({ preselect: true, suggestedCategoryKey: 'travel_meals' });
    expect(byDesc('SHELL')[0]).toMatchObject({ preselect: true, suggestedCategoryKey: 'travel_car' }); // rental-car fuel
  });

  it('leaves home-state, recurring and transfer items unticked or out', () => {
    const groceries = cands.find((c) => c.id === ledger[9].id)!;
    expect(groceries.preselect).toBe(false);
    expect(byDesc('NETFLIX')[0].preselect).toBe(false);
    expect(byDesc('PAYMENT THANK YOU')).toHaveLength(0);
    expect(byDesc('AMAZON')[0].preselect).toBe(true); // online during the trip — you decide; default in
  });

  it('includes late-posting hotel bills after the trip but not regular spending back home', () => {
    const after = cands.filter((c) => c.reason === 'posted_after');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ preselect: true, suggestedCategoryKey: 'travel_lodging' });
    expect(byDesc('CHIPOTLE')).toHaveLength(0);
  });

  it('skips transactions already assigned to a different trip', () => {
    const other = ledger.map((t) => (t.description.startsWith('HERTZ') ? { ...t, tripId: 99 } : t));
    expect(tripCandidates(detroit, other, 'IL').some((c) => c.id === ledger[5].id)).toBe(false);
  });
});

describe('several trips close together', () => {
  // Home IL. Detroit trip Oct 12–14 (not created yet), then a Columbus trip Nov 3–5.
  const l2 = [
    tx('2026-09-01', 'JEWEL OSCO #123 CHICAGO IL', -8000),
    tx('2026-09-02', 'STARBUCKS STORE 1 CHICAGO IL', -500),
    tx('2026-10-10', 'DELTA AIR LINES ATLANTA GA', -41230), // for Detroit
    tx('2026-10-12', 'HERTZ RENT-A-CAR ROMULUS MI', -21560), // in person in MI
    tx('2026-10-12', 'MARRIOTT DETROIT DOWNTOWN DETROIT MI', -68910),
    tx('2026-10-20', 'UNITED AIRLINES HOUSTON TX', -31840), // for Columbus
    tx('2026-10-25', 'MARRIOTT DETROIT DOWNTOWN DETROIT MI', 5000), // refund
    tx('2026-11-03', 'HAMPTON INN COLUMBUS OH', -15400),
  ];
  const columbus: TripWindow = { ...detroit, id: 8, name: 'Columbus', startDate: '2026-11-03', endDate: '2026-11-05', destCity: 'Columbus', destState: 'OH' };
  const c = tripCandidates(columbus, l2, 'IL');
  const get = (d: string) => c.find((x) => l2.find((t) => t.id === x.id)!.description.startsWith(d));

  it('ignores hotels/rental cars charged in person in another state', () => {
    expect(get('HERTZ')).toBeUndefined();
    expect(get('MARRIOTT')).toBeUndefined();
  });

  it('lists but does not tick a flight that was probably for the earlier trip', () => {
    expect(get('DELTA')).toMatchObject({ preselect: false });
    expect(get('DELTA')!.why).toBe('Flight — probably for your Oct 12 trip to MI');
    expect(get('UNITED')).toMatchObject({ preselect: true, why: 'Flight booked 14 days before' });
  });
});

describe('trip-aware categorisation of new imports', () => {
  it('suggests business + travel meals for a restaurant inside a trip window', () => {
    const t = tx('2026-10-14', 'SQ *ASTRO COFFEE DETROIT MI', -900);
    const res = categorize(
      { ...t, merchant: t.merchantKey, accountId: 1 },
      { rules: [], history: new Map(), categoryIdByKey: { travel_meals: 5 }, trips: [detroit], homeState: 'IL' },
    );
    expect(res).toMatchObject({ status: 'suggested', classification: 'business', categoryId: 5, source: 'trip', tripId: 7 });
  });

  it('does not grab home-state spending during the trip', () => {
    const t = tx('2026-10-14', 'JEWEL OSCO #123 CHICAGO IL', -6000);
    expect(matchTrip([detroit], t, 'IL')).toBeNull();
  });
});

describe('trip suggestions', () => {
  it('finds runs of out-of-state card activity not yet covered by a trip', () => {
    const s = suggestTrips(ledger, 'IL', []);
    expect(s[0]).toMatchObject({ state: 'MI', startDate: '2026-10-12', endDate: '2026-10-13', transactionCount: 3 });
    expect(s[0].cities).toEqual(expect.arrayContaining(['Romulus', 'Detroit']));
    expect(suggestTrips(ledger, 'IL', [detroit]).find((x) => x.startDate === '2026-10-12')).toBeUndefined();
  });
});
