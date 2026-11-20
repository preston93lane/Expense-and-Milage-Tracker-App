import {
  APPROACH_LABEL,
  contractor1099,
  contributionLimits,
  inferPaymentMethod,
  necThresholdCents,
  projectRetirement,
  todayIso,
  type RetirementAccountType,
} from '@et/core';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, optInt, optStr, toInt, type AppContext } from '../context';
import { getSetting, setSetting } from '../db/database';
import { taxSummary, yearRange } from '../services/taxService';

type Row = Record<string, any>;
const ACCOUNT_TYPES: RetirementAccountType[] = ['sep_ira', 'solo_401k', 'traditional_ira', 'roth_ira', '401k', 'hsa', 'brokerage', 'other'];

function centsOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) badRequest('Amounts must be numbers');
  return n;
}

export function taxRoutes(app: FastifyInstance, ctx: AppContext) {
  // ----- Taxes -----
  app.get('/api/taxes/:year', async (req) => taxSummary(ctx.db, toInt((req.params as Row).year, 'year')));

  app.put('/api/taxes/:year/profile', async (req) => {
    const year = toInt((req.params as Row).year, 'year');
    const b = (req.body ?? {}) as Row;
    const status = optStr(b.filingStatus) ?? 'single';
    if (!['single', 'mfj', 'mfs', 'hoh'].includes(status)) badRequest('Unknown filing status');
    const mode = optStr(b.projectionMode) ?? 'pace';
    if (!['pace', 'ytd', 'manual'].includes(mode)) badRequest('Unknown projection mode');
    const rate = Number(b.stateRatePct ?? 0);
    if (!(rate >= 0 && rate <= 20)) badRequest('State rate must be 0–20%');
    ctx.db
      .prepare(
        `INSERT INTO tax_profiles (year, filing_status, w2_wages_cents, other_income_cents, withholding_cents, prior_year_tax_cents,
                                   prior_year_agi_cents, state_rate_pct, projection_mode, projected_profit_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(year) DO UPDATE SET filing_status = excluded.filing_status, w2_wages_cents = excluded.w2_wages_cents,
           other_income_cents = excluded.other_income_cents, withholding_cents = excluded.withholding_cents,
           prior_year_tax_cents = excluded.prior_year_tax_cents, prior_year_agi_cents = excluded.prior_year_agi_cents,
           state_rate_pct = excluded.state_rate_pct, projection_mode = excluded.projection_mode,
           projected_profit_cents = excluded.projected_profit_cents`,
      )
      .run(
        year,
        status,
        centsOrNull(b.w2WagesCents) ?? 0,
        centsOrNull(b.otherIncomeCents) ?? 0,
        centsOrNull(b.withholdingCents) ?? 0,
        centsOrNull(b.priorYearTaxCents),
        centsOrNull(b.priorYearAgiCents),
        rate,
        mode,
        centsOrNull(b.projectedProfitCents),
      );
    return taxSummary(ctx.db, year);
  });

  app.put('/api/taxes/:year/home-office', async (req) => {
    const year = toInt((req.params as Row).year, 'year');
    const b = (req.body ?? {}) as Row;
    const method = optStr(b.method) ?? 'simplified';
    if (!['simplified', 'actual'].includes(method)) badRequest('Unknown method');
    const office = Number(b.officeSqft ?? 0);
    const home = Number(b.homeSqft ?? 0);
    const months = optInt(b.monthsUsed) ?? 12;
    if (!(office >= 0) || !(home >= 0) || months < 0 || months > 12) badRequest('Check the square footage and months');
    if (home > 0 && office > home) badRequest('The office can’t be bigger than the home');
    ctx.db
      .prepare(
        `INSERT INTO home_office (year, method, office_sqft, home_sqft, months_used) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(year) DO UPDATE SET method = excluded.method, office_sqft = excluded.office_sqft,
           home_sqft = excluded.home_sqft, months_used = excluded.months_used`,
      )
      .run(year, method, office, home, months);
    return taxSummary(ctx.db, year);
  });

  // ----- Retirement -----
  function retirementProfile() {
    return {
      birthYear: getSetting<number | null>(ctx.db, 'retire_birth_year', null),
      retireAge: getSetting<number>(ctx.db, 'retire_age', 65),
      inflationPct: getSetting<number>(ctx.db, 'retire_inflation_pct', 3),
      withdrawalPct: getSetting<number>(ctx.db, 'retire_withdrawal_pct', 4),
    };
  }

  app.put('/api/retirement/profile', async (req) => {
    const b = (req.body ?? {}) as Row;
    const thisYear = new Date().getFullYear();
    if (b.birthYear !== undefined) {
      const by = b.birthYear === null || b.birthYear === '' ? null : toInt(b.birthYear, 'birthYear');
      if (by !== null && (by < thisYear - 100 || by > thisYear - 14)) badRequest('Check the birth year');
      setSetting(ctx.db, 'retire_birth_year', by);
    }
    if (b.retireAge !== undefined) {
      const a = toInt(b.retireAge, 'retireAge');
      if (a < 30 || a > 90) badRequest('Retirement age must be 30–90');
      setSetting(ctx.db, 'retire_age', a);
    }
    for (const [k, key, max] of [
      ['inflationPct', 'retire_inflation_pct', 15],
      ['withdrawalPct', 'retire_withdrawal_pct', 15],
    ] as const) {
      if (b[k] !== undefined) {
        const v = Number(b[k]);
        if (!(v >= 0 && v <= max)) badRequest(`${k} must be 0–${max}%`);
        setSetting(ctx.db, key, v);
      }
    }
    return retirementProfile();
  });

  function readAccount(b: Row, existing?: Row) {
    const type = optStr(b.type) ?? existing?.type ?? 'sep_ira';
    if (!ACCOUNT_TYPES.includes(type as RetirementAccountType)) badRequest('Unknown account type');
    const ret = b.expectedReturnPct !== undefined ? Number(b.expectedReturnPct) : existing?.expected_return_pct ?? 6;
    if (!(ret >= -10 && ret <= 20)) badRequest('Expected return must be between -10% and 20%');
    return {
      name: optStr(b.name) ?? existing?.name,
      type,
      balance: b.balanceCents !== undefined ? centsOrNull(b.balanceCents) ?? 0 : existing?.balance_cents ?? 0,
      balanceDate: b.balanceCents !== undefined ? optStr(b.balanceDate) ?? todayIso() : existing?.balance_date ?? null,
      ret,
      planned: b.plannedAnnualCents !== undefined ? centsOrNull(b.plannedAnnualCents) ?? 0 : existing?.planned_annual_cents ?? 0,
      notes: b.notes !== undefined ? optStr(b.notes) ?? null : existing?.notes ?? null,
      archived: b.archived !== undefined ? (b.archived ? 1 : 0) : existing?.archived ?? 0,
    };
  }

  app.post('/api/retirement/accounts', async (req) => {
    const a = readAccount((req.body ?? {}) as Row);
    if (!a.name) badRequest('Name the account');
    const info = ctx.db
      .prepare('INSERT INTO retirement_accounts (name, type, balance_cents, balance_date, expected_return_pct, planned_annual_cents, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(a.name, a.type, a.balance, a.balanceDate, a.ret, a.planned, a.notes);
    return { id: Number(info.lastInsertRowid) };
  });

  app.patch('/api/retirement/accounts/:id', async (req) => {
    const id = toInt((req.params as Row).id, 'id');
    const existing = ctx.db.prepare('SELECT * FROM retirement_accounts WHERE id = ?').get(id) as Row | undefined;
    if (!existing) notFound('Account not found');
    const a = readAccount((req.body ?? {}) as Row, existing);
    ctx.db
      .prepare('UPDATE retirement_accounts SET name=?, type=?, balance_cents=?, balance_date=?, expected_return_pct=?, planned_annual_cents=?, notes=?, archived=? WHERE id=?')
      .run(a.name, a.type, a.balance, a.balanceDate, a.ret, a.planned, a.notes, a.archived, id);
    return { ok: true };
  });

  app.delete('/api/retirement/accounts/:id', async (req) => {
    ctx.db.prepare('DELETE FROM retirement_accounts WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  app.post('/api/retirement/contributions', async (req) => {
    const b = (req.body ?? {}) as Row;
    const accountId = toInt(b.accountId, 'accountId');
    if (!ctx.db.prepare('SELECT 1 FROM retirement_accounts WHERE id = ?').get(accountId)) badRequest('Choose an account');
    const txId = optInt(b.transactionId) ?? null;
    let amount = centsOrNull(b.amountCents);
    let date = optStr(b.date) ?? null;
    if (txId) {
      const t = ctx.db.prepare('SELECT date, amount_cents FROM transactions WHERE id = ?').get(txId) as Row | undefined;
      if (!t) badRequest('Transaction not found');
      if (ctx.db.prepare('SELECT 1 FROM retirement_contributions WHERE transaction_id = ?').get(txId)) badRequest('Already recorded');
      amount = amount ?? Math.abs(t.amount_cents);
      date = date ?? t.date;
    }
    if (!amount || amount <= 0) badRequest('Enter the amount');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) badRequest('Enter the date');
    // Contributions made Jan 1 – Apr 15 can count toward the previous tax year; default to the date's year.
    const taxYear = optInt(b.taxYear) ?? Number(date.slice(0, 4));
    const info = ctx.db
      .prepare('INSERT INTO retirement_contributions (account_id, date, amount_cents, tax_year, transaction_id, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, date, amount, taxYear, txId, optStr(b.note) ?? null);
    return { id: Number(info.lastInsertRowid) };
  });

  app.delete('/api/retirement/contributions/:id', async (req) => {
    ctx.db.prepare('DELETE FROM retirement_contributions WHERE id = ?').run(toInt((req.params as Row).id, 'id'));
    return { ok: true };
  });

  app.get('/api/retirement', async (req) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear();
    const db = ctx.db;
    const profile = retirementProfile();
    const age = profile.birthYear ? year - profile.birthYear : null;
    const accounts = db.prepare('SELECT * FROM retirement_accounts WHERE archived = 0 ORDER BY name').all() as Row[];
    const contribs = db.prepare('SELECT * FROM retirement_contributions ORDER BY date DESC').all() as Row[];
    const list = accounts.map((a) => {
      const mine = contribs.filter((c) => c.account_id === a.id);
      const thisYear = mine.filter((c) => c.tax_year === year).reduce((s, c) => s + c.amount_cents, 0);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        balanceCents: a.balance_cents,
        balanceDate: a.balance_date,
        expectedReturnPct: a.expected_return_pct,
        plannedAnnualCents: a.planned_annual_cents,
        notes: a.notes,
        contributedThisYearCents: thisYear,
        contributions: mine.slice(0, 20).map((c) => ({ id: c.id, date: c.date, amountCents: c.amount_cents, taxYear: c.tax_year, transactionId: c.transaction_id, note: c.note })),
      };
    });
    const tax = taxSummary(db, year);
    const limits = contributionLimits(year, tax.projection.projectedProfitCents, tax.estimate.seTaxDeductionCents, age);
    const projection =
      age !== null
        ? projectRetirement(
            list.map((a) => ({ id: a.id, name: a.name, balanceCents: a.balanceCents, annualContributionCents: a.plannedAnnualCents, returnPct: a.expectedReturnPct })),
            { currentYear: year, currentAge: age, retireAge: profile.retireAge, inflationPct: profile.inflationPct, withdrawalPct: profile.withdrawalPct },
          )
        : null;
    // Retirement payments in your bank data that aren't recorded against an account yet.
    const unassigned = (
      db
        .prepare(
          `SELECT t.id, t.date, t.amount_cents, t.merchant FROM transactions t JOIN categories c ON c.id = t.category_id
            WHERE c.tax_line = 'S1-16' AND t.amount_cents < 0
              AND NOT EXISTS (SELECT 1 FROM retirement_contributions r WHERE r.transaction_id = t.id)
            ORDER BY t.date DESC LIMIT 50`,
        )
        .all() as Row[]
    ).map((t) => ({ id: t.id, date: t.date, amountCents: -t.amount_cents, merchant: t.merchant }));
    const plannedTotal = list.reduce((s, a) => s + a.plannedAnnualCents, 0);
    const actualTotal = list.reduce((s, a) => s + a.contributedThisYearCents, 0);
    const range = yearRange(year);
    const elapsed = Math.min(1, Math.max(0, (Date.parse(todayIso()) - Date.parse(range.from)) / (365 * 86400000)));
    return {
      year,
      profile,
      age,
      accounts: list,
      limits,
      projection,
      unassigned,
      plannedTotalCents: plannedTotal,
      actualTotalCents: actualTotal,
      onTrackCents: Math.round(plannedTotal * elapsed),
      projectedProfitCents: tax.projection.projectedProfitCents,
      marginalRate: tax.estimate.marginalRate,
    };
  });

  // ----- Year-end tax packet (Excel) -----
  app.get('/api/reports/tax-packet.xlsx', async (req, reply) => {
    const year = optInt((req.query as Row).year) ?? new Date().getFullYear() - 1;
    const db = ctx.db;
    const s = taxSummary(db, year, `${year}-12-31` < todayIso() ? `${year}-12-31` : todayIso());
    const { from, to } = yearRange(year);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Expense & Mileage Tracker';
    const money = (c: number) => Math.round(c) / 100;
    const fmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
    const sheet = (name: string, cols: [string, number][]) => {
      const ws = wb.addWorksheet(name);
      ws.columns = cols.map(([header, width]) => ({ header, width }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      return ws;
    };

    const sc = sheet('Schedule C summary', [['Line', 10], ['Description', 52], ['Amount', 16], ['Details', 60]]);
    const sc1 = s.scheduleC;
    const add = (line: string, label: string, cents: number, detail = '') => sc.addRow([line, label, money(cents), detail]);
    add('1', 'Gross receipts or sales', sc1.line1GrossReceiptsCents);
    add('2', 'Returns and allowances', sc1.line2ReturnsCents);
    add('6', 'Other income', sc1.line6OtherIncomeCents);
    add('7', 'Gross income', sc1.line7GrossIncomeCents);
    for (const l of sc1.expenseLines) add(l.line, l.label, l.amountCents, l.detail.map((d) => `${d.name}: $${(d.amountCents / 100).toFixed(2)}${d.note ? ` (${d.note})` : ''}`).join('; '));
    add('28', 'Total expenses', sc1.line28TotalExpensesCents);
    add('29', 'Tentative profit', sc1.line29TentativeProfitCents);
    add('30', 'Business use of home', sc1.line30HomeOfficeCents, sc1.homeOffice ? `${sc1.homeOffice.method} method, ${sc1.homeOffice.businessPct}% of home` : '');
    add('31', 'Net profit', sc1.line31NetProfitCents);
    sc.addRow([]);
    for (const x of sc1.schedule1) sc.addRow([`Sch 1 / ${x.line}`, x.label, money(x.amountCents)]);
    for (const x of sc1.tracking) sc.addRow(['Tracking', x.label, money(x.amountCents)]);
    for (const x of sc1.excluded) sc.addRow(['Not deducted', `${x.name} — ${x.reason}`, money(x.amountCents)]);
    sc.addRow([]);
    sc.addRow(['', `Business miles: ${sc1.businessMiles}`, null]);
    if (s.unreviewed) sc.addRow(['', `Warning: ${s.unreviewed} transactions in ${year} are not reviewed and are not included.`, null]);
    sc.getColumn(3).numFmt = fmt;

    const tx = sheet('Business transactions', [['Date', 12], ['Merchant', 28], ['Description', 44], ['Category', 30], ['Form line', 10], ['Amount', 14], ['Deductible', 14], ['Client', 20], ['Trip', 24], ['Notes', 40]]);
    const rows = db
      .prepare(
        `SELECT l.date, l.amount_cents, l.merchant, t.description, t.notes, c.name AS cat, c.tax_line, c.deductible_pct, c.kind,
                cl.name AS client, bt.name AS trip
           FROM ledger_lines l JOIN transactions t ON t.id = l.transaction_id
           LEFT JOIN categories c ON c.id = l.category_id
           LEFT JOIN clients cl ON cl.id = l.client_id
           LEFT JOIN business_trips bt ON bt.id = l.trip_id
          WHERE l.classification = 'business' AND l.status = 'reviewed' AND l.date BETWEEN ? AND ?
          ORDER BY c.tax_line, l.date`,
      )
      .all(from, to) as Row[];
    for (const r of rows) {
      const deductible = r.kind === 'expense' ? Math.round((-r.amount_cents * (r.deductible_pct ?? 100)) / 100) : null;
      tx.addRow([r.date, r.merchant, r.description, r.cat ?? '(no category)', r.tax_line ?? '', money(r.amount_cents), deductible === null ? null : money(deductible), r.client ?? '', r.trip ?? '', r.notes ?? '']);
    }
    tx.getColumn(6).numFmt = fmt;
    tx.getColumn(7).numFmt = fmt;

    const inc = sheet('Income by client', [['Client', 32], ['Income', 16]]);
    for (const r of db
      .prepare(
        `SELECT COALESCE(cl.name, '(no client tagged)') AS name, SUM(l.amount_cents) AS total FROM ledger_lines l
           JOIN categories c ON c.id = l.category_id LEFT JOIN clients cl ON cl.id = l.client_id
          WHERE c.kind = 'income' AND l.classification = 'business' AND l.status = 'reviewed' AND l.date BETWEEN ? AND ?
          GROUP BY cl.id ORDER BY total DESC`,
      )
      .all(from, to) as Row[])
      inc.addRow([r.name, money(r.total)]);
    inc.getColumn(2).numFmt = fmt;

    const trips = sheet('Trips', [['Trip', 30], ['Dates', 26], ['Destination', 22], ['Purpose', 40], ['Expenses', 14]]);
    for (const r of db
      .prepare(
        `SELECT bt.*, (SELECT COALESCE(SUM(-l.amount_cents), 0) FROM ledger_lines l JOIN categories c ON c.id = l.category_id
                        WHERE l.trip_id = bt.id AND l.classification = 'business' AND l.status = 'reviewed' AND c.kind = 'expense') AS spent
           FROM business_trips bt WHERE bt.start_date <= ? AND bt.end_date >= ? ORDER BY bt.start_date`,
      )
      .all(to, from) as Row[])
      trips.addRow([r.name, `${r.start_date} – ${r.end_date}`, [r.dest_city, r.dest_state].filter(Boolean).join(', '), r.purpose ?? '', money(r.spent)]);
    trips.getColumn(5).numFmt = fmt;

    const nec = sheet('1099-NEC', [['Contractor', 28], ['Paid directly', 16], ['Card/processor', 16], ['Needs 1099-NEC', 16], ['W-9', 8], ['Warnings', 60]]);
    const contractors = db.prepare('SELECT * FROM contractors').all() as Row[];
    for (const c of contractors) {
      const pays = db
        .prepare(`SELECT t.date, t.amount_cents, t.payment_method, t.description, a.type FROM transactions t JOIN accounts a ON a.id = t.account_id
                   WHERE t.contractor_id = ? AND t.amount_cents < 0 AND t.date BETWEEN ? AND ?`)
        .all(c.id, from, to) as Row[];
      if (pays.length === 0) continue;
      const sum = contractor1099(
        { id: c.id, name: c.name, entityType: c.entity_type, w9Received: !!c.w9_received, tinLast4: c.tin_last4, address: c.address },
        pays.map((p) => ({ date: p.date, paidCents: -p.amount_cents, method: p.payment_method ?? inferPaymentMethod(p.description, p.type) })),
        year,
      );
      nec.addRow([c.name, money(sum.directCents), money(sum.processorCents), sum.needs1099 ? 'YES' : 'no', c.w9_received ? 'yes' : 'no', sum.warnings.join(' ')]);
    }
    nec.getColumn(2).numFmt = fmt;
    nec.getColumn(3).numFmt = fmt;
    nec.addRow([]);
    nec.addRow([`Threshold for ${year}: $${(necThresholdCents(year) / 100).toFixed(0)} paid directly.`]);

    const est = sheet('Estimated taxes', [['Item', 44], ['Amount', 16], ['Notes', 50]]);
    const e = s.estimate;
    est.addRow(['Projected net profit', money(s.projection.projectedProfitCents), s.projection.note]);
    est.addRow(['Self-employment tax', money(e.seTaxCents)]);
    est.addRow(['Income tax', money(e.incomeTaxCents)]);
    est.addRow(['Total federal (estimate)', money(e.totalFederalCents)]);
    est.addRow(['Required estimated payments', money(e.requiredAnnualCents), e.safeHarborBasis]);
    est.addRow(['Paid so far', money(s.paidCents)]);
    est.addRow([]);
    for (const q of s.quarters) est.addRow([`Q${q.quarter} due ${q.due}`, money(q.amountCents), `paid ${(q.paidCents / 100).toFixed(2)} — ${q.status}`]);
    for (const p of s.payments) est.addRow([`Payment ${p.date}`, money(p.amountCents)]);
    est.getColumn(2).numFmt = fmt;

    const subs = sheet('Notes', [['Note', 120]]);
    subs.addRow(['Prepared by the Expense & Mileage Tracker from reviewed transactions. Bookkeeping summary — confirm with your tax preparer.']);
    subs.addRow([`Mileage: ${sc1.businessMiles} business miles counted (mileage tracking ${sc1.businessMiles ? 'on' : 'not set up yet'}).`]);
    subs.addRow([`Subscription ideas key: ${Object.values(APPROACH_LABEL).join(', ')}.`]);

    const buf = await wb.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="tax-packet-${year}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });
}
