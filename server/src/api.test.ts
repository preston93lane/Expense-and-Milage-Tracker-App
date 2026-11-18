import { existsSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '../../core/src/test/fixtures';
import { makeTestApp, type TestApp } from './test/helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

async function account(name: string, type: string) {
  const res = await t.call('POST', '/api/accounts', { name, type });
  expect(res.status).toBe(200);
  return res.body.id as number;
}

async function importFile(accountId: number, file: string, extra: Record<string, unknown> = {}) {
  const res = await t.call('POST', '/api/import/commit', {
    accountId,
    fileName: file,
    content: fixture(`bank/${file}`),
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function categoryId(key: string): Promise<number> {
  const cats = (await t.call('GET', '/api/categories')).body as { id: number; key: string }[];
  return cats.find((c) => c.key === key)!.id;
}

describe('setup', () => {
  it('creates the schema, seeds categories and mileage rates', async () => {
    const cats = await t.call('GET', '/api/categories');
    expect(cats.body.length).toBeGreaterThan(30);
    expect(cats.body.find((c: any) => c.key === 'meals').deductiblePct).toBe(50);
    const rates = await t.call('GET', '/api/mileage-rates');
    expect(rates.body.map((r: any) => r.centsPerMile)).toContain(72.5);
    const meta = await t.call('GET', '/api/meta');
    expect(meta.body.schemaVersion).toBe(1);
  });
});

describe('security', () => {
  it('rejects unknown Host headers (DNS rebinding)', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example.com' } });
    expect(res.statusCode).toBe(421);
  });

  it('rejects cross-origin writes', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { host: '127.0.0.1:4280', origin: 'https://evil.example.com', 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x', type: 'checking' }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects form-style posts that skip CORS preflight', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { host: '127.0.0.1:4280', 'content-type': 'text/plain' },
      payload: '{"name":"x","type":"checking"}',
    });
    expect(res.statusCode).toBe(415);
  });

  it('sends a strict Content-Security-Policy', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:4280' } });
    expect(res.headers['content-security-policy']).toContain("connect-src 'self'");
  });
});

describe('import flow', () => {
  it('previews, imports, skips duplicates on re-import, and can be undone', async () => {
    const card = await account('Capital One', 'credit_card');
    const content = fixture('bank/card-capitalone-style.csv');

    const preview = await t.call('POST', '/api/import/preview', { accountId: card, fileName: 'a.csv', content });
    expect(preview.status).toBe(200);
    expect(preview.body.kind).toBe('csv');
    expect(preview.body.counts).toMatchObject({ total: 9, new: 9, duplicates: 0 });

    const first = await importFile(card, 'card-capitalone-style.csv');
    expect(first.newCount).toBe(9);
    // The original file is archived privately in the data folder.
    expect(readdirSync(t.ctx.paths.importsDir).length).toBe(1);

    const again = await importFile(card, 'card-capitalone-style.csv');
    expect(again.newCount).toBe(0);
    expect(again.duplicateCount).toBe(9);

    const preview2 = await t.call('POST', '/api/import/preview', { accountId: card, fileName: 'a.csv', content });
    expect(preview2.body.warnings.join(' ')).toContain('already imported this exact file');

    const batches = await t.call('GET', '/api/import/batches');
    expect(batches.body).toHaveLength(2);
    const undo = await t.call('DELETE', `/api/import/batches/${first.batchId}`);
    expect(undo.body.removed).toBe(9);
    const list = await t.call('GET', '/api/transactions');
    expect(list.body.total).toBe(0);
  });

  it('remembers the CSV layout per account (including flipped signs)', async () => {
    const amex = await account('Amex', 'credit_card');
    await importFile(amex, 'card-amex-style.csv');
    const accounts = await t.call('GET', '/api/accounts');
    expect(accounts.body[0].hasSavedMapping).toBe(true);
    const list = await t.call('GET', `/api/transactions?accountId=${amex}&q=NETFLIX`);
    expect(list.body.rows[0].amountCents).toBe(-1549);
  });

  it('imports OFX/QFX and suggests the account by number', async () => {
    const card = await account('Visa', 'credit_card');
    await t.call('PATCH', `/api/accounts/${card}`, { last4: '9876' });
    const preview = await t.call('POST', '/api/import/preview', { fileName: 's.qfx', content: fixture('bank/statement-sgml.qfx') });
    expect(preview.body.kind).toBe('ofx');
    expect(preview.body.suggestedAccountId).toBe(card);
    const res = await importFile(card, 'statement-sgml.qfx');
    expect(res.newCount).toBe(4);
  });

  it('pairs a checking card-payment with the card-side credit as a transfer', async () => {
    const checking = await account('Checking', 'checking');
    const card = await account('Card', 'credit_card');
    await importFile(checking, 'checking-chase-style.csv');
    const res = await importFile(card, 'card-capitalone-style.csv');
    expect(res.transfersPaired).toBe(1);
    const transfers = await t.call('GET', '/api/transactions?classification=transfer');
    const paired = transfers.body.rows.filter((r: any) => r.transferPairId);
    expect(paired.map((r: any) => r.amountCents).sort()).toEqual([-81240, 81240]);
  });

  it('imports history files (e.g. QuickBooks export) as already reviewed', async () => {
    const acct = await account('Old QBSE data', 'checking');
    const preview = await t.call('POST', '/api/import/preview', {
      accountId: acct, fileName: 'h.csv', content: fixture('bank/history-with-categories.csv'), historyMode: true,
    });
    const travelLabel = preview.body.categoryLabels.find((l: any) => l.label === 'Travel');
    expect(travelLabel.categoryId).toBe(await categoryId('travel_airfare'));
    await importFile(acct, 'history-with-categories.csv', { historyMode: true });
    const list = await t.call('GET', '/api/transactions?status=reviewed');
    expect(list.body.total).toBe(3);
    const kroger = list.body.rows.find((r: any) => r.merchant === 'Kroger');
    expect(kroger.classification).toBe('personal');
  });
});

