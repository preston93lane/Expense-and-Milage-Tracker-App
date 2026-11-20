import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './test/helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const CSV = [
  'Date,Description,Amount',
  '02/01/2026,ACME CORP ACH PAYMENT PPD ID 99,2500.00',
  '03/01/2026,ZELLE PAYMENT TO DANA EDITOR,-1500.00',
  '04/01/2026,ACME CORP ACH PAYMENT PPD ID 99,1000.00',
  '05/01/2026,ACME CORP ACH PAYMENT PPD ID 99,1000.00',
  '06/01/2026,ZELLE PAYMENT TO DANA EDITOR,-800.00',
  '06/15/2026,PAYPAL *DANAEDITS,-500.00',
  '07/01/2026,STRIPE TRANSFER ST-XYZ,1200.00',
].join('\n');

async function setup() {
  const acct = (await t.call('POST', '/api/accounts', { name: 'Checking', type: 'checking' })).body.id;
  await t.call('POST', '/api/import/commit', { accountId: acct, fileName: 'c.csv', content: CSV });
  const cats = (await t.call('GET', '/api/categories')).body as { id: number; key: string }[];
  const cat = (k: string) => cats.find((c) => c.key === k)!.id;
  const rows = (await t.call('GET', '/api/transactions?sort=date_asc')).body.rows as any[];
  return { acct, cat, rows };
}

describe('clients, invoices and income', () => {
  it('links a deposit to an invoice, tags the client, and learns the payer', async () => {
    const { cat, rows } = await setup();
    const acme = (await t.call('POST', '/api/clients', { name: 'Acme Corp', email: 'ap@acme.example' })).body;
    expect((await t.call('POST', '/api/clients', { name: 'acme corp' })).status).toBe(400);

    const inv = await t.call('POST', '/api/invoices', {
      clientId: acme.id,
      issueDate: '2026-01-15',
      lines: [
        { description: 'Shoot day', quantity: 2, unitCents: 100000 },
        { description: 'Editing', quantity: 1, unitCents: 50000 },
      ],
    });
    expect(inv.status).toBe(200);
    expect(inv.body).toMatchObject({ totalCents: 250000, state: 'overdue', number: 'INV-1001', dueDate: '2026-02-14' });

    // The $2,500 deposit is offered as the payment.
    const list = (await t.call('GET', '/api/invoices?state=unpaid')).body;
    expect(list[0].candidates.map((c: any) => c.id)).toEqual([rows[0].id]);
    const paid = await t.call('POST', `/api/invoices/${inv.body.id}/payments`, { transactionId: rows[0].id });
    expect(paid.body).toMatchObject({ state: 'paid', balanceCents: 0 });

    const dep = (await t.call('GET', `/api/transactions/${rows[0].id}`)).body;
    expect(dep).toMatchObject({ status: 'reviewed', classification: 'business', clientId: acme.id, categoryId: cat('income') });

    // The other ACME deposits are now suggested as income from Acme (history).
    const second = (await t.call('GET', `/api/transactions/${rows[2].id}`)).body;
    expect(second).toMatchObject({ status: 'suggested', classification: 'business', clientId: acme.id });

    // Can't link the same deposit twice.
    const inv2 = await t.call('POST', '/api/invoices', { clientId: acme.id, issueDate: '2026-01-20', lines: [{ description: 'x', quantity: 1, unitCents: 250000 }] });
    expect((await t.call('POST', `/api/invoices/${inv2.body.id}/payments`, { transactionId: rows[0].id })).status).toBe(400);
  });

  it('tracks retainers against deposits and summarises income vs goal', async () => {
    const { cat, rows } = await setup();
    const acme = (await t.call('POST', '/api/clients', { name: 'Acme Corp' })).body;
    await t.call('POST', '/api/retainers', { clientId: acme.id, name: 'Monthly retainer', amountCents: 100000, frequency: 'monthly', startDate: '2026-04-01', endDate: '2026-06-30' });
    await t.call('POST', '/api/transactions/bulk', { ids: [rows[2].id, rows[3].id], categoryId: cat('income'), clientId: acme.id });
    const sched = (await t.call('GET', '/api/retainers/schedule?from=2026-04-01&to=2026-06-30')).body;
    expect(sched.map((e: any) => e.status)).toEqual(['received', 'received', 'missed']);

    await t.call('POST', '/api/transactions/bulk', { ids: [rows[6].id], categoryId: cat('income'), clientId: acme.id });
    await t.call('PUT', '/api/income/goal/2026', { amountCents: 10000000 });
    const sum = (await t.call('GET', '/api/income/summary?year=2026')).body;
    expect(sum.incomeCents).toBe(100000 + 100000 + 120000);
    expect(sum.goalCents).toBe(10000000);
    expect(sum.byClient[0]).toMatchObject({ name: 'Acme Corp', incomeCents: 320000 });

    // Stripe deposits count as processor (1099-K), bank ACH as direct.
    const c1099 = (await t.call('GET', '/api/reports/client-1099s?year=2026')).body;
    expect(c1099.rows[0]).toMatchObject({ directCents: 200000, processorCents: 120000, expect1099Nec: true });

    const detail = (await t.call('GET', `/api/clients/${acme.id}?year=2026`)).body;
    expect(detail.incomeCents).toBe(320000);
    expect(detail.monthly[3].incomeCents).toBe(100000);
  });
});

