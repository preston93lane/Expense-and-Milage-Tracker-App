import {
  buildScheduleC,
  daysBetween,
  estimateTax,
  quarterlyPlan,
  todayIso,
  type CategoryTotal,
  type FilingStatus,
  type HomeOfficeInput,
  type TaxProfile,
} from '@et/core';
import { getSetting, type DB } from '../db/database';
import { assetDepreciationForYear, linkedAssetAdjustments } from './assetService';

type Row = Record<string, any>;

export function yearRange(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * Reviewed business lines for a period, totalled per category. Purchases that
 * are in the equipment register are taken out here — they're written off
 * through depreciation (line 13) instead.
 */
export function categoryTotals(db: DB, from: string, to: string): CategoryTotal[] {
  const adj = tableExists(db, 'assets') ? linkedAssetAdjustments(db, from, to) : new Map<number, number>();
  return (
    db
      .prepare(
        `SELECT c.id, c.name, c.tax_line, c.kind, c.deductible_pct, SUM(l.amount_cents) AS total
           FROM ledger_lines l JOIN categories c ON c.id = l.category_id
          WHERE l.status = 'reviewed' AND l.classification = 'business' AND l.date BETWEEN ? AND ?
          GROUP BY c.id`,
      )
      .all(from, to) as Row[]
  )
    .map((r) => ({
      categoryId: r.id,
      name: r.name,
      taxLine: r.tax_line,
      kind: r.kind,
      deductiblePct: r.deductible_pct,
      totalCents: r.total + (adj.get(r.id) ?? 0),
    }))
    .filter((c) => c.totalCents !== 0 || !adj.has(c.categoryId));
}

function tableExists(db: DB, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/** Standard-mileage deduction for business drives (once mileage tracking exists). */
export function mileageDeductionCents(db: DB, from: string, to: string): { cents: number; miles: number } {
  if (!tableExists(db, 'drives')) return { cents: 0, miles: 0 };
  const rows = db
    .prepare(
      `SELECT d.date, d.miles, (SELECT cents_per_mile FROM mileage_rates r WHERE r.kind = 'business' AND d.date BETWEEN r.effective_from AND r.effective_to LIMIT 1) AS rate
         FROM drives d WHERE d.classification = 'business' AND d.date BETWEEN ? AND ?`,
    )
    .all(from, to) as { date: string; miles: number; rate: number | null }[];
  let cents = 0;
  let miles = 0;
  for (const r of rows) {
    miles += r.miles;
    cents += Math.round(r.miles * (r.rate ?? 0));
  }
  return { cents, miles: Math.round(miles * 10) / 10 };
}

/** Depreciation / Section 179 for the year from the equipment register (Form 4562 → line 13). */
export function depreciationCents(db: DB, year: number): number {
  return tableExists(db, 'assets') ? assetDepreciationForYear(db, year).totalCents : 0;
}

export function homeOfficeFor(db: DB, year: number): HomeOfficeInput | null {
  const r = db.prepare('SELECT * FROM home_office WHERE year = ?').get(year) as Row | undefined;
  if (!r || !r.office_sqft) return null;
  return { method: r.method, officeSqft: r.office_sqft, homeSqft: r.home_sqft, monthsUsed: r.months_used };
}

export function scheduleCFor(db: DB, year: number, to?: string) {
  const range = yearRange(year);
  const end = to && to < range.to ? to : range.to;
  const mileage = mileageDeductionCents(db, range.from, end);
  const depreciation = depreciationCents(db, year);
  const sc = buildScheduleC({
    categories: categoryTotals(db, range.from, end),
    mileageMethod: getSetting(db, 'mileage_method', 'standard') as 'standard' | 'actual',
    mileageDeductionCents: mileage.cents,
    depreciationCents: depreciation,
    homeOffice: homeOfficeFor(db, year),
  });
  return { ...sc, businessMiles: mileage.miles, depreciationCents: depreciation };
}

export function taxProfileFor(db: DB, year: number) {
  const r = db.prepare('SELECT * FROM tax_profiles WHERE year = ?').get(year) as Row | undefined;
  const profile: TaxProfile & { projectionMode: 'pace' | 'ytd' | 'manual'; projectedProfitCents: number | null } = {
    filingStatus: (r?.filing_status as FilingStatus) ?? 'single',
    w2WagesCents: r?.w2_wages_cents ?? 0,
    otherIncomeCents: r?.other_income_cents ?? 0,
    withholdingCents: r?.withholding_cents ?? 0,
    priorYearTaxCents: r?.prior_year_tax_cents ?? null,
    priorYearAgiCents: r?.prior_year_agi_cents ?? null,
    stateRatePct: r?.state_rate_pct ?? 0,
    projectionMode: r?.projection_mode ?? 'pace',
    projectedProfitCents: r?.projected_profit_cents ?? null,
  };
  return { profile, saved: !!r };
}

/**
 * Federal estimated-tax payments (category EST-FED) made toward a year:
 * from Jan 16 of the year (payments Jan 1-15 are usually last year's Q4)
 * through Jan 31 of the next year.
 */
export function estimatedPayments(db: DB, year: number) {
  return (
    db
      .prepare(
        `SELECT l.transaction_id, l.date, -l.amount_cents AS amount FROM ledger_lines l JOIN categories c ON c.id = l.category_id
          WHERE c.tax_line = 'EST-FED' AND l.classification = 'business' AND l.status != 'unreviewed' AND l.date BETWEEN ? AND ? ORDER BY l.date`,
      )
      .all(`${year}-01-16`, `${year + 1}-01-31`) as { transaction_id: number; date: string; amount: number }[]
  ).map((p) => ({ transactionId: p.transaction_id, date: p.date, amountCents: p.amount }));
}

/** Everything the Taxes page needs for a year. */
export function taxSummary(db: DB, year: number, today = todayIso()) {
  const { profile, saved } = taxProfileFor(db, year);
  const ytd = scheduleCFor(db, year, today);
  const range = yearRange(year);
  // How much of the year has passed (for the "on pace" projection).
  const elapsedDays = today < range.from ? 0 : today > range.to ? 365 : daysBetween(range.from, today) + 1;
  const fraction = Math.min(1, elapsedDays / 365);
  const ytdProfit = ytd.line31NetProfitCents;
  let projected = ytdProfit;
  let projectionNote = 'Year complete — using the full-year numbers.';
  if (fraction < 1) {
    if (profile.projectionMode === 'manual' && profile.projectedProfitCents !== null) {
      projected = profile.projectedProfitCents;
      projectionNote = 'Using the full-year profit you entered.';
    } else if (profile.projectionMode === 'ytd') {
      projected = ytdProfit;
      projectionNote = 'Using profit so far only (assumes no more income this year).';
    } else {
      // Equipment write-offs are already full-year amounts, so don't scale them up.
      const dep = ytd.depreciationCents;
      projected = fraction > 0.04 ? Math.round((ytdProfit + dep) / fraction) - dep : ytdProfit;
      projectionNote = `On pace: profit so far × ${(1 / Math.max(fraction, 0.0001)).toFixed(2)} (${Math.round(fraction * 100)}% of the year has passed).`;
    }
  }
  const s1 = (line: string) => ytd.schedule1.filter((x) => x.line === line).reduce((s, x) => s + x.amountCents, 0);
  // Manual retirement contributions (not from bank transactions) toward this tax year.
  const manualRetirement = (
    db
      .prepare(
        `SELECT COALESCE(SUM(c.amount_cents), 0) AS s FROM retirement_contributions c JOIN retirement_accounts a ON a.id = c.account_id
          WHERE c.tax_year = ? AND c.transaction_id IS NULL AND a.type IN ('sep_ira','solo_401k')`,
      )
      .get(year) as { s: number }
  ).s;
  const scale = fraction > 0.04 && fraction < 1 && profile.projectionMode === 'pace' ? 1 / fraction : 1;
  const estimate = estimateTax({
    year,
    profile,
    netProfitCents: projected,
    seHealthInsuranceCents: Math.round(s1('17') * scale),
    retirementContributionsCents: s1('16') + manualRetirement,
  });
  const payments = estimatedPayments(db, year);
  const quarters = quarterlyPlan(year, estimate.requiredAnnualCents, payments, today);
  const unreviewed = (
    db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status != 'reviewed' AND date BETWEEN ? AND ?").get(range.from, range.to) as { n: number }
  ).n;
  return {
    year,
    profile,
    profileSaved: saved,
    scheduleC: ytd,
    projection: { ytdProfitCents: ytdProfit, projectedProfitCents: projected, fractionOfYear: fraction, note: projectionNote },
    estimate,
    payments,
    paidCents: payments.reduce((s, p) => s + p.amountCents, 0),
    quarters,
    homeOffice: db.prepare('SELECT * FROM home_office WHERE year = ?').get(year) ?? null,
    unreviewed,
  };
}

/** Upcoming unpaid estimated-tax installments, for the cash-flow forecast. */
export function upcomingTaxPayments(db: DB, today = todayIso()): { date: string; amountCents: number }[] {
  const year = Number(today.slice(0, 4));
  const out: { date: string; amountCents: number }[] = [];
  for (const y of [year - 1, year]) {
    // Only years where you've filled in a tax profile (otherwise we'd be guessing).
    if (!taxProfileFor(db, y).saved) continue;
    const s = taxSummary(db, y, today);
    for (const q of s.quarters) {
      const left = q.amountCents - q.paidCents;
      if (q.due >= today && left > 0) out.push({ date: q.due, amountCents: left });
    }
  }
  return out;
}
