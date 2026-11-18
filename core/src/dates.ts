/**
 * Calendar dates are stored as ISO strings "YYYY-MM-DD" (no time zone games).
 */

export type DateFormat =
  | 'YYYY-MM-DD'
  | 'MM/DD/YYYY'
  | 'MM/DD/YY'
  | 'DD/MM/YYYY'
  | 'DD/MM/YY'
  | 'YYYY/MM/DD'
  | 'YYYYMMDD'
  | 'MON DD, YYYY'
  | 'DD MON YYYY';

export const DATE_FORMATS: DateFormat[] = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'MM/DD/YY',
  'YYYY/MM/DD',
  'YYYYMMDD',
  'MON DD, YYYY',
  'DD MON YYYY',
  'DD/MM/YYYY',
  'DD/MM/YY',
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  return isValidYmd(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Parse a date string using a specific format. Returns ISO "YYYY-MM-DD" or null. */
export function parseDateWithFormat(raw: string, format: DateFormat): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  switch (format) {
    case 'YYYY-MM-DD':
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
      return m ? ymd(+m[1], +m[2], +m[3]) : null;
    case 'YYYY/MM/DD':
      m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s.*)?$/);
      return m ? ymd(+m[1], +m[2], +m[3]) : null;
    case 'MM/DD/YYYY':
      m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s.*)?$/);
      return m ? ymd(+m[3], +m[1], +m[2]) : null;
    case 'MM/DD/YY':
      m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})(?:\s.*)?$/);
      return m ? ymd(+m[3], +m[1], +m[2]) : null;
    case 'DD/MM/YYYY':
      m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/);
      return m ? ymd(+m[3], +m[2], +m[1]) : null;
    case 'DD/MM/YY':
      m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})(?:\s.*)?$/);
      return m ? ymd(+m[3], +m[2], +m[1]) : null;
    case 'YYYYMMDD':
      // Also accepts OFX timestamps: 20261014120000.000[-5:EST]
      m = s.match(/^(\d{4})(\d{2})(\d{2})/);
      return m ? ymd(+m[1], +m[2], +m[3]) : null;
    case 'MON DD, YYYY': {
      m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
      if (!m) return null;
      const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
      return mon ? ymd(+m[3], mon, +m[2]) : null;
    }
    case 'DD MON YYYY': {
      m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{4})$/);
      if (!m) return null;
      const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
      return mon ? ymd(+m[3], mon, +m[1]) : null;
    }
  }
}

/**
 * Pick the date format that parses every sample. US formats win ties
 * (03/04/2026 is read as March 4th unless some sample proves day-first).
 */
export function detectDateFormat(samples: string[]): DateFormat | null {
  const values = samples.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (values.length === 0) return null;
  for (const fmt of DATE_FORMATS) {
    if (values.every((v) => parseDateWithFormat(v, fmt) !== null)) return fmt;
  }
  return null;
}

export function looksLikeDate(value: string): boolean {
  return DATE_FORMATS.some((f) => parseDateWithFormat(value, f) !== null);
}

/** Add days to an ISO date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
