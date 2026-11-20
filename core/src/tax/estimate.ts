import { addDays } from '../dates';
import { incomeTax, marginalRate, taxTable, type FilingStatus, type TaxYearTable } from './tables';

/**
 * Self-employed federal tax estimate and quarterly (1040-ES) schedule.
 * A planning estimate, not a tax return.
 */
export interface TaxProfile {
  filingStatus: FilingStatus;
  /** W-2 wages (yours, or both spouses' if filing jointly), other taxable income, and federal withholding. */
  w2WagesCents: number;
  otherIncomeCents: number;
  withholdingCents: number;
  /** Last year's total tax and AGI — for the safe-harbor amount. */
  priorYearTaxCents: number | null;
  priorYearAgiCents: number | null;
  /** Rough state estimate: effective % of income (0 = skip). */
  stateRatePct: number;
}

export interface EstimateInput {
  year: number;
  profile: TaxProfile;
  /** Schedule C line 31 net profit for the year (projected). */
  netProfitCents: number;
  /** Above-the-line deductions from Schedule 1. */
  seHealthInsuranceCents: number;
  retirementContributionsCents: number;
}

export interface TaxEstimate {
  year: number;
  tableExact: boolean;
  netProfitCents: number;
  seTaxCents: number;
  seTaxDeductionCents: number;
  additionalMedicareCents: number;
  agiCents: number;
  standardDeductionCents: number;
  qbiDeductionCents: number;
  taxableIncomeCents: number;
  incomeTaxCents: number;
  totalFederalCents: number;
  marginalRate: number;
  effectiveRatePct: number;
  stateTaxCents: number;
  withholdingCents: number;
  /** What you'd owe for the year after withholding (federal). */
  federalDueCents: number;
  /** Required estimated payments for the year (after withholding). */
  requiredAnnualCents: number;
  safeHarborCents: number | null;
  safeHarborBasis: '100% of last year' | '110% of last year' | '90% of this year';
  /** Share of each extra dollar of business profit to set aside (federal + state). */
  setAsidePct: number;
  notes: string[];
}

interface Core {
  seTax: number;
  seDeduction: number;
  addlMedicare: number;
  agi: number;
  qbi: number;
  qbiLimited: boolean;
  taxable: number;
  incomeTax: number;
  federal: number;
  state: number;
}

function compute(table: TaxYearTable, p: TaxProfile, profitCents: number, health: number, retirement: number): Core {
  const profit = Math.max(0, profitCents);
  const netEarnings = profit * 0.9235;
  const ssRoom = Math.max(0, table.ssWageBase - p.w2WagesCents);
  const ssTax = Math.min(netEarnings, ssRoom) * 0.124;
  const medicare = netEarnings * 0.029;
  const seTax = netEarnings >= 40_000 ? Math.round(ssTax + medicare) : 0; // under $400 of net earnings → no SE tax
  const seDeduction = Math.round(seTax / 2);
  const addlMedicare = Math.round(Math.max(0, p.w2WagesCents + netEarnings - table.addlMedicareThreshold[p.filingStatus]) * 0.009);
  const agi = Math.max(0, profitCents + p.w2WagesCents + p.otherIncomeCents - seDeduction - health - retirement);
  const beforeQbi = Math.max(0, agi - table.standardDeduction[p.filingStatus]);
  // §199A qualified business income deduction (simplified).
  const qbiBase = Math.max(0, profitCents - seDeduction - health - retirement);
  let qbi = Math.round(Math.min(qbiBase * 0.2, beforeQbi * 0.2));
  const threshold = table.qbiThreshold[p.filingStatus];
  let qbiLimited = false;
  if (beforeQbi > threshold && qbi > 0) {
    // Above the threshold limits apply (W-2 wages/property; specified-service businesses). Phase out conservatively.
    const over = Math.min(1, (beforeQbi - threshold) / table.qbiPhaseIn[p.filingStatus]);
    qbi = Math.round(qbi * (1 - over));
    qbiLimited = true;
  }
  const taxable = Math.max(0, beforeQbi - qbi);
  const iTax = incomeTax(taxable, table.brackets[p.filingStatus]);
  return {
    seTax,
    seDeduction,
    addlMedicare,
    agi,
    qbi,
    qbiLimited,
    taxable,
    incomeTax: iTax,
    federal: iTax + seTax + addlMedicare,
    state: Math.round(agi * (p.stateRatePct / 100)),
  };
}