describe('contractors and 1099-NEC', () => {
  it('counts direct payments toward the $2,000 (2026) threshold and exports the report', async () => {
    const { cat, rows } = await setup();
    const dana = (await t.call('POST', '/api/contractors', { name: 'Dana Editor', entityType: 'individual', tinLast4: '123-45-6789' })).body;
    expect(dana.tinLast4).toBe('6789'); // only the last 4 digits are ever stored
    const payIds = [rows[1].id, rows[4].id, rows[5].id];
    await t.call('POST', '/api/transactions/bulk', { ids: payIds, categoryId: cat('contract_labor'), contractorId: dana.id });

    const list = (await t.call('GET', '/api/contractors?year=2026')).body;
    expect(list[0].summary).toMatchObject({ directCents: 230000, processorCents: 50000, needs1099: true });
    expect(list[0].summary.warnings.join(' ')).toMatch(/W-9/);

    // Override: the PayPal payment was actually "friends & family" → direct.
    await t.call('POST', '/api/transactions/bulk', { ids: [rows[5].id], paymentMethod: 'direct' });
    const after = (await t.call('GET', `/api/contractors/${dana.id}?year=2026`)).body;
    expect(after.summary.directCents).toBe(280000);
    expect(after.payments.find((p: any) => p.id === rows[5].id)).toMatchObject({ method: 'direct', methodInferred: false });

    const report = (await t.call('GET', '/api/reports/1099-nec?year=2026')).body;
    expect(report).toMatchObject({ thresholdCents: 200000, deadline: '2027-02-01', needCount: 1 });

    const csv = await t.app.inject({ method: 'GET', url: '/api/reports/1099-nec.csv?year=2026', headers: { host: '127.0.0.1:4280' } });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Dana Editor');
    expect(csv.body).toContain('2800.00');

    // Same payments in 2025 would have crossed the old $600 threshold too; in 2026 a $1,500 total would not.
    await t.call('POST', '/api/transactions/bulk', { ids: [rows[4].id, rows[5].id], contractorId: null });
    const small = (await t.call('GET', `/api/contractors/${dana.id}?year=2026`)).body;
    expect(small.summary).toMatchObject({ directCents: 150000, needs1099: false, approaching: true });
  });

  it('rules can tag a contractor automatically', async () => {
    const { cat } = await setup();
    const dana = (await t.call('POST', '/api/contractors', { name: 'Dana Editor' })).body;
    const r = await t.call('POST', '/api/rules', {
      name: 'Dana payments',
      conditions: { match: 'all', items: [{ field: 'description', op: 'contains', value: 'DANA' }] },
      actions: { classification: 'business', categoryId: cat('contract_labor'), contractorId: dana.id },
    });
    expect(r.status).toBe(200);
    const tagged = (await t.call('GET', `/api/transactions?contractorId=${dana.id}`)).body;
    expect(tagged.total).toBe(3);
  });
});

describe('trip profitability', () => {
  it('computes income (deposits, invoices, agreed fee), costs and profit per trip', async () => {
    const acct = (await t.call('POST', '/api/accounts', { name: 'Card', type: 'credit_card' })).body.id;
    await t.call('POST', '/api/import/commit', {
      accountId: acct,
      fileName: 'trip.csv',
      content: [
        'Date,Description,Amount',
        '10/12/2026,HERTZ RENT-A-CAR ROMULUS MI,-200.00',
        '10/13/2026,MARRIOTT DETROIT DOWNTOWN DETROIT MI,-600.00',
        '10/20/2026,ACME CORP ACH PAYMENT,1500.00',
      ].join('\n'),
    });
    const acme = (await t.call('POST', '/api/clients', { name: 'Acme Corp' })).body;
    const trip = (await t.call('POST', '/api/trips', { name: 'Detroit', startDate: '2026-10-12', endDate: '2026-10-15', destState: 'MI', clientId: acme.id, agreedFeeCents: 250000 })).body;
    expect(trip).toMatchObject({ clientId: acme.id, agreedFeeCents: 250000 });

    let d = (await t.call('GET', `/api/trips/${trip.id}`)).body;
    const expenseItems = d.candidates.filter((c: any) => c.transaction.amountCents < 0);
    await t.call('POST', `/api/trips/${trip.id}/assign`, { items: expenseItems.map((c: any) => ({ id: c.transaction.id, categoryId: c.suggestedCategoryId })) });

    d = (await t.call('GET', `/api/trips/${trip.id}`)).body;
    expect(d.profit).toMatchObject({ incomeCents: 250000, incomeSource: 'agreed_fee', incomeIsEstimate: true, costCents: 80000, profitCents: 170000, days: 4 });

    // Tag the client's deposit to the trip (it's offered as a candidate) → real income replaces the estimate.
    const dep = d.incomeCandidates.find((x: any) => x.amountCents === 150000);
    expect(dep).toBeTruthy();
    const cats = (await t.call('GET', '/api/categories')).body as any[];
    await t.call('POST', '/api/transactions/bulk', { ids: [dep.id], categoryId: cats.find((c) => c.key === 'income').id, tripId: trip.id });
    // And an unpaid invoice for the rest.
    await t.call('POST', '/api/invoices', { clientId: acme.id, tripId: trip.id, issueDate: '2026-10-20', lines: [{ description: 'Balance', quantity: 1, unitCents: 100000 }] });
    d = (await t.call('GET', `/api/trips/${trip.id}`)).body;
    expect(d.profit).toMatchObject({ receivedCents: 150000, invoicedOpenCents: 100000, incomeCents: 250000, incomeSource: 'received+invoiced', costCents: 80000 });
    expect(d.totals.totalCents).toBe(80000); // income is not counted as an expense
    expect(d.income).toHaveLength(1);

    const list = (await t.call('GET', '/api/trips')).body;
    expect(list[0]).toMatchObject({ clientName: 'Acme Corp' });
    expect(list[0].profit.profitCents).toBe(170000);
  });
});
