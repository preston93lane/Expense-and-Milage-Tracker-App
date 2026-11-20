import { addDays, todayIso } from '@et/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './test/helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const today = todayIso();
const us = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
// Monthly subscriptions dated relative to today so the test doesn't age.
const months = [5, 4, 3, 2, 1].map((n) => addDays(today, -30 * n - 2));

function csv() {
  const rows = ['Date,Description,Amount,Balance'];
  for (const d of months) {
    rows.push(`${us(d)},ADOBE *CREATIVE CLD 408-536-6000 CA,-59.99,`);
    rows.push(`${us(d)},CALENDLY SUBSCRIPTION,-12.00,`);
  }
  rows.push(`${us(addDays(today, -5))},WHOLE FOODS MARKET,-120.00,`);
  rows.push(`${us(addDays(today, -1))},COFFEE SHOP,-6.00,4200.00`);
  return rows.join('\n');
}

describe('subscriptions, cash flow and budgets', () => {
  it('detects subscriptions, saves your choices, and exports a list to discuss', async () => {
    const acct = (await t.call('POST', '/api/accounts', { name: 'Checking', type: 'checking' })).body.id;
    const imp = await t.call('POST', '/api/import/commit', { accountId: acct, fileName: 'c.csv', content: csv() });
    expect(imp.status).toBe(200);

    // The running-balance column set the account balance.
    const accounts = (await t.call('GET', '/api/accounts')).body;
    expect(accounts[0]).toMatchObject({ balanceCents: 420000, balanceDate: addDays(today, -1) });

    const subs = (await t.call('GET', '/api/subscriptions')).body;
    const names = subs.series.map((s: any) => s.merchantKey).sort();
    expect(names).toEqual(['ADOBE', 'CALENDLY SUBSCRIPTION']);
    const calendly = subs.series.find((s: any) => s.merchantKey.startsWith('CALENDLY'));
    expect(calendly.idea.approach).toBe('agent_workflow');
    expect(subs.totals.yearlyCents).toBe(Math.round((5999 * 365.25) / 30.44) + Math.round((1200 * 365.25) / 30.44));

    await t.call('PUT', '/api/subscriptions/prefs', { seriesKey: calendly.seriesKey, status: 'replace', note: 'Use Google appointment schedule' });
    const after = (await t.call('GET', '/api/subscriptions')).body;
    expect(after.series.find((s: any) => s.merchantKey.startsWith('CALENDLY'))).toMatchObject({ pref: 'replace', note: 'Use Google appointment schedule' });
    expect(after.totals.replaceYearlyCents).toBeGreaterThan(0);

    const md = (await t.call('GET', '/api/subscriptions/export-text')).body.markdown as string;
    expect(md).toContain('| Adobe |');
    expect(md).not.toMatch(/Checking/); // account names never appear

    // Cancelling removes it from totals and the forecast.
    await t.call('PUT', '/api/subscriptions/prefs', { seriesKey: calendly.seriesKey, status: 'cancelled' });
    const cf = (await t.call('GET', '/api/cashflow?days=60&typical=0')).body;
    expect(cf.startCents).toBe(420000);
    expect(cf.events.some((e: any) => e.label.startsWith('Calendly'))).toBe(false);
    expect(cf.events.filter((e: any) => e.label === 'Adobe').length).toBeGreaterThanOrEqual(1);
  });

  it('forecasts cash from balances, retainers, invoices, planned items and typical spending', async () => {
    const acct = (await t.call('POST', '/api/accounts', { name: 'Checking', type: 'checking' })).body.id;
    const card = (await t.call('POST', '/api/accounts', { name: 'Card', type: 'credit_card' })).body.id;
    await t.call('PATCH', `/api/accounts/${acct}`, { balanceCents: 500000, balanceDate: today });
    await t.call('PATCH', `/api/accounts/${card}`, { balanceCents: -80000, balanceDate: today });
    const acme = (await t.call('POST', '/api/clients', { name: 'Acme' })).body;
    await t.call('POST', '/api/retainers', { clientId: acme.id, name: 'Monthly', amountCents: 200000, frequency: 'monthly', startDate: addDays(today, 10) });
    await t.call('POST', '/api/invoices', { clientId: acme.id, issueDate: today, dueDate: addDays(today, 20), lines: [{ description: 'Shoot', quantity: 1, unitCents: 100000 }] });
    await t.call('POST', '/api/planned', { date: addDays(today, 15), amountCents: -300000, description: 'New camera body' });
    const cf = (await t.call('GET', '/api/cashflow?days=30&typical=0')).body;
    expect(cf).toMatchObject({ cashCents: 500000, cardCents: -80000, startCents: 420000 });
    expect(cf.endCents).toBe(420000 + 200000 + 100000 - 300000);
    expect(cf.lowest.balanceCents).toBe(420000 + 200000 - 300000);
    expect(cf.events.map((e: any) => e.kind).sort()).toEqual(['invoice', 'planned', 'retainer']);
  });

  it('tracks budgets against this month’s business spending', async () => {
    const acct = (await t.call('POST', '/api/accounts', { name: 'Checking', type: 'checking' })).body.id;
    const month = today.slice(0, 7);
    await t.call('POST', '/api/import/commit', {
      accountId: acct,
      fileName: 'b.csv',
      content: `Date,Description,Amount\n${us(`${month}-01`)},OFFICE DEPOT #1 CHICAGO IL,-90.00\n`,
    });
    const cats = (await t.call('GET', '/api/categories')).body as any[];
    const office = cats.find((c) => c.key === 'office').id;
    const tx = (await t.call('GET', '/api/transactions')).body.rows[0];
    await t.call('POST', '/api/transactions/bulk', { ids: [tx.id], categoryId: office });
    await t.call('PUT', '/api/budgets', { scope: 'category', categoryId: office, monthlyCents: 10000 });
    await t.call('PUT', '/api/budgets', { scope: 'category', categoryId: office, monthlyCents: 8000 }); // upsert
    const b = (await t.call('GET', `/api/budgets?month=${month}`)).body;
    expect(b.budgets).toHaveLength(1);
    expect(b.budgets[0]).toMatchObject({ name: 'Office expenses & postage', spentCents: 9000, budgetCents: 8000, status: 'over' });
  });
});
