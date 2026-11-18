/**
 * Default categories, each mapped to the IRS form line it lands on.
 * Line references follow the 2025/2026 Schedule C (Form 1040) layout.
 * This is bookkeeping guidance, not tax advice.
 */

export type CategoryKind = 'expense' | 'income' | 'other';

export interface TaxLineInfo {
  code: string;
  form: 'Schedule C' | 'Schedule 1' | 'Form 8829' | 'Tracking';
  line: string;
  label: string;
}

export const TAX_LINES: TaxLineInfo[] = [
  { code: 'C-1', form: 'Schedule C', line: '1', label: 'Gross receipts or sales' },
  { code: 'C-2', form: 'Schedule C', line: '2', label: 'Returns and allowances' },
  { code: 'C-6', form: 'Schedule C', line: '6', label: 'Other income' },
  { code: 'C-8', form: 'Schedule C', line: '8', label: 'Advertising' },
  { code: 'C-9', form: 'Schedule C', line: '9', label: 'Car and truck expenses' },
  { code: 'C-9-ACTUAL', form: 'Schedule C', line: '9', label: 'Car and truck — actual expenses (only with the actual-expense method)' },
  { code: 'C-10', form: 'Schedule C', line: '10', label: 'Commissions and fees' },
  { code: 'C-11', form: 'Schedule C', line: '11', label: 'Contract labor' },
  { code: 'C-13', form: 'Schedule C', line: '13', label: 'Depreciation and section 179 (Form 4562)' },
  { code: 'C-15', form: 'Schedule C', line: '15', label: 'Insurance (other than health)' },
  { code: 'C-16b', form: 'Schedule C', line: '16b', label: 'Interest: other' },
  { code: 'C-17', form: 'Schedule C', line: '17', label: 'Legal and professional services' },
  { code: 'C-18', form: 'Schedule C', line: '18', label: 'Office expense' },
  { code: 'C-20a', form: 'Schedule C', line: '20a', label: 'Rent or lease: vehicles, machinery, equipment' },
  { code: 'C-20b', form: 'Schedule C', line: '20b', label: 'Rent or lease: other business property' },
  { code: 'C-21', form: 'Schedule C', line: '21', label: 'Repairs and maintenance' },
  { code: 'C-22', form: 'Schedule C', line: '22', label: 'Supplies' },
  { code: 'C-23', form: 'Schedule C', line: '23', label: 'Taxes and licenses' },
  { code: 'C-24a', form: 'Schedule C', line: '24a', label: 'Travel' },
  { code: 'C-24b', form: 'Schedule C', line: '24b', label: 'Deductible meals' },
  { code: 'C-25', form: 'Schedule C', line: '25', label: 'Utilities' },
  { code: 'C-26', form: 'Schedule C', line: '26', label: 'Wages' },
  { code: 'C-27a', form: 'Schedule C', line: '27a', label: 'Other expenses' },
  { code: 'F8829', form: 'Form 8829', line: '—', label: 'Home expenses (actual home-office method)' },
  { code: 'S1-16', form: 'Schedule 1', line: '16', label: 'Self-employed SEP, SIMPLE, and qualified plans' },
  { code: 'S1-17', form: 'Schedule 1', line: '17', label: 'Self-employed health insurance deduction' },
  { code: 'EST-FED', form: 'Tracking', line: '—', label: 'Federal estimated tax payments (not deductible)' },
  { code: 'EST-STATE', form: 'Tracking', line: '—', label: 'State estimated tax payments (not deductible on Schedule C)' },
  { code: 'NONE', form: 'Tracking', line: '—', label: 'Tracked only, not deductible' },
];

export const TAX_LINE_BY_CODE: Record<string, TaxLineInfo> = Object.fromEntries(
  TAX_LINES.map((t) => [t.code, t]),
);

