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
  const acct = (await t.call('POST', '/api/accounts', { name: 'Checking', type: 'checking' })).body.id;
  await t.call('POST', '/api/import/commit', {
    accountId: acct,
    fileName: 't.csv',
    content: [
      'Date,Description,Amount',
      '03/01/2026,ACME CORP ACH PAYMENT,6000.00',
      '03/05/2026,GLOBEX INC PAYMENT,2000.00',
      '03/07/2026,UPWORK ESCROW EDITOR,-1000.00',
      '04/02/2026,SHELL OIL 57444 TROY MI,-60.00',
      '05/02/2026,JIFFY LUBE 1234 TROY MI,-90.00',
    ].join('\n'),
  });
  const acme = (await t.call('POST', '/api/clients', { name: 'Acme Corp', hourlyRateCents: 15_000 })).body.id as number;
  const globex = (await t.call('POST', '/api/clients', { name: 'Globex' })).body.id as number;
  const cats = (await t.call('GET', '/api/categories')).body as any[];
  const cat = (k: string) => cats.find((c) => c.key === k).id;
  const rows = (await t.call('GET', '/api/transactions?sort=date_asc')).body.rows as any[];
  const id = (s: string) => rows.find((r) => r.description.includes(s)).id as number;
  await t.call('POST', '/api/transactions/bulk', { ids: [id('ACME')], categoryId: cat('income'), clientId: acme });
  await t.call('POST', '/api/transactions/bulk', { ids: [id('GLOBEX')], categoryId: cat('income'), clientId: globex });
  await t.call('POST', '/api/transactions/bulk', { ids: [id('UPWORK')], categoryId: cat('contract_labor'), clientId: acme });
  await t.call('POST', '/api/transactions/bulk', { ids: [id('SHELL'), id('JIFFY')], categoryId: cat('vehicle_actual') });
  return { acme, globex };
}

describe('time tracking', () => {
  it('logs time, runs a timer, and summarises where hours go', async () => {
    const { acme } = await seed();
    expect((await t.call('POST', '/api/time', { date: '2026-03-02', hours: 0, clientId: acme })).status).toBe(400);
    await t.call('POST', '/api/time', { date: '2026-03-02', hours: 20, clientId: acme, activity: 'client_work', description: 'Shoot' });
    await t.call('POST', '/api/time', { date: '2026-03-03', minutes: 240, activity: 'admin', billable: false });

    const start = await t.call('POST', '/api/time/start', { clientId: acme, activity: 'editing' });
    expect(start.status).toBe(200);
    // Pretend the timer started 90 minutes ago.
    t.ctx.db.prepare('UPDATE time_entries SET started_at = ? WHERE id = ?').run(new Date(Date.now() - 90 * 60_000).toISOString(), start.body.id);
    let list = (await t.call('GET', '/api/time')).body;
    expect(list.running).toMatchObject({ id: start.body.id, running: true, minutes: 90 });
    const stopped = (await t.call('POST', '/api/time/stop')).body;
    expect(stopped).toMatchObject({ running: false, minutes: 90, rateCents: 15_000, valueCents: 22_500 });
    expect((await t.call('POST', '/api/time/stop')).status).toBe(400);
    list = (await t.call('GET', '/api/time')).body;
    expect(list.running).toBeNull();
    expect(list.entries).toHaveLength(3);

    const year = new Date().getFullYear();
    const s = (await t.call('GET', `/api/time/summary?year=2026`)).body;
    expect(s.byActivity.map((a: any) => a.key)).toEqual(['client_work', 'admin', ...(year === 2026 ? ['editing'] : [])]);
    expect(s.byActivity[0]).toMatchObject({ minutes: 1200, label: 'Client work' });
  });

  it('bills unbilled time as a draft invoice at the client’s rate', async () => {
    const { acme, globex } = await seed();
    await t.call('POST', '/api/time', { date: '2026-03-02', hours: 2.5, clientId: acme, description: 'Edit' });
    await t.call('POST', '/api/time', { date: '2026-03-04', hours: 1, clientId: acme, billable: false });
    await t.call('POST', '/api/time', { date: '2026-03-04', hours: 1, clientId: globex });
    expect((await t.call('POST', '/api/time/invoice', { clientId: globex })).status).toBe(400); // no rate yet
    const r = (await t.call('POST', '/api/time/invoice', { clientId: acme })).body;
    expect(r.entries).toBe(1);
    const inv = (await t.call('GET', `/api/invoices/${r.invoiceId}`)).body;
    expect(inv).toMatchObject({ status: 'draft', totalCents: 37_500 });
    // Already billed: nothing left.
    expect((await t.call('POST', '/api/time/invoice', { clientId: acme })).status).toBe(400);
    await t.call('PUT', '/api/time/settings', { defaultRateCents: 10_000, targetHourlyCents: 12_000 });
    expect((await t.call('POST', '/api/time/invoice', { clientId: globex })).body.entries).toBe(1);
  });
});

