import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './test/helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

async function seed() {
  const acct = (await t.call('POST', '/api/accounts', { name: 'Card', type: 'credit_card' })).body.id;
  await t.call('POST', '/api/import/commit', {
    accountId: acct,
    fileName: 'eq.csv',
    content: [
      'Date,Description,Amount',
      '01/15/2026,ACME CORP ACH PAYMENT,20000.00',
      '03/02/2026,B&H PHOTO 800-606-6969 NY,-3299.00',
      '04/10/2026,BEST BUY 00012345 TROY MI,-899.00',
    ].join('\n'),
  });
  const cats = (await t.call('GET', '/api/categories')).body as any[];
  const cat = (k: string) => cats.find((c) => c.key === k).id;
  const rows = (await t.call('GET', '/api/transactions?sort=date_asc')).body.rows as any[];
  const id = (s: string) => rows.find((r) => r.description.includes(s)).id as number;
  await t.call('POST', '/api/transactions/bulk', { ids: [id('ACME')], categoryId: cat('income') });
  await t.call('POST', '/api/transactions/bulk', { ids: [id('B&H'), id('BEST BUY')], categoryId: cat('equipment') });
  return { id };
}

const line13 = async () => {
  const s = (await t.call('GET', '/api/taxes/2026')).body;
  return s.scheduleC.expenseLines.find((l: any) => l.line === '13')?.amountCents ?? 0;
};

describe('equipment register', () => {
  it('suggests values from a purchase and adds it to the register', async () => {
    const { id } = await seed();
    const sug = (await t.call('GET', `/api/assets/suggest?transactionId=${id('B&H')}`)).body;
    expect(sug).toMatchObject({ type: 'camera', costCents: 329_900, method: 'section179', purchaseDate: '2026-03-02' });
    const res = await t.call('POST', '/api/assets', { transactionId: id('B&H'), name: 'Sony A7 IV', serialNumber: 'SN123' });
    expect(res.status).toBe(200);
    const list = (await t.call('GET', '/api/assets?year=2026')).body;
    expect(list.assets).toHaveLength(1);
    expect(list.assets[0]).toMatchObject({ name: 'Sony A7 IV', costCents: 329_900, deductionThisYearCents: 329_900, vendor: expect.any(String) });
    expect(list.summary).toMatchObject({ deductionCents: 329_900, activeCount: 1, activeCostCents: 329_900 });
    // The Best Buy purchase is still waiting to be added.
    expect(list.unregistered.map((u: any) => u.costCents)).toEqual([89_900]);
    expect((await t.call('GET', `/api/assets/by-transaction/${id('B&H')}`)).body.assets).toHaveLength(1);
  });

  it('counts a linked purchase once on Schedule C line 13, through depreciation', async () => {
    const { id } = await seed();
    expect(await line13()).toBe(329_900 + 89_900);
    // 5-year MACRS at 80% business use: basis 2,639.20 → 20% in year one.
    await t.call('POST', '/api/assets', { transactionId: id('B&H'), name: 'Sony A7 IV', method: 'macrs5', businessUsePct: 80 });
    expect(await line13()).toBe(89_900 + 52_784);
    const s = (await t.call('GET', '/api/taxes/2026')).body;
    expect(s.scheduleC.expenseLines.find((l: any) => l.line === '13').detail.some((d: any) => /equipment register/.test(d.name))).toBe(true);
  });

  it('keeps the leftover of an order that is only partly in the register', async () => {
    const { id } = await seed();
    await t.call('POST', '/api/assets', { transactionId: id('B&H'), name: 'Camera body', costCents: 249_900, method: 'macrs5' });
    // 2,499 − 999.60 deferred; the other $800 of the order (cables, card) stays an expense.
    expect(await line13()).toBe(89_900 + 80_000 + 49_980);
  });

  it('validates input, edits, marks sold and deletes', async () => {
    await seed();
    expect((await t.call('POST', '/api/assets', { name: 'X', purchaseDate: '2026-01-01' })).status).toBe(400);
    expect((await t.call('POST', '/api/assets', { name: 'X', purchaseDate: '2026-01-01', costCents: 100, method: 'magic' })).status).toBe(400);
    expect((await t.call('POST', '/api/assets', { name: 'X', purchaseDate: '2026-02-01', placedInService: '2026-01-01', costCents: 100 })).status).toBe(400);
    const a = (await t.call('POST', '/api/assets', { name: 'Desk', type: 'furniture', purchaseDate: '2026-02-01', costCents: 60_000 })).body.id;
    let got = (await t.call('GET', '/api/assets?year=2026')).body.assets[0];
    expect(got).toMatchObject({ method: 'de_minimis', replaceAfterYears: 10 });
    await t.call('PATCH', `/api/assets/${a}`, { method: 'straight_line', lifeYears: 4, warrantyUntil: '2026-12-01' });
    got = (await t.call('GET', '/api/assets?year=2026')).body.assets[0];
    expect(got).toMatchObject({ method: 'straight_line', lifeYears: 4, deductionThisYearCents: 7_500, warrantyUntil: '2026-12-01' });
    await t.call('PATCH', `/api/assets/${a}`, { disposedDate: '2027-06-01', disposedAmountCents: 20_000 });
    got = (await t.call('GET', '/api/assets?year=2028')).body.assets[0];
    expect(got.deductionThisYearCents).toBe(0);
    expect(got.warnings.join(' ')).toMatch(/recapture/);
    await t.call('DELETE', `/api/assets/${a}`);
    expect((await t.call('GET', '/api/assets?year=2026')).body.assets).toHaveLength(0);
  });

  it('leaves vehicles out while using the standard mileage rate', async () => {
    await seed();
    await t.call('POST', '/api/assets', { name: 'Truck', type: 'vehicle', purchaseDate: '2026-01-05', costCents: 3_000_000, method: 'macrs5' });
    const list = (await t.call('GET', '/api/assets?year=2026')).body;
    expect(list.assets[0]).toMatchObject({ countsForTaxes: false, deductionThisYearCents: 0 });
    expect(list.summary.deductionCents).toBe(0);
  });
});