export interface DefaultCategory {
  /** Stable key used by the keyword dictionary and seeds. */
  key: string;
  name: string;
  kind: CategoryKind;
  taxLine: string;
  deductiblePct: number;
  description: string;
  /** Other names (e.g. QuickBooks Self-Employed category names) that map here. */
  aliases?: string[];
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  // ---- Income ----
  { key: 'income', name: 'Business income', kind: 'income', taxLine: 'C-1', deductiblePct: 100,
    description: 'Client payments, 1099 work, sales.', aliases: ['Business income', 'Income', 'Gross receipts', 'Sales'] },
  { key: 'income_refunds_given', name: 'Refunds given to customers', kind: 'income', taxLine: 'C-2', deductiblePct: 100,
    description: 'Money you returned to customers.', aliases: ['Returns and allowances', 'Refunds given'] },
  { key: 'income_other', name: 'Other business income', kind: 'income', taxLine: 'C-6', deductiblePct: 100,
    description: 'Rebates, bartering, other business income.', aliases: ['Other income', 'Other business income'] },

  // ---- Expenses (Schedule C) ----
  { key: 'advertising', name: 'Advertising & marketing', kind: 'expense', taxLine: 'C-8', deductiblePct: 100,
    description: 'Ads, website, business cards, promotion.', aliases: ['Advertising', 'Advertising & marketing', 'Marketing'] },
  { key: 'parking_tolls', name: 'Parking & tolls', kind: 'expense', taxLine: 'C-9', deductiblePct: 100,
    description: 'Business parking and tolls (deductible on top of the standard mileage rate).', aliases: ['Parking & tolls', 'Parking', 'Tolls'] },
  { key: 'vehicle_actual', name: 'Vehicle: gas, repairs, insurance (actual method only)', kind: 'expense', taxLine: 'C-9-ACTUAL', deductiblePct: 100,
    description: 'Only deductible if you use the actual-expense method instead of the standard mileage rate.',
    aliases: ['Car & truck', 'Car and truck', 'Vehicle expenses', 'Gas', 'Auto'] },
  { key: 'commissions_fees', name: 'Commissions & fees', kind: 'expense', taxLine: 'C-10', deductiblePct: 100,
    description: 'Platform fees, payment-processing fees, sales commissions.', aliases: ['Commissions & fees', 'Commissions and fees', 'Merchant fees'] },
  { key: 'contract_labor', name: 'Contract labor', kind: 'expense', taxLine: 'C-11', deductiblePct: 100,
    description: 'Payments to independent contractors (may need 1099-NEC).', aliases: ['Contract labor', 'Contractors'] },
  { key: 'equipment', name: 'Equipment & computers', kind: 'expense', taxLine: 'C-13', deductiblePct: 100,
    description: 'Larger purchases (computers, tools, furniture) usually expensed via Section 179 / de minimis.', aliases: ['Equipment', 'Depreciation', 'Computers'] },
  { key: 'insurance', name: 'Business insurance', kind: 'expense', taxLine: 'C-15', deductiblePct: 100,
    description: 'Liability, E&O, business property insurance (not health).', aliases: ['Insurance', 'Business insurance'] },
  { key: 'interest', name: 'Interest (business loans & cards)', kind: 'expense', taxLine: 'C-16b', deductiblePct: 100,
    description: 'Interest on business debt.', aliases: ['Interest paid', 'Interest'] },
  { key: 'legal_professional', name: 'Legal & professional services', kind: 'expense', taxLine: 'C-17', deductiblePct: 100,
    description: 'Accountant, attorney, tax prep, consultants.', aliases: ['Legal & professional', 'Legal & professional services', 'Professional services'] },
  { key: 'office', name: 'Office expenses & postage', kind: 'expense', taxLine: 'C-18', deductiblePct: 100,
    description: 'Office supplies, postage, shipping, small office items.', aliases: ['Office expenses', 'Office expense', 'Office supplies', 'Postage'] },
  { key: 'rent_equipment', name: 'Rent/lease: vehicles & equipment', kind: 'expense', taxLine: 'C-20a', deductiblePct: 100,
    description: 'Long-term equipment or vehicle leases (trip car rentals go under Travel).', aliases: ['Rent & lease', 'Equipment rental'] },
  { key: 'rent_property', name: 'Rent/lease: office or workspace', kind: 'expense', taxLine: 'C-20b', deductiblePct: 100,
    description: 'Office, coworking, storage unit rent.', aliases: ['Rent', 'Office rent', 'Coworking'] },
  { key: 'repairs', name: 'Repairs & maintenance', kind: 'expense', taxLine: 'C-21', deductiblePct: 100,
    description: 'Repairs to business equipment or property.', aliases: ['Repairs & maintenance', 'Repairs'] },
  { key: 'supplies', name: 'Supplies & materials', kind: 'expense', taxLine: 'C-22', deductiblePct: 100,
    description: 'Materials and supplies used in your work.', aliases: ['Supplies', 'Supplies & materials', 'Materials'] },
  { key: 'taxes_licenses', name: 'Taxes & licenses', kind: 'expense', taxLine: 'C-23', deductiblePct: 100,
    description: 'Business licenses, permits, business taxes (not income tax).', aliases: ['Taxes & licenses', 'Licenses'] },
  { key: 'travel_airfare', name: 'Travel: airfare', kind: 'expense', taxLine: 'C-24a', deductiblePct: 100,
    description: 'Flights and baggage fees for business travel.', aliases: ['Travel', 'Airfare'] },
  { key: 'travel_lodging', name: 'Travel: lodging', kind: 'expense', taxLine: 'C-24a', deductiblePct: 100,
    description: 'Hotels, Airbnb on business trips.', aliases: ['Lodging', 'Hotel'] },
  { key: 'travel_car', name: 'Travel: rental car & fuel', kind: 'expense', taxLine: 'C-24a', deductiblePct: 100,
    description: 'Rental cars and the fuel you buy for them while traveling.', aliases: ['Car rental', 'Rental car'] },
  { key: 'travel_ground', name: 'Travel: taxi, rideshare & transit', kind: 'expense', taxLine: 'C-24a', deductiblePct: 100,
    description: 'Uber, Lyft, taxis, trains, buses while traveling or for business errands.', aliases: ['Taxi', 'Rideshare', 'Transportation'] },
  { key: 'travel_other', name: 'Travel: other (airport parking, tips, laundry)', kind: 'expense', taxLine: 'C-24a', deductiblePct: 100,
    description: 'Other costs of business travel away from home.', aliases: ['Travel other'] },
  { key: 'meals', name: 'Meals (business, 50%)', kind: 'expense', taxLine: 'C-24b', deductiblePct: 50,
    description: 'Business meals with clients/partners. Generally 50% deductible.', aliases: ['Meals', 'Meals & entertainment', 'Business meals'] },
  { key: 'travel_meals', name: 'Travel meals (50%)', kind: 'expense', taxLine: 'C-24b', deductiblePct: 50,
    description: 'Your meals while traveling away from home overnight. Generally 50% deductible.', aliases: ['Travel meals'] },
  { key: 'phone_internet', name: 'Phone & internet', kind: 'expense', taxLine: 'C-25', deductiblePct: 100,
    description: 'Business share of phone and internet (use a split for mixed use).', aliases: ['Utilities', 'Phone', 'Internet', 'Phone & internet'] },
  { key: 'utilities', name: 'Utilities (business premises)', kind: 'expense', taxLine: 'C-25', deductiblePct: 100,
    description: 'Utilities for a separate business location (home utilities go under Home office).', aliases: ['Utilities (office)'] },
  { key: 'wages', name: 'Wages (employees)', kind: 'expense', taxLine: 'C-26', deductiblePct: 100,
    description: 'W-2 wages paid to employees.', aliases: ['Wages', 'Payroll'] },
  { key: 'software', name: 'Software & subscriptions', kind: 'expense', taxLine: 'C-27a', deductiblePct: 100,
    description: 'SaaS, apps, cloud services, domains.', aliases: ['Software', 'Subscriptions', 'Software & subscriptions'] },
  { key: 'education', name: 'Education & training', kind: 'expense', taxLine: 'C-27a', deductiblePct: 100,
    description: 'Courses, books, conferences that maintain or improve your current business skills.', aliases: ['Education', 'Training'] },
  { key: 'dues', name: 'Dues & memberships', kind: 'expense', taxLine: 'C-27a', deductiblePct: 100,
    description: 'Professional associations, trade memberships.', aliases: ['Dues & subscriptions', 'Memberships'] },
  { key: 'bank_fees', name: 'Bank & card fees', kind: 'expense', taxLine: 'C-27a', deductiblePct: 100,
    description: 'Business account fees, card annual fees.', aliases: ['Bank fees', 'Bank charges'] },
  { key: 'other_expense', name: 'Other business expenses', kind: 'expense', taxLine: 'C-27a', deductiblePct: 100,
    description: 'Ordinary and necessary expenses that fit nowhere else.', aliases: ['Other business expenses', 'Other expenses', 'Miscellaneous'] },

