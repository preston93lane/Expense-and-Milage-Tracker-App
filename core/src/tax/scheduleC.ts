import { TAX_LINE_BY_CODE } from '../categories';

/**
 * Turn category totals into a Schedule C (Form 1040) summary, line by line.
 * Bookkeeping summary to copy into tax software or hand to a preparer.
 */
export interface CategoryTotal {
  categoryId: number;
  name: string;
  taxLine: string;
  kind: 'expense' | 'income' | 'other';
  deductiblePct: number;
  /** Signed ledger sum: expenses negative, refunds positive, income positive. */
  totalCents: number;
}

export interface ScheduleCLine {
  line: string;
  label: string;
  amountCents: number;
  detail: { name: string; amountCents: number; note?: string }[];
}

export interface ScheduleCInput {
  categories: CategoryTotal[];
  mileageMethod: 'standard' | 'actual';
  /** Standard-mileage deduction (business miles × rate). */
  mileageDeductionCents: number;
  /** Depreciation/Section 179 from the equipment register (Form 4562). */
  depreciationCents?: number;
  homeOffice: HomeOfficeInput | null;
}

export interface HomeOfficeInput {
  method: 'simplified' | 'actual';
  officeSqft: number;
  homeSqft: number;
  monthsUsed: number;
}

export interface ScheduleC {
  line1GrossReceiptsCents: number;
  line2ReturnsCents: number;
  line6OtherIncomeCents: number;
  line7GrossIncomeCents: number;
  expenseLines: ScheduleCLine[];
  line28TotalExpensesCents: number;
  line29TentativeProfitCents: number;
  line30HomeOfficeCents: number;
  homeOffice: { method: string; businessPct: number; uncappedCents: number; limitedByIncome: boolean; actualExpensesCents: number } | null;
  line31NetProfitCents: number;
  /** Deductions that go on Schedule 1, not Schedule C. */
  schedule1: { line: string; label: string; amountCents: number }[];
  /** Tracked amounts that aren't deductions (estimated tax payments). */
  tracking: { label: string; amountCents: number }[];
  excluded: { name: string; amountCents: number; reason: string }[];
}

const EXPENSE_LINES = ['8', '9', '10', '11', '12', '13', '14', '15', '16a', '16b', '17', '18', '19', '20a', '20b', '21', '22', '23', '24a', '24b', '25', '26', '27a'];

export function homeOfficeDeduction(h: HomeOfficeInput, actualExpensesCents: number, tentativeProfitCents: number) {
  const months = Math.min(12, Math.max(0, h.monthsUsed || 12));
  let uncapped: number;
  let businessPct = 0;
  if (h.method === 'simplified') {
    // $5 per square foot, up to 300 sq ft, prorated by months used.
    uncapped = Math.round(Math.min(300, Math.max(0, h.officeSqft)) * 500 * (months / 12));
    businessPct = h.homeSqft > 0 ? Math.round((h.officeSqft / h.homeSqft) * 1000) / 10 : 0;
  } else {
    businessPct = h.homeSqft > 0 ? Math.min(100, (h.officeSqft / h.homeSqft) * 100) : 0;
    uncapped = Math.round(actualExpensesCents * (businessPct / 100));
    businessPct = Math.round(businessPct * 10) / 10;
  }
  // The deduction can't create a loss (excess carries forward on Form 8829 — not tracked here).
  const allowed = Math.max(0, Math.min(uncapped, tentativeProfitCents));
  return { method: h.method, businessPct, uncappedCents: uncapped, allowedCents: allowed, limitedByIncome: allowed < uncapped, actualExpensesCents };
}

