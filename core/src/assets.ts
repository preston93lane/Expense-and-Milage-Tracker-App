import { addDays } from './dates';

/**
 * Equipment register: cameras, lenses, computers, drones… and how each is
 * written off for taxes. Planning tool — confirm elections with a tax pro.
 *
 *  - de_minimis: items ≤ $2,500 expensed right away as supplies (safe-harbor election)
 *  - section179: full business cost deducted the year it's put in service (can't exceed business income)
 *  - bonus: 100% bonus depreciation (property acquired after Jan 19, 2025), can create a loss
 *  - macrs5 / macrs7: spread over 5 or 7 years (half-year convention, GDS 200% declining balance)
 *  - straight_line: equal amounts over the useful life (half-year convention)
 */
export type AssetType = 'camera' | 'lens' | 'audio' | 'lighting' | 'drone' | 'computer' | 'phone_tablet' | 'software' | 'furniture' | 'vehicle' | 'other';
export type DepreciationMethod = 'de_minimis' | 'section179' | 'bonus' | 'macrs5' | 'macrs7' | 'straight_line';

export const DE_MINIMIS_LIMIT_CENTS = 250_000;

const MACRS: Record<'macrs5' | 'macrs7', number[]> = {
  macrs5: [20, 32, 19.2, 11.52, 11.52, 5.76],
  macrs7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
};

/** Typical replacement cycles (years) — for reminders, not taxes. */
export const REPLACE_AFTER_YEARS: Record<AssetType, number> = {
  camera: 4,
  lens: 8,
  audio: 6,
  lighting: 6,
  drone: 3,
  computer: 4,
  phone_tablet: 3,
  software: 3,
  furniture: 10,
  vehicle: 8,
  other: 5,
};

/** MACRS class by type: most equipment and computers are 5-year; furniture is 7-year. */
export function defaultMacrsClass(type: AssetType): 'macrs5' | 'macrs7' {
  return type === 'furniture' ? 'macrs7' : 'macrs5';
}

export function suggestMethod(costCents: number): DepreciationMethod {
  return costCents <= DE_MINIMIS_LIMIT_CENTS ? 'de_minimis' : 'section179';
}

export interface AssetFacts {
  costCents: number;
  businessUsePct: number;
  placedInService: string;
  method: DepreciationMethod;
  lifeYears?: number | null;
  disposedDate?: string | null;
}

export interface ScheduleYear {
  year: number;
  deductionCents: number;
  remainingCents: number;
}

/** Year-by-year write-off for one asset (basis = cost × business-use %). */
export function depreciationSchedule(a: AssetFacts): ScheduleYear[] {
  const basis = Math.round((a.costCents * Math.min(100, Math.max(0, a.businessUsePct))) / 100);
  const y0 = Number(a.placedInService.slice(0, 4));
  const lastYear = a.disposedDate ? Number(a.disposedDate.slice(0, 4)) : Infinity;
  let pct: number[];
  switch (a.method) {
    case 'de_minimis':
    case 'section179':
    case 'bonus':
      pct = [100];
      break;
    case 'macrs5':
    case 'macrs7':
      pct = MACRS[a.method];
      break;
    case 'straight_line': {
      const life = Math.max(1, a.lifeYears ?? 5);
      pct = [50 / life, ...Array.from({ length: life - 1 }, () => 100 / life), 50 / life];
      break;
    }
  }
  const out: ScheduleYear[] = [];
  let remaining = basis;
  pct.forEach((p, i) => {
    const year = y0 + i;
    if (year > lastYear) return;
    const last = i === pct.length - 1;
    const d = last ? remaining : Math.min(remaining, Math.round((basis * p) / 100));
    remaining -= d;
    out.push({ year, deductionCents: d, remainingCents: remaining });
  });
  return out;
}

export function deductionForYear(a: AssetFacts, year: number): number {
  return depreciationSchedule(a).find((s) => s.year === year)?.deductionCents ?? 0;
}

export function assetWarnings(a: AssetFacts & { type: AssetType }): string[] {
  const w: string[] = [];
  if (a.method === 'de_minimis' && a.costCents > DE_MINIMIS_LIMIT_CENTS) w.push('Over $2,500 — the de minimis rule doesn’t apply; use Section 179, bonus or MACRS.');
  if ((a.method === 'section179' || a.method === 'bonus') && a.businessUsePct <= 50 && (a.type === 'vehicle' || a.type === 'computer' || a.type === 'phone_tablet' || a.type === 'camera')) {
    w.push('Business use is 50% or less — listed property must use straight-line depreciation instead of Section 179/bonus.');
  }
  if (a.type === 'vehicle') w.push('Vehicles: if you take the standard mileage rate you can’t also depreciate the car. Special luxury-auto limits apply.');
  if (a.disposedDate) w.push('Sold or disposed: some depreciation may need to be paid back (recapture) — ask your tax preparer.');
  return w;
}

export interface Reminder {
  kind: 'warranty' | 'replace';
  date: string;
  message: string;
}

export function assetReminders(
  a: { name: string; purchaseDate: string; warrantyUntil: string | null; replaceAfterYears: number | null; disposedDate: string | null },
  today: string,
): Reminder[] {
  if (a.disposedDate) return [];
  const out: Reminder[] = [];
  if (a.warrantyUntil && a.warrantyUntil >= today && a.warrantyUntil <= addDays(today, 60)) {
    out.push({ kind: 'warranty', date: a.warrantyUntil, message: `${a.name}: warranty ends ${a.warrantyUntil} — check it over and claim anything now.` });
  }
  if (a.replaceAfterYears) {
    const due = addDays(a.purchaseDate, Math.round(a.replaceAfterYears * 365.25));
    if (due <= addDays(today, 90)) {
      out.push({ kind: 'replace', date: due, message: `${a.name}: ${due < today ? 'past' : 'nearing'} its usual ${a.replaceAfterYears}-year life — budget for a replacement.` });
    }
  }
  return out;
}
