import { describe, expect, it } from 'vitest';
import { contributionLimits, projectRetirement } from '../retirement';
import { estimatedTaxDueDates, estimateTax, quarterlyPlan, type TaxProfile } from './estimate';
import { buildScheduleC } from './scheduleC';
import { incomeTax, TAX_TABLES, taxTable } from './tables';

const single: TaxProfile = { filingStatus: 'single', w2WagesCents: 0, otherIncomeCents: 0, withholdingCents: 0, priorYearTaxCents: null, priorYearAgiCents: null, stateRatePct: 0 };

describe('tax tables', () => {
  it('computes bracket tax (2026 single)', () => {
    const b = TAX_TABLES[2026].brackets.single;
    // $50,000 taxable: 10% of 12,400 + 12% of 37,600 = 1,240 + 4,512 = 5,752
    expect(incomeTax(5_000_000, b)).toBe(575_200);
    expect(incomeTax(0, b)).toBe(0);
  });

  it('falls back to the latest table for unknown years', () => {
    expect(taxTable(2027)).toMatchObject({ exact: false });
    expect(taxTable(2027).table.year).toBe(2026);
  });
});

describe('estimateTax', () => {
  it('estimates SE tax, QBI, income tax for $80k profit (2026 single)', () => {
    const e = estimateTax({ year: 2026, profile: single, netProfitCents: 8_000_000, seHealthInsuranceCents: 0, retirementContributionsCents: 0 });
    // SE: 80,000 × .9235 = 73,880 × 15.3% = 11,303.64
    expect(e.seTaxCents).toBe(1_130_364);
    expect(e.seTaxDeductionCents).toBe(565_182);
    // AGI 80,000 − 5,651.82 = 74,348.18; − 16,100 std = 58,248.18; QBI = 20% × min(74,348.18, 58,248.18) = 11,649.64
    expect(e.agiCents).toBe(7_434_818);
    expect(e.qbiDeductionCents).toBe(1_164_964);
    expect(e.taxableIncomeCents).toBe(4_659_854);
    // Income tax: 1,240 + 12% × (46,598.54 − 12,400) = 1,240 + 4,103.82 = 5,343.82
    expect(e.incomeTaxCents).toBe(534_382);
    expect(e.totalFederalCents).toBe(534_382 + 1_130_364);
    expect(e.marginalRate).toBe(0.12);
    expect(e.requiredAnnualCents).toBe(Math.round(e.totalFederalCents * 0.9));
    expect(e.setAsidePct).toBeGreaterThan(18);
    expect(e.setAsidePct).toBeLessThan(25);
  });

  it('uses the prior-year safe harbor when lower, and 110% for high earners', () => {
    const e = estimateTax({ year: 2026, profile: { ...single, priorYearTaxCents: 800_000, priorYearAgiCents: 9_000_000 }, netProfitCents: 12_000_000, seHealthInsuranceCents: 0, retirementContributionsCents: 0 });
    expect(e).toMatchObject({ requiredAnnualCents: 800_000, safeHarborBasis: '100% of last year' });
    const hi = estimateTax({ year: 2026, profile: { ...single, priorYearTaxCents: 800_000, priorYearAgiCents: 20_000_000 }, netProfitCents: 12_000_000, seHealthInsuranceCents: 0, retirementContributionsCents: 0 });
    expect(hi).toMatchObject({ requiredAnnualCents: 880_000, safeHarborBasis: '110% of last year' });
  });

  it('caps Social Security tax using W-2 wages', () => {
    const e = estimateTax({ year: 2026, profile: { ...single, w2WagesCents: 18_450_000 }, netProfitCents: 5_000_000, seHealthInsuranceCents: 0, retirementContributionsCents: 0 });
    // Only Medicare 2.9% applies: 50,000 × .9235 × .029 = 1,339.08
    expect(e.seTaxCents).toBe(133_908);
  });

  it('builds the quarterly plan and credits payments in order', () => {
    expect(estimatedTaxDueDates(2026).map((d) => d.due)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
    const plan = quarterlyPlan(2026, 1_200_000, [{ date: '2026-04-10', amountCents: 300_000 }, { date: '2026-06-12', amountCents: 150_000 }], '2026-11-20');
    expect(plan.map((q) => q.status)).toEqual(['paid', 'partly_paid', 'missed', 'upcoming']);
    expect(quarterlyPlan(2026, 1_200_000, [], '2027-01-02')[3].status).toBe('due_soon');
    expect(plan[1].paidCents).toBe(150_000);
  });
});

describe('Schedule C', () => {
  it('maps categories to lines, applies 50% meals, mileage, and home office', () => {
    const sc = buildScheduleC({
      mileageMethod: 'standard',
      mileageDeductionCents: 362_500,
      homeOffice: { method: 'simplified', officeSqft: 150, homeSqft: 1500, monthsUsed: 12 },
      categories: [
        { categoryId: 1, name: 'Business income', taxLine: 'C-1', kind: 'income', deductiblePct: 100, totalCents: 9_000_000 },
        { categoryId: 2, name: 'Meals (business, 50%)', taxLine: 'C-24b', kind: 'expense', deductiblePct: 50, totalCents: -100_000 },
        { categoryId: 3, name: 'Travel: lodging', taxLine: 'C-24a', kind: 'expense', deductiblePct: 100, totalCents: -250_000 },
        { categoryId: 4, name: 'Parking & tolls', taxLine: 'C-9', kind: 'expense', deductiblePct: 100, totalCents: -10_000 },
        { categoryId: 5, name: 'Vehicle: gas', taxLine: 'C-9-ACTUAL', kind: 'expense', deductiblePct: 100, totalCents: -80_000 },
        { categoryId: 6, name: 'Self-employed health insurance', taxLine: 'S1-17', kind: 'expense', deductiblePct: 100, totalCents: -500_000 },
        { categoryId: 7, name: 'Estimated tax payment (federal)', taxLine: 'EST-FED', kind: 'other', deductiblePct: 0, totalCents: -400_000 },
      ],
    });
    expect(sc.line1GrossReceiptsCents).toBe(9_000_000);
    const line = (l: string) => sc.expenseLines.find((x) => x.line === l)?.amountCents;
    expect(line('24b')).toBe(50_000);
    expect(line('24a')).toBe(250_000);
    expect(line('9')).toBe(10_000 + 362_500);
    expect(sc.excluded[0].reason).toMatch(/standard mileage/);
    expect(sc.line28TotalExpensesCents).toBe(50_000 + 250_000 + 372_500);
    expect(sc.line30HomeOfficeCents).toBe(75_000); // 150 sq ft × $5
    expect(sc.line31NetProfitCents).toBe(9_000_000 - 672_500 - 75_000);
    expect(sc.schedule1[0]).toMatchObject({ line: '17', amountCents: 500_000 });
    expect(sc.tracking[0].amountCents).toBe(400_000);
  });

  it('limits the home office to the profit (no loss)', () => {
    const sc = buildScheduleC({
      mileageMethod: 'standard',
      mileageDeductionCents: 0,
      homeOffice: { method: 'actual', officeSqft: 200, homeSqft: 1000, monthsUsed: 12 },
      categories: [
        { categoryId: 1, name: 'Business income', taxLine: 'C-1', kind: 'income', deductiblePct: 100, totalCents: 100_000 },
        { categoryId: 2, name: 'Home: rent', taxLine: 'F8829', kind: 'expense', deductiblePct: 100, totalCents: -2_400_000 },
      ],
    });
    expect(sc.homeOffice).toMatchObject({ businessPct: 20, uncappedCents: 480_000, limitedByIncome: true });
    expect(sc.line30HomeOfficeCents).toBe(100_000);
    expect(sc.line31NetProfitCents).toBe(0);
  });
});

describe('retirement', () => {
  it('computes SEP and Solo 401(k) limits from net earnings', () => {
    const l = contributionLimits(2026, 10_000_000, 706_478, 40);
    // net earnings 100,000 − 7,064.78 = 92,935.22 → employer 20% = 18,587.04
    expect(l.netEarningsCents).toBe(9_293_522);
    expect(l.sepMaxCents).toBe(1_858_704);
    expect(l.solo401kEmployeeMaxCents).toBe(2_450_000);
    expect(l.solo401kTotalMaxCents).toBe(2_450_000 + 1_858_704);
    expect(l.iraMaxCents).toBe(750_000);
    expect(contributionLimits(2026, 10_000_000, 706_478, 61).catchUpCents).toBe(1_125_000);
  });

  it('projects balances with contributions and inflation', () => {
    const p = projectRetirement([{ id: 1, name: 'SEP', balanceCents: 1_000_000, annualContributionCents: 1_000_000, returnPct: 6 }], {
      currentYear: 2026, currentAge: 35, retireAge: 65, inflationPct: 3, withdrawalPct: 4,
    });
    expect(p.years).toHaveLength(31);
    expect(p.years[1].balanceCents).toBe(Math.round(1_000_000 * 1.06 + 1_000_000 * 1.03));
    expect(p.atRetirement!.age).toBe(65);
    expect(p.atRetirement!.realBalanceCents).toBeLessThan(p.atRetirement!.balanceCents);
    expect(p.totalContributedCents).toBe(30 * 1_000_000);
  });
});