export function buildScheduleC(input: ScheduleCInput): ScheduleC {
  const lines = new Map<string, ScheduleCLine>();
  const lineFor = (code: string) => {
    const info = TAX_LINE_BY_CODE[code];
    const ln = info?.line ?? '27a';
    if (!lines.has(ln)) lines.set(ln, { line: ln, label: info?.label ?? 'Other expenses', amountCents: 0, detail: [] });
    return lines.get(ln)!;
  };
  let gross = 0;
  let returns = 0;
  let other = 0;
  let homeExpenses = 0;
  const schedule1: ScheduleC['schedule1'] = [];
  const tracking: ScheduleC['tracking'] = [];
  const excluded: ScheduleC['excluded'] = [];

  for (const c of input.categories) {
    if (c.totalCents === 0) continue;
    switch (c.taxLine) {
      case 'C-1':
        gross += c.totalCents;
        continue;
      case 'C-2':
        returns += -c.totalCents;
        continue;
      case 'C-6':
        other += c.totalCents;
        continue;
      case 'F8829':
        homeExpenses += -c.totalCents;
        continue;
      case 'S1-16':
        schedule1.push({ line: '16', label: `Self-employed SEP, SIMPLE, and qualified plans (${c.name})`, amountCents: -c.totalCents });
        continue;
      case 'S1-17':
        schedule1.push({ line: '17', label: `Self-employed health insurance (${c.name})`, amountCents: -c.totalCents });
        continue;
      case 'EST-FED':
      case 'EST-STATE':
      case 'NONE':
        tracking.push({ label: c.name, amountCents: -c.totalCents });
        continue;
      case 'C-9-ACTUAL':
        if (input.mileageMethod === 'standard') {
          excluded.push({ name: c.name, amountCents: -c.totalCents, reason: 'Not deductible with the standard mileage rate' });
          continue;
        }
        break;
    }
    if (c.kind !== 'expense') continue;
    const spent = -c.totalCents;
    const deductible = Math.round((spent * c.deductiblePct) / 100);
    const l = lineFor(c.taxLine === 'C-9-ACTUAL' ? 'C-9' : c.taxLine);
    l.amountCents += deductible;
    l.detail.push({ name: c.name, amountCents: deductible, note: c.deductiblePct < 100 ? `${c.deductiblePct}% of ${(spent / 100).toFixed(2)}` : undefined });
  }
  if (input.mileageMethod === 'standard' && input.mileageDeductionCents > 0) {
    const l = lineFor('C-9');
    l.amountCents += input.mileageDeductionCents;
    l.detail.push({ name: 'Business miles × standard mileage rate', amountCents: input.mileageDeductionCents });
  }
  if (input.depreciationCents) {
    const l = lineFor('C-13');
    l.amountCents += input.depreciationCents;
    l.detail.push({ name: 'Equipment depreciation / Section 179 (equipment register)', amountCents: input.depreciationCents });
  }

  const expenseLines = EXPENSE_LINES.filter((l) => lines.has(l)).map((l) => lines.get(l)!);
  const total = expenseLines.reduce((s, l) => s + l.amountCents, 0);
  const grossIncome = gross - returns + other;
  const tentative = grossIncome - total;
  let homeOffice: ScheduleC['homeOffice'] = null;
  let line30 = 0;
  if (input.homeOffice && input.homeOffice.officeSqft > 0) {
    const h = homeOfficeDeduction(input.homeOffice, homeExpenses, tentative);
    line30 = h.allowedCents;
    homeOffice = { method: h.method, businessPct: h.businessPct, uncappedCents: h.uncappedCents, limitedByIncome: h.limitedByIncome, actualExpensesCents: homeExpenses };
  }
  return {
    line1GrossReceiptsCents: gross,
    line2ReturnsCents: returns,
    line6OtherIncomeCents: other,
    line7GrossIncomeCents: grossIncome,
    expenseLines,
    line28TotalExpensesCents: total,
    line29TentativeProfitCents: tentative,
    line30HomeOfficeCents: line30,
    homeOffice,
    line31NetProfitCents: tentative - line30,
    schedule1,
    tracking,
    excluded,
  };
}