  // ---- Home office (actual method inputs) ----
  { key: 'home_rent', name: 'Home: rent or mortgage interest', kind: 'expense', taxLine: 'F8829', deductiblePct: 100,
    description: 'Whole-home rent / mortgage interest. Only the office percentage is deducted (actual home-office method).', aliases: ['Home office: rent', 'Rent or mortgage'] },
  { key: 'home_utilities', name: 'Home: utilities', kind: 'expense', taxLine: 'F8829', deductiblePct: 100,
    description: 'Whole-home utilities. Only the office percentage is deducted.', aliases: ['Home office: utilities'] },
  { key: 'home_insurance', name: 'Home: insurance', kind: 'expense', taxLine: 'F8829', deductiblePct: 100,
    description: "Renter's/homeowner's insurance. Only the office percentage is deducted.", aliases: ['Home office: insurance'] },
  { key: 'home_repairs', name: 'Home: repairs & maintenance', kind: 'expense', taxLine: 'F8829', deductiblePct: 100,
    description: 'General home repairs. Only the office percentage is deducted.', aliases: ['Home office: repairs'] },

  // ---- Deductions outside Schedule C ----
  { key: 'health_insurance', name: 'Self-employed health insurance', kind: 'expense', taxLine: 'S1-17', deductiblePct: 100,
    description: 'Medical/dental/vision premiums (Schedule 1, not Schedule C).', aliases: ['Health insurance'] },
  { key: 'retirement', name: 'Retirement contributions (SEP/Solo 401k)', kind: 'expense', taxLine: 'S1-16', deductiblePct: 100,
    description: 'Your own SEP-IRA / Solo 401(k) contributions (Schedule 1).', aliases: ['Retirement', 'SEP IRA'] },