export function estimateTax(input: EstimateInput): TaxEstimate {
  const { table, exact } = taxTable(input.year);
  const p = input.profile;
  const notes: string[] = [];
  if (!exact) notes.push(`Tax tables for ${input.year} aren't loaded yet — using ${table.year} numbers.`);

  const c = compute(table, p, input.netProfitCents, input.seHealthInsuranceCents, input.retirementContributionsCents);
  const without = compute(table, p, 0, 0, 0);
  if (c.qbiLimited) {
    notes.push('Income is above the QBI threshold, so the 20% business-income deduction is reduced here (worst case). A tax pro can check whether you qualify for more.');
  }

  // Safe harbor: the smaller of 90% of this year's tax or 100% (110% if last year's AGI > $150k) of last year's.
  const ninety = Math.round(c.federal * 0.9);
  let required = ninety;
  let basis: TaxEstimate['safeHarborBasis'] = '90% of this year';
  let safeHarborCents: number | null = null;
  if (p.priorYearTaxCents !== null && p.priorYearTaxCents >= 0) {
    const high = (p.priorYearAgiCents ?? 0) > (p.filingStatus === 'mfs' ? 7_500_000 : 15_000_000);
    safeHarborCents = Math.round(p.priorYearTaxCents * (high ? 1.1 : 1));
    if (safeHarborCents < ninety) {
      required = safeHarborCents;
      basis = high ? '110% of last year' : '100% of last year';
    }
  } else {
    notes.push("Add last year's total tax (Form 1040, “total tax” line) to use the safe-harbor amount — it's often lower and avoids penalties even if you end up owing more.");
  }
  const federalDueCents = c.federal - p.withholdingCents;
  const requiredAnnualCents = federalDueCents < 100_000 ? 0 : Math.max(0, required - p.withholdingCents);
  if (federalDueCents < 100_000) notes.push('You’d owe less than $1,000 after withholding, so estimated payments aren’t required.');

  const totalIncome = Math.max(0, input.netProfitCents) + p.w2WagesCents + p.otherIncomeCents;
  const profit = Math.max(0, input.netProfitCents);
  const businessTax = c.federal + c.state - without.federal - without.state;
  return {
    year: input.year,
    tableExact: exact,
    netProfitCents: input.netProfitCents,
    seTaxCents: c.seTax,
    seTaxDeductionCents: c.seDeduction,
    additionalMedicareCents: c.addlMedicare,
    agiCents: c.agi,
    standardDeductionCents: table.standardDeduction[p.filingStatus],
    qbiDeductionCents: c.qbi,
    taxableIncomeCents: c.taxable,
    incomeTaxCents: c.incomeTax,
    totalFederalCents: c.federal,
    marginalRate: marginalRate(c.taxable, table.brackets[p.filingStatus]),
    effectiveRatePct: totalIncome > 0 ? Math.round((c.federal / totalIncome) * 1000) / 10 : 0,
    stateTaxCents: c.state,
    withholdingCents: p.withholdingCents,
    federalDueCents,
    requiredAnnualCents,
    safeHarborCents,
    safeHarborBasis: basis,
    setAsidePct: profit > 0 ? Math.round((businessTax / profit) * 100) : 0,
    notes,
  };
}

/** 1040-ES due dates for a tax year (weekends move to Monday; federal holidays not handled). */
export function estimatedTaxDueDates(year: number): { quarter: 1 | 2 | 3 | 4; due: string }[] {
  const adj = (y: number, m: number, day: number) => {
    const dt = new Date(Date.UTC(y, m - 1, day));
    const dow = dt.getUTCDay();
    if (dow === 6) dt.setUTCDate(dt.getUTCDate() + 2);
    if (dow === 0) dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  };
  return [
    { quarter: 1, due: adj(year, 4, 15) },
    { quarter: 2, due: adj(year, 6, 15) },
    { quarter: 3, due: adj(year, 9, 15) },
    { quarter: 4, due: adj(year + 1, 1, 15) },
  ];
}

export interface QuarterPlan {
  quarter: 1 | 2 | 3 | 4;
  due: string;
  amountCents: number;
  paidCents: number;
  status: 'not_required' | 'paid' | 'partly_paid' | 'due_soon' | 'upcoming' | 'missed';
}

/**
 * Four equal installments of the required annual payment, matched against
 * the federal estimated-tax payments you made for that year (applied to the
 * earliest unpaid quarter first). Payments from Jan 1 of the year through
 * Jan 31 of the next count toward the year.
 */
export function quarterlyPlan(year: number, requiredAnnualCents: number, payments: { date: string; amountCents: number }[], today: string): QuarterPlan[] {
  const per = Math.round(requiredAnnualCents / 4);
  let pool = payments
    .filter((p) => p.date >= `${year}-01-01` && p.date <= `${year + 1}-01-31`)
    .reduce((s, p) => s + p.amountCents, 0);
  return estimatedTaxDueDates(year).map((d) => {
    const paid = Math.min(pool, per);
    pool -= paid;
    let status: QuarterPlan['status'];
    if (per === 0) status = 'not_required';
    else if (paid >= per) status = 'paid';
    else if (paid > 0) status = 'partly_paid';
    else if (today > d.due) status = 'missed';
    else if (today >= addDays(d.due, -30)) status = 'due_soon';
    else status = 'upcoming';
    return { quarter: d.quarter, due: d.due, amountCents: per, paidCents: paid, status };
  });
}
