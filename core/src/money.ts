/**
 * Money is always stored as integer cents to avoid floating point drift.
 * Sign convention used everywhere in the app: negative = money leaving the
 * account (a purchase / expense), positive = money coming in (deposit, refund).
 */

/**
 * Parse a human/bank formatted amount into integer cents.
 * Handles: "1,234.56", "-12.30", "(12.30)", "$12.30", "12.30-", "12.30 CR", "12.30 DR",
 * "+5", " 1 234,56 " is NOT supported (US formats only).
 * Returns null for blank / unparseable input.
 */
export function parseAmountToCents(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = String(input).trim();
  if (s === '' || s === '-' || s === '--') return null;

  let negative = false;
  // Trailing CR/DR markers (CR = credit = money in, DR = debit = money out)
  const crdr = s.match(/\s*(CR|DR)\.?$/i);
  if (crdr) {
    if (crdr[1].toUpperCase() === 'DR') negative = true;
    s = s.slice(0, crdr.index).trim();
  }
  // Accounting negative: (12.34)
  if (/^\(.*\)$/.test(s)) {
    negative = !negative;
    s = s.slice(1, -1).trim();
  }
  // Trailing minus: 12.34-
  if (/-$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  // Leading sign (possibly before or after currency symbol)
  s = s.replace(/^\$\s*/, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$\s*/, '').replace(/,/g, '').replace(/\s+/g, '');
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;

  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '00').slice(0, 2);
  // Round half-up on a third decimal digit if present
  const third = frac.length > 2 ? Number(frac[2]) : 0;
  let cents = Number(whole || '0') * 100 + Number(fracPadded);
  if (third >= 5) cents += 1;
  return negative ? -cents : cents;
}

export function formatCents(cents: number, opts: { sign?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  const body = `$${dollars}.${rest}`;
  if (negative) return `-${body}`;
  return opts.sign && cents > 0 ? `+${body}` : body;
}

/** Multiply cents by a percentage (0-100), rounding to the nearest cent. */
export function percentOf(cents: number, pct: number): number {
  return Math.round((cents * pct) / 100);
}

/**
 * Split an amount into parts by percentages so that the parts always add up
 * exactly to the original (the last part absorbs rounding).
 */
export function splitByPercents(cents: number, pcts: number[]): number[] {
  const parts: number[] = [];
  let used = 0;
  pcts.forEach((p, i) => {
    if (i === pcts.length - 1) {
      parts.push(cents - used);
    } else {
      const part = percentOf(cents, p);
      parts.push(part);
      used += part;
    }
  });
  return parts;
}