describe('reviewing and learning', () => {
  it('bulk-marks business, learns the merchant, and undo restores', async () => {
    const checking = await account('Checking', 'checking');
    await importFile(checking, 'checking-chase-style.csv');
    const kroger = (await t.call('GET', '/api/transactions?q=KROGER')).body.rows;
    expect(kroger).toHaveLength(2);

    // Mark the first Kroger personal → the second one is now *suggested* personal.
    const res = await t.call('POST', '/api/transactions/bulk', { ids: [kroger[0].id], classification: 'personal' });
    expect(res.body.updated).toBe(1);
    expect(res.body.relearned).toBeGreaterThanOrEqual(1);
    const second = (await t.call('GET', `/api/transactions/${kroger[1].id}`)).body;
    expect(second).toMatchObject({ status: 'suggested', classification: 'personal', source: 'history' });

    // Approve suggestion.
    await t.call('POST', '/api/transactions/bulk', { ids: [kroger[1].id], approve: true });
    expect((await t.call('GET', `/api/transactions/${kroger[1].id}`)).body.status).toBe('reviewed');

    // Undo the first action.
    const actions = (await t.call('GET', '/api/actions')).body;
    const firstAction = actions[actions.length - 1];
    await t.call('POST', `/api/actions/${firstAction.id}/undo`);
    // It goes back to exactly what it was before: a keyword *suggestion*, not reviewed.
    expect((await t.call('GET', `/api/transactions/${kroger[0].id}`)).body).toMatchObject({ status: 'suggested', source: 'keyword' });
  });

  it('acts on everything matching a filter (date-range grouping)', async () => {
    const card = await account('Card', 'credit_card');
    await importFile(card, 'card-capitalone-style.csv');
    const travel = await categoryId('travel_other');
    const res = await t.call('POST', '/api/transactions/bulk', {
      filters: { from: '2026-10-12', to: '2026-10-14', direction: 'out' },
      categoryId: travel,
    });
    expect(res.body.updated).toBe(5); // Hertz, Marriott (12th), Slows (13th), Shell, Uber (14th)
  });

  it('creates an "always do this" rule from a transaction and applies it to future imports', async () => {
    const card = await account('Card', 'credit_card');
    await importFile(card, 'card-capitalone-style.csv');
    const software = await categoryId('software');
    const adobe = (await t.call('GET', '/api/transactions?q=ADOBE')).body.rows[0];
    await t.call('POST', '/api/transactions/bulk', { ids: [adobe.id], categoryId: software });
    const rule = await t.call('POST', '/api/rules/from-transaction', { transactionId: adobe.id });
    expect(rule.status).toBe(200);
    expect(rule.body.rule.name).toBe('Adobe → Software & subscriptions');

    // A new account's Adobe charge is auto-confirmed by the rule.
    const amex = await account('Amex', 'credit_card');
    const content = 'Date,Description,Amount\n11/22/2026,ADOBE *ACROPRO 408-536-6000 CA,19.99\n';
    const commit = await t.call('POST', '/api/import/commit', { accountId: amex, fileName: 'n.csv', content });
    expect(commit.body.autoReviewed).toBe(1);
    const row = (await t.call('GET', `/api/transactions?accountId=${amex}`)).body.rows[0];
    expect(row).toMatchObject({ status: 'reviewed', classification: 'business', categoryId: software, source: 'rule' });
  });

  it('tests a rule before saving and supports percentage splits', async () => {
    const checking = await account('BofA', 'checking');
    await importFile(checking, 'checking-bofa-summary.csv');
    const phone = await categoryId('phone_internet');
    const conditions = { match: 'all', items: [{ field: 'description', op: 'contains', value: 'verizon' }] };
    const test = await t.call('POST', '/api/rules/test', { conditions });
    expect(test.body.count).toBe(1);
    await t.call('POST', '/api/rules', {
      name: 'Phone 60% business',
      conditions,
      actions: { classification: 'business', categoryId: phone, businessPct: 60 },
    });
    const row = (await t.call('GET', '/api/transactions?q=VERIZON')).body.rows[0];
    expect(row.isSplit).toBe(true);
    expect(row.splits.map((s: any) => s.amountCents)).toEqual([-5100, -3400]);
  });

  it('splits manually and rejects lines that do not add up', async () => {
    const checking = await account('BofA', 'checking');
    await importFile(checking, 'checking-bofa-summary.csv');
    const row = (await t.call('GET', '/api/transactions?q=PARKMOBILE')).body.rows[0];
    const parking = await categoryId('parking_tolls');
    const bad = await t.call('PUT', `/api/transactions/${row.id}/splits`, {
      splits: [
        { amountCents: -100, classification: 'business', categoryId: parking },
        { amountCents: -100, classification: 'personal', categoryId: null },
      ],
    });
    expect(bad.status).toBe(400);
    const ok = await t.call('PUT', `/api/transactions/${row.id}/splits`, {
      splits: [
        { amountCents: -40000, classification: 'business', categoryId: parking },
        { amountCents: -1500, classification: 'personal', categoryId: null },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.isSplit).toBe(true);
  });
});

describe('dashboard', () => {
  it('totals reviewed business lines with meals at 50%', async () => {
    const card = await account('Card', 'credit_card');
    await importFile(card, 'card-capitalone-style.csv');
    const meals = await categoryId('travel_meals');
    const lodging = await categoryId('travel_lodging');
    const rows = (await t.call('GET', '/api/transactions')).body.rows;
    const slows = rows.find((r: any) => r.merchant.startsWith('Slows'));
    const marriott = rows.filter((r: any) => r.merchant === 'Marriott').map((r: any) => r.id);
    await t.call('POST', '/api/transactions/bulk', { ids: [slows.id], categoryId: meals });
    await t.call('POST', '/api/transactions/bulk', { ids: marriott, categoryId: lodging });
    const d = (await t.call('GET', '/api/dashboard?year=2026')).body;
    // Lodging 689.10 - 50.00 refund = 639.10; meals 48.75 → 24.38 deductible (rounded)
    expect(d.expenseCents).toBe(63910 + 4875);
    expect(d.deductibleCents).toBe(63910 + 2438);
  });
});

describe('backups', () => {
  it('creates and restores a backup (with a safety copy)', async () => {
    await account('Before', 'checking');
    const b = await t.call('POST', '/api/backups', { label: 'test' });
    expect(existsSync(`${t.ctx.paths.backupsDir}/${b.body.name}`)).toBe(true);
    await account('After', 'checking');
    const r = await t.call('POST', '/api/backups/restore', { name: b.body.name });
    expect(r.status).toBe(200);
    const accts = (await t.call('GET', '/api/accounts')).body;
    expect(accts.map((a: any) => a.name)).toEqual(['Before']);
    expect((await t.call('GET', '/api/backups')).body.length).toBe(2);
  });
});