describe('profitability', () => {
  it('works out what each client really pays per hour', async () => {
    const { acme, globex } = await seed();
    await t.call('PUT', '/api/time/settings', { targetHourlyCents: 10_000 });
    await t.call('POST', '/api/time', { date: '2026-03-02', hours: 20, clientId: acme });
    await t.call('POST', '/api/time', { date: '2026-03-03', hours: 20, clientId: acme });
    await t.call('POST', '/api/time', { date: '2026-03-06', hours: 10, clientId: globex });
    await t.call('POST', '/api/time', { date: '2026-03-08', hours: 5, activity: 'admin', billable: false });
    const p = (await t.call('GET', '/api/profitability?year=2026')).body;
    expect(p.clients.map((c: any) => [c.name, c.incomeCents, c.directCostCents, c.effectiveHourlyCents, c.verdict])).toEqual([
      ['Globex', 200_000, 0, 20_000, 'above_target'],
      ['Acme Corp', 600_000, 100_000, 12_500, 'above_target'],
    ]);
    expect(p.overall).toMatchObject({ minutes: 55 * 60, overheadMinutes: 300 });
  });

  it('counts time on a client’s trip toward that client', async () => {
    const { globex } = await seed();
    const trip = (await t.call('POST', '/api/trips', { name: 'Globex shoot', startDate: '2026-03-10', endDate: '2026-03-12', clientId: globex })).body;
    await t.call('POST', '/api/time', { date: '2026-03-10', hours: 8, tripId: trip.id, activity: 'travel', billable: false });
    const p = (await t.call('GET', '/api/profitability?year=2026')).body;
    expect(p.clients.find((c: any) => c.name === 'Globex')).toMatchObject({ minutes: 480, effectiveHourlyCents: 25_000 });
  });
});

describe('car: standard rate vs actual', () => {
  it('compares using car costs from transactions plus what you enter', async () => {
    await seed();
    let v = (await t.call('GET', '/api/vehicle/2026')).body;
    expect(v).toMatchObject({ saved: false, operatingCents: 15_000, operatingCount: 2, milesSource: 'manual' });
    expect(v.comparison.better).toBe('unknown');
    expect((await t.call('PUT', '/api/vehicle/2026', { totalMiles: 100, businessMiles: 200 })).status).toBe(400);
    await t.call('PUT', '/api/vehicle/2026', { totalMiles: 12_000, businessMiles: 6_000, insuranceCents: 150_000, depreciationCents: 200_000, firstYearMethod: 'standard' });
    v = (await t.call('GET', '/api/vehicle/2026')).body;
    expect(v.comparison.businessPct).toBe(50);
    expect(v.comparison.actualDeductionCents).toBe(182_500);
    expect(v.comparison.standardDeductionCents).toBeCloseTo(6_000 * v.averageRateCents, -2);
    expect(v.comparison.better).toBe('standard');
  });
});
