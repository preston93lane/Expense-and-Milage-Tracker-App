import ExcelJS from 'exceljs';
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
    fileName: 'y.csv',
    content: [
      'Date,Description,Amount',
      '02/01/2025,ACME CORP ACH PAYMENT,40000.00',
      '06/01/2025,ACME CORP ACH PAYMENT,40000.00',
      '03/10/2025,ADOBE *CREATIVE CLD 408-536-6000 CA,-600.00',
      '04/02/2025,TST* SLOWS BAR BQ DETROIT MI,-200.00',
      '04/15/2025,IRS USATAXPYMT 270000000000001,-3000.00',
      '06/16/2025,IRS USATAXPYMT 270000000000002,-3000.00',
      '07/01/2025,VANGUARD SEP IRA CONTRIBUTION,-5000.00',
    ].join('\n'),
  });
  const cats = (await t.call('GET', '/api/categories')).body as any[];
  const cat = (k: string) => cats.find((c) => c.key === k).id;
  const rows = (await t.call('GET', '/api/transactions?sort=date_asc')).body.rows as any[];
  const by = (s: string) => rows.filter((r) => r.description.includes(s)).map((r) => r.id);
  await t.call('POST', '/api/transactions/bulk', { ids: by('ACME'), categoryId: cat('income') });
  await t.call('POST', '/api/transactions/bulk', { ids: by('ADOBE'), categoryId: cat('software') });
  await t.call('POST', '/api/transactions/bulk', { ids: by('SLOWS'), categoryId: cat('meals') });
  await t.call('POST', '/api/transactions/bulk', { ids: by('IRS'), categoryId: cat('est_tax_federal') });
  await t.call('POST', '/api/transactions/bulk', { ids: by('VANGUARD'), categoryId: cat('retirement') });
  return { by };
}

describe('taxes', () => {
  it('builds Schedule C, estimates tax, and tracks quarterly payments for a finished year', async () => {
    await seed();
    await t.call('PUT', '/api/taxes/2025/home-office', { method: 'simplified', officeSqft: 120, homeSqft: 1200, monthsUsed: 12 });
    const s = (await t.call('PUT', '/api/taxes/2025/profile', { filingStatus: 'single', priorYearTaxCents: 1000000, priorYearAgiCents: 6000000 })).body;
    expect(s.scheduleC.line1GrossReceiptsCents).toBe(8000000);
    // Expenses: software 600 + meals 50% of 200 = 700; home office 120 × $5 = 600
    expect(s.scheduleC.line28TotalExpensesCents).toBe(70000);
    expect(s.scheduleC.line30HomeOfficeCents).toBe(60000);
    expect(s.scheduleC.line31NetProfitCents).toBe(8000000 - 70000 - 60000);
    expect(s.scheduleC.schedule1[0]).toMatchObject({ line: '16', amountCents: 500000 });
    expect(s.projection.projectedProfitCents).toBe(s.scheduleC.line31NetProfitCents); // finished year
    expect(s.estimate).toMatchObject({ safeHarborBasis: '100% of last year', requiredAnnualCents: 1000000 });
    expect(s.paidCents).toBe(600000);
    expect(s.quarters.map((q: any) => q.status)).toEqual(['paid', 'paid', 'partly_paid', 'missed']);

    const xlsx = await t.app.inject({ method: 'GET', url: '/api/reports/tax-packet.xlsx?year=2025', headers: { host: '127.0.0.1:4280' } });
    expect(xlsx.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.rawPayload as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Schedule C summary', 'Business transactions', 'Income by client', 'Trips', '1099-NEC', 'Estimated taxes', 'Notes']);
    const line31 = wb.getWorksheet('Schedule C summary')!.getColumn(1).values.indexOf('31');
    expect(wb.getWorksheet('Schedule C summary')!.getRow(line31).getCell(3).value).toBe(78700);
  });

  it('plans retirement: limits from profit, contributions vs plan, projection', async () => {
    const { by } = await seed();
    await t.call('PUT', '/api/retirement/profile', { birthYear: 1990, retireAge: 65 });
    const sep = (await t.call('POST', '/api/retirement/accounts', { name: 'Vanguard SEP', type: 'sep_ira', balanceCents: 2000000, plannedAnnualCents: 1000000, expectedReturnPct: 6 })).body;
    await t.call('POST', '/api/retirement/contributions', { accountId: sep.id, transactionId: by('VANGUARD')[0] });
    const r = (await t.call('GET', '/api/retirement?year=2025')).body;
    expect(r.age).toBe(35);
    expect(r.accounts[0]).toMatchObject({ contributedThisYearCents: 500000, plannedAnnualCents: 1000000 });
    expect(r.unassigned).toHaveLength(0);
    expect(r.limits.sepMaxCents).toBeGreaterThan(1_000_000);
    expect(r.projection.atRetirement.age).toBe(65);
    expect(r.projection.years[1].balanceCents).toBe(Math.round(2000000 * 1.06 + 1000000 * 1.03));
  });

  it('feeds unpaid estimated-tax installments into the cash-flow forecast', async () => {
    const year = new Date().getFullYear();
    await t.call('POST', '/api/accounts', { name: 'Checking', type: 'checking' });
    await t.call('PUT', `/api/taxes/${year}/profile`, { filingStatus: 'single', projectionMode: 'manual', projectedProfitCents: 10000000 });
    const cf = (await t.call('GET', '/api/cashflow?days=365&typical=0')).body;
    expect(cf.events.some((e: any) => e.kind === 'tax' && e.amountCents < 0)).toBe(true);
  });
});
