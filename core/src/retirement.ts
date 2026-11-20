import { taxTable } from './tax/tables';

/**
 * Retirement: how much you're allowed to put away as a self-employed person,
 * and where your planned + actual contributions take you. Projections are
 * illustrations with an assumed return, not promises.
 */
export type RetirementAccountType = 'sep_ira' | 'solo_401k' | 'traditional_ira' | 'roth_ira' | '401k' | 'hsa' | 'brokerage' | 'other';

export interface ContributionLimits {
  year: number;
  netEarningsCents: number;
  sepMaxCents: number;
  solo401kEmployeeMaxCents: number;
  solo401kEmployerMaxCents: number;
  solo401kTotalMaxCents: number;
  iraMaxCents: number;
  catchUpCents: number;
  notes: string[];
}

/**
 * @param netProfitCents Schedule C net profit
 * @param seTaxDeductionCents half of SE tax
 * @param age age at the end of the year
 * @param otherDeferralsCents 401(k)/403(b) deferrals already made at a W-2 job this year
 */
export function contributionLimits(year: number, netProfitCents: number, seTaxDeductionCents: number, age: number | null, otherDeferralsCents = 0): ContributionLimits {
  const { table, exact } = taxTable(year);
  const r = table.retirement;
  const notes: string[] = [];
  if (!exact) notes.push(`${year} limits aren't loaded yet — showing ${table.year} limits.`);
  const netEarnings = Math.max(0, Math.min(netProfitCents - seTaxDeductionCents, r.compensationCap));
  // For a sole proprietor the "25%" employer limit works out to 20% of net earnings.
  const employer = Math.round(netEarnings * 0.2);
  const catchUp = age === null ? 0 : age >= 60 && age <= 63 ? r.catchUp60to63 : age >= 50 ? r.catchUp50 : 0;
  const employee = Math.max(0, Math.min(r.deferral401k + catchUp - otherDeferralsCents, netEarnings));
  const total = Math.min(employee + employer, r.annualAdditions415c + catchUp, netEarnings);
  const iraCatch = age !== null && age >= 50 ? r.iraCatchUp : 0;
  if (otherDeferralsCents > 0) notes.push('The employee-deferral limit is shared with any 401(k) at a W-2 job.');
  if (age === null) notes.push('Add your birth year to include catch-up contributions (age 50+).');
  return {
    year,
    netEarningsCents: netEarnings,
    sepMaxCents: Math.min(employer, r.annualAdditions415c),
    solo401kEmployeeMaxCents: employee,
    solo401kEmployerMaxCents: Math.min(employer, r.annualAdditions415c),
    solo401kTotalMaxCents: total,
    iraMaxCents: r.ira + iraCatch,
    catchUpCents: catchUp,
    notes,
  };
}

export interface ProjectionAccount {
  id: number;
  name: string;
  balanceCents: number;
  annualContributionCents: number;
  returnPct: number;
}

export interface ProjectionYear {
  year: number;
  age: number;
  balanceCents: number;
  /** In today's dollars. */
  realBalanceCents: number;
  contributedCents: number;
}

export interface Projection {
  years: ProjectionYear[];
  atRetirement: { year: number; age: number; balanceCents: number; realBalanceCents: number; annualIncomeRealCents: number; monthlyIncomeRealCents: number } | null;
  totalContributedCents: number;
}

export function projectRetirement(
  accounts: ProjectionAccount[],
  opts: { currentYear: number; currentAge: number; retireAge: number; inflationPct: number; withdrawalPct: number },
): Projection {
  const years: ProjectionYear[] = [];
  const balances = accounts.map((a) => a.balanceCents);
  let contributed = 0;
  const span = Math.max(0, Math.min(70, opts.retireAge - opts.currentAge));
  years.push({ year: opts.currentYear, age: opts.currentAge, balanceCents: sum(balances), realBalanceCents: sum(balances), contributedCents: 0 });
  for (let i = 1; i <= span; i++) {
    accounts.forEach((a, k) => {
      // Contributions spread through the year earn about half a year of growth.
      const r = a.returnPct / 100;
      balances[k] = balances[k] * (1 + r) + a.annualContributionCents * (1 + r / 2);
    });
    contributed += accounts.reduce((s, a) => s + a.annualContributionCents, 0);
    const nominal = Math.round(sum(balances));
    const real = Math.round(nominal / Math.pow(1 + opts.inflationPct / 100, i));
    years.push({ year: opts.currentYear + i, age: opts.currentAge + i, balanceCents: nominal, realBalanceCents: real, contributedCents: contributed });
  }
  const last = years[years.length - 1];
  const annual = Math.round(last.realBalanceCents * (opts.withdrawalPct / 100));
  return {
    years,
    atRetirement: span > 0 ? { year: last.year, age: last.age, balanceCents: last.balanceCents, realBalanceCents: last.realBalanceCents, annualIncomeRealCents: annual, monthlyIncomeRealCents: Math.round(annual / 12) } : null,
    totalContributedCents: contributed,
  };
}

function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}
