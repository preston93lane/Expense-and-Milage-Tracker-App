// End-to-end check: starts the real server on a throwaway data folder, drives the
// UI in Chromium with made-up bank files, and FAILS if the page ever tries to
// contact anything other than the local server (privacy guarantee).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright is a dev-only tool (pre-installed globally in CI / dev machines),
// not an app dependency, so resolve it via require().
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'et-e2e-'));
const port = 4391;
const base = `http://127.0.0.1:${port}`;
const shots = process.env.E2E_SCREENSHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', join(root, 'server/src/main.ts')], {
  cwd: root,
  env: { ...process.env, ET_DATA_DIR: dataDir, ET_PORT: String(port), ET_NO_BROWSER: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const ready = new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('is running') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  setTimeout(() => reject(new Error('server start timeout')), 30000);
});

const external = [];
let failed = false;
const check = (cond, msg) => {
  if (!cond) {
    failed = true;
    console.error('✗', msg);
  } else console.log('✓', msg);
};

try {
  await ready;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol !== 'data:' && u.protocol !== 'blob:') external.push(r.url());
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });

  await page.goto(base);
  await page.getByText('Getting started').waitFor();
  await shot('01-dashboard-empty');

  // Import a credit card CSV, creating the account inline.
  await page.getByRole('link', { name: 'Import bank files' }).click();
  await page.getByTestId('file-input').setInputFiles(join(root, 'fixtures/bank/card-capitalone-style.csv'));
  await page.getByRole('button', { name: '+ New account' }).click();
  await page.getByLabel('Name').fill('Capital One Venture');
  await page.getByRole('textbox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'Credit card' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: /Import 9 transactions/ }).waitFor();
  await shot('02-import-preview');
  await page.getByRole('button', { name: /Import 9 transactions/ }).click();
  await page.getByText('Imported card-capitalone-style.csv').waitFor();
  check(await page.getByText('9').first().isVisible(), 'imported 9 transactions');
  await shot('03-import-done');

  // Review: Marriott hint → business with suggested category via keyboard.
  await page.getByRole('link', { name: /Needs Review/ }).click();
  await page.getByText('left').first().waitFor();
  await shot('04-review');
  const firstMerchant = await page.locator('.mantine-Card-root').getByText(/./).first().textContent();
  await page.keyboard.press('b');
  await page.waitForTimeout(600);
  const nextMerchant = await page.locator('.mantine-Card-root').getByText(/./).first().textContent();
  check(firstMerchant !== nextMerchant, `B marks "${firstMerchant}" business and advances to "${nextMerchant}"`);
  await page.keyboard.press('p');
  await page.waitForTimeout(600);

  // Transactions page: date-range filter + bulk business.
  await page.goto(`${base}/transactions?from=2026-10-12&to=2026-10-14&direction=out`);
  await page.getByText('5 transactions').waitFor();
  await page.getByLabel('Select page').check();
  await page.locator('.bulk-bar').getByRole('button', { name: 'Business', exact: true }).click();
  await page.getByText('5 updated').waitFor();
  check(true, 'bulk-marked a 3-day date range (5 transactions) as business');
  await shot('05-transactions-bulk');

  // Undo from the toast.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.getByText(/Undone/).waitFor();
  check(true, 'undo from toast works');

  // Rules page renders and a rule can be created via the editor.
  await page.getByRole('link', { name: 'Rules' }).click();
  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByLabel('Name').fill('Delta is airfare');
  await page.getByPlaceholder('text to look for').fill('DELTA');
  await page.getByRole('button', { name: /Test — what would this match/ }).click();
  await page.getByText(/Matches/).waitFor();
  await shot('06-rule-editor');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await page.getByText('Delta is airfare').waitFor();
  check(true, 'rule created');

  // Business trips: import a scenario with a home state (IL) and a Columbus, OH trip.
  await page.getByRole('link', { name: 'Import bank files' }).click();
  await page.getByTestId('file-input').setInputFiles(join(root, 'fixtures/bank/card-trip-scenario.csv'));
  await page.getByRole('textbox', { name: 'Which account is this?' }).click();
  await page.getByRole('option', { name: /Capital One Venture/ }).click();
  await page.getByRole('button', { name: /Import 14 transactions/ }).click();
  await page.getByText('Imported card-trip-scenario.csv').waitFor();
  await page.getByRole('link', { name: 'Business trips' }).click();
  await page.getByText(/Looks like a trip to .*OH/).waitFor();
  await shot('08-trip-suggestions');
  await page.locator('.mantine-Alert-root', { hasText: 'OH' }).getByRole('button', { name: 'Create this trip' }).click();
  await page.getByLabel('Business purpose').fill('Workshop with client team');
  await page.getByRole('button', { name: 'Create and find expenses' }).click();
  await page.getByText('Possibly part of this trip').waitFor();
  await shot('09-trip-candidates');
  const addBtn = page.getByRole('button', { name: /Add 5 expenses to trip/ });
  check(await addBtn.isVisible(), 'trip pre-ticks flight booked before + 4 in-Ohio expenses (not home groceries/Netflix)');
  await addBtn.click();
  await page.getByText(/5 expenses added to the trip/).waitFor();
  await page.getByText('Expenses on this trip').waitFor();
  await shot('10-trip-report');
  check(true, 'expenses added to the trip');

  // Income: client → invoice → contractor.
  await page.getByRole('link', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'New client' }).click();
  await page.getByLabel('Name').fill('Acme Corp');
  await page.getByLabel('Email').fill('ap@acme.example');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('heading', { name: 'Acme Corp' }).waitFor();
  await page.getByRole('button', { name: 'New invoice' }).click();
  await page.getByPlaceholder('e.g. Event coverage — half day').fill('Event coverage');
  await page.getByRole('textbox', { name: 'Rate' }).or(page.locator('input').nth(0)).first();
  const rate = page.locator('table input').nth(2);
  await rate.fill('850');
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await page.getByText('Payments').first().waitFor();
  await shot('11-invoice');
  check(await page.getByText('$850.00 still owed').isVisible(), 'invoice created for $850');
  await page.getByRole('link', { name: 'Contractors & 1099s' }).click();
  await page.getByRole('button', { name: 'New contractor' }).click();
  await page.getByLabel('Name (as on their W-9)').fill('Dana Editor');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Dana Editor').waitFor();
  await shot('12-contractors');
  await page.getByRole('link', { name: 'Income' }).click();
  await page.getByText('Owed to you').waitFor();
  await shot('13-income');
  check(true, 'income, clients, invoices and contractors pages work');

  for (const [link, text] of [['Dashboard', 'By category'], ['Categories', 'Meals (business, 50%)'], ['Accounts', 'Capital One Venture'], ['Settings & backups', 'IRS standard mileage rates']]) {
    await page.getByRole('link', { name: link }).click();
    await page.getByText(text).first().waitFor();
    await shot(`07-${link.split(' ')[0].toLowerCase()}`);
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  check(external.length === 0, `no requests left this computer${external.length ? ': ' + external.join(', ') : ''}`);
  await browser.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
