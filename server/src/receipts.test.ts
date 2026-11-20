import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES_DIR, fixture } from '../../core/src/test/fixtures';
import { makeTestApp, type TestApp } from './test/helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

const file = (name: string) => ({ fileName: name, contentBase64: readFileSync(join(FIXTURES_DIR, 'receipts', name)).toString('base64') });

async function bank(content: string) {
  const acct = (await t.call('POST', '/api/accounts', { name: 'Card', type: 'credit_card' })).body.id;
  return (await t.call('POST', '/api/import/commit', { accountId: acct, fileName: 'c.csv', content })).body;
}

describe('receipts', () => {
  it('reads emailed, text and PDF receipts and links them to the right transactions', async () => {
    await bank(fixture('bank/card-capitalone-style.csv'));
    await bank('Date,Description,Amount\n10/26/2026,B&H PHOTO 800-606-6969 NY,431.92\n');
    const up = await t.call('POST', '/api/receipts', { files: [file('delta-receipt.eml'), file('hertz-receipt.txt'), file('bh-photo-receipt.pdf')] });
    expect(up.body.results.every((r: any) => r.ok)).toBe(true);
    const [delta, hertz, bh] = up.body.results.map((r: any) => r.receipt);
    expect(delta).toMatchObject({ merchant: 'Delta Air Lines', totalCents: 41230, receiptDate: '2026-09-20', matchStatus: 'matched' });
    expect(hertz).toMatchObject({ totalCents: 21560, matchStatus: 'matched' });
    expect(bh).toMatchObject({ totalCents: 43192, receiptDate: '2026-10-25', matchStatus: 'matched' });

    const list = (await t.call('GET', '/api/transactions?q=DELTA')).body.rows;
    expect(list[0].receiptCount).toBe(1);

    // Same file again is recognised as a duplicate.
    const again = await t.call('POST', '/api/receipts', { files: [file('delta-receipt.eml')] });
    expect(again.body.results[0].duplicate).toBe(true);

    // Emails and web pages download instead of rendering inside the app.
    const f = await t.app.inject({ method: 'GET', url: `/api/receipts/${delta.id}/file`, headers: { host: '127.0.0.1:4280' } });
    expect(f.headers['content-disposition']).toMatch(/^attachment/);
    const p = await t.app.inject({ method: 'GET', url: `/api/receipts/${bh.id}/file`, headers: { host: '127.0.0.1:4280' } });
    expect(p.headers['content-type']).toBe('application/pdf');
  });

  it('matches a receipt that arrived before the bank file once the bank file is imported', async () => {
    const up = await t.call('POST', '/api/receipts', { files: [file('airbnb-receipt.html')] });
    expect(up.body.results[0].receipt.matchStatus).toBe('unmatched');
    const imp = await bank('Date,Description,Amount\n11/02/2026,AIRBNB * HMXXXX 855-424-7262 CA,196.00\n');
    expect(imp.receiptsMatched).toBe(1);
    const r = (await t.call('GET', `/api/receipts/${up.body.results[0].receipt.id}`)).body;
    expect(r).toMatchObject({ matchStatus: 'matched', transaction: { merchant: 'Airbnb' } });
  });

  it('suggests when unsure, links by hand, and lists business expenses missing receipts', async () => {
    await bank('Date,Description,Amount\n10/12/2026,MARRIOTT DETROIT DOWNTOWN DETROIT MI,689.10\n10/12/2026,HILTON GARDEN INN DETROIT MI,689.10\n');
    const cats = (await t.call('GET', '/api/categories')).body as any[];
    const lodging = cats.find((c) => c.key === 'travel_lodging').id;
    const rows = (await t.call('GET', '/api/transactions')).body.rows;
    await t.call('POST', '/api/transactions/bulk', { ids: rows.map((r: any) => r.id), categoryId: lodging });
    expect((await t.call('GET', '/api/receipts/missing?year=2026')).body).toHaveLength(2);

    const txt = Buffer.from('Hotel folio\nDate: 10/12/2026\nTotal $689.10\n').toString('base64');
    const up = await t.call('POST', '/api/receipts', { files: [{ fileName: 'folio.txt', contentBase64: txt }] });
    const rec = up.body.results[0].receipt;
    expect(rec.matchStatus).toBe('suggested'); // two hotels, same amount → ask
    const detail = (await t.call('GET', `/api/receipts/${rec.id}`)).body;
    expect(detail.candidates).toHaveLength(2);
    await t.call('POST', `/api/receipts/${rec.id}/link`, { transactionId: detail.candidates[0].transactionId });
    expect((await t.call('GET', '/api/receipts/missing?year=2026')).body).toHaveLength(1);
  });

  it('imports files dropped into the receipts folder', async () => {
    const s = (await t.call('GET', '/api/receipts/email-settings')).body;
    writeFileSync(join(s.inboxFolder, 'hertz.txt'), fixture('receipts/hertz-receipt.txt'));
    writeFileSync(join(s.inboxFolder, 'notes.docx'), 'x');
    const r = (await t.call('POST', '/api/receipts/scan-inbox')).body;
    expect(r).toMatchObject({ imported: 1, skipped: ['notes.docx'] });
  });

  it('saves email settings without a password and explains what is missing', async () => {
    const s = (await t.call('PUT', '/api/receipts/email-settings', { host: 'imap.gmail.com', user: 'me@example.com', mailbox: '[Gmail]/All Mail' })).body;
    expect(s).toMatchObject({ host: 'imap.gmail.com', hasSavedPassword: false, rememberPassword: false });
    const sync = await t.call('POST', '/api/receipts/email-sync', {});
    expect(sync.status).toBe(400);
    expect(sync.body.error).toMatch(/app password/);
  });
});