  // ---- Tracking only ----
  { key: 'est_tax_federal', name: 'Estimated tax payment (federal)', kind: 'other', taxLine: 'EST-FED', deductiblePct: 0,
    description: 'Quarterly 1040-ES payments to the IRS. Tracked for the estimated-tax worksheet; not an expense.', aliases: ['Estimated taxes', 'Federal estimated tax'] },
  { key: 'est_tax_state', name: 'Estimated tax payment (state)', kind: 'other', taxLine: 'EST-STATE', deductiblePct: 0,
    description: 'Quarterly state estimated payments. Tracked; not a Schedule C expense.', aliases: ['State estimated tax'] },
];

export const DEFAULT_CATEGORY_BY_KEY: Record<string, DefaultCategory> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((c) => [c.key, c]),
);

/** Normalise a category name for fuzzy matching ("Office Expenses" == "office expenses"). */
export function normalizeCategoryName(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Find the best default-category key for an imported category label
 * (e.g. from a QuickBooks Self-Employed export). Returns null when unsure.
 */
export function matchCategoryLabel(
  label: string,
  categories: { id: number; name: string; aliases?: string[] }[],
): number | null {
  const target = normalizeCategoryName(label);
  if (!target) return null;
  for (const c of categories) {
    if (normalizeCategoryName(c.name) === target) return c.id;
  }
  for (const c of categories) {
    if ((c.aliases ?? []).some((a) => normalizeCategoryName(a) === target)) return c.id;
  }
  for (const c of categories) {
    const n = normalizeCategoryName(c.name);
    if (n.startsWith(target) || target.startsWith(n)) return c.id;
  }
  return null;
}
