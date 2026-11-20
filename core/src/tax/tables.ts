/**
 * Federal tax tables by year. Values in cents.
 * Sources: Rev. Proc. 2024-40 as amended by the One Big Beautiful Bill Act (2025),
 * Rev. Proc. 2025-32 (2026), SSA wage base announcements, IRS retirement COLA notices.
 * Update yearly (the IRS publishes next year's numbers each October/November).
 * Estimates only — not tax advice.
 */
export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

export interface TaxYearTable {
  year: number;
  standardDeduction: Record<FilingStatus, number>;
  /** Upper bound (cents) of each bracket for 10/12/22/24/32/35%; 37% above the last. */
  brackets: Record<FilingStatus, number[]>;
  ssWageBase: number;
  /** Additional Medicare tax threshold (0.9%). */
  addlMedicareThreshold: Record<FilingStatus, number>;
  /** QBI deduction: taxable-income threshold where limits start, and phase-in width. */
  qbiThreshold: Record<FilingStatus, number>;
  qbiPhaseIn: Record<FilingStatus, number>;
  retirement: {
    deferral401k: number;
    catchUp50: number;
    catchUp60to63: number;
    annualAdditions415c: number;
    compensationCap: number;
    ira: number;
    iraCatchUp: number;
  };
}

const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
export const BRACKET_RATES = RATES;

const d = (n: number) => Math.round(n * 100);

export const TAX_TABLES: Record<number, TaxYearTable> = {
  2025: {
    year: 2025,
    standardDeduction: { single: d(15_750), mfs: d(15_750), mfj: d(31_500), hoh: d(23_625) },
    brackets: {
      single: [11_925, 48_475, 103_350, 197_300, 250_525, 626_350].map(d),
      mfs: [11_925, 48_475, 103_350, 197_300, 250_525, 375_800].map(d),
      mfj: [23_850, 96_950, 206_700, 394_600, 501_050, 751_600].map(d),
      hoh: [17_000, 64_850, 103_350, 197_300, 250_500, 626_350].map(d),
    },
    ssWageBase: d(176_100),
    addlMedicareThreshold: { single: d(200_000), hoh: d(200_000), mfj: d(250_000), mfs: d(125_000) },
    qbiThreshold: { single: d(197_300), hoh: d(197_300), mfs: d(197_300), mfj: d(394_600) },
    qbiPhaseIn: { single: d(50_000), hoh: d(50_000), mfs: d(50_000), mfj: d(100_000) },
    retirement: {
      deferral401k: d(23_500),
      catchUp50: d(7_500),
      catchUp60to63: d(11_250),
      annualAdditions415c: d(70_000),
      compensationCap: d(350_000),
      ira: d(7_000),
      iraCatchUp: d(1_000),
    },
  },
  2026: {
    year: 2026,
    standardDeduction: { single: d(16_100), mfs: d(16_100), mfj: d(32_200), hoh: d(24_150) },
    brackets: {
      single: [12_400, 50_400, 105_700, 201_775, 256_225, 640_600].map(d),
      mfs: [12_400, 50_400, 105_700, 201_775, 256_225, 384_350].map(d),
      mfj: [24_800, 100_800, 211_400, 403_550, 512_450, 768_700].map(d),
      hoh: [17_700, 67_450, 105_700, 201_750, 256_200, 640_600].map(d),
    },
    ssWageBase: d(184_500),
    addlMedicareThreshold: { single: d(200_000), hoh: d(200_000), mfj: d(250_000), mfs: d(125_000) },
    qbiThreshold: { single: d(201_750), hoh: d(201_750), mfs: d(201_750), mfj: d(403_500) },
    // OBBBA widened the phase-in range from 2026.
    qbiPhaseIn: { single: d(75_000), hoh: d(75_000), mfs: d(75_000), mfj: d(150_000) },
    retirement: {
      deferral401k: d(24_500),
      catchUp50: d(8_000),
      catchUp60to63: d(11_250),
      annualAdditions415c: d(72_000),
      compensationCap: d(360_000),
      ira: d(7_500),
      iraCatchUp: d(1_100),
    },
  },
};

/** The table for a year; falls back to the latest known year (flagged). */
export function taxTable(year: number): { table: TaxYearTable; exact: boolean } {
  if (TAX_TABLES[year]) return { table: TAX_TABLES[year], exact: true };
  const years = Object.keys(TAX_TABLES).map(Number).sort((a, b) => a - b);
  const pick = year < years[0] ? years[0] : years[years.length - 1];
  return { table: TAX_TABLES[pick], exact: false };
}

export function incomeTax(taxableCents: number, brackets: number[]): number {
  let tax = 0;
  let lower = 0;
  for (let i = 0; i < RATES.length; i++) {
    const upper = i < brackets.length ? brackets[i] : Infinity;
    if (taxableCents <= lower) break;
    tax += (Math.min(taxableCents, upper) - lower) * RATES[i];
    lower = upper;
  }
  return Math.round(tax);
}

export function marginalRate(taxableCents: number, brackets: number[]): number {
  for (let i = 0; i < brackets.length; i++) if (taxableCents <= brackets[i]) return RATES[i];
  return RATES[RATES.length - 1];
}
