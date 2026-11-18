import type { ParsedTransaction } from './types';

function descKey(description: string): string {
  return description.toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

/**
 * Stable duplicate-detection keys. Overlapping exports (e.g. a CSV for Oct 1–31
 * then another for Oct 15–Nov 15) produce the same keys for the same rows.
 *
 * - With a bank id (OFX FITID / CSV reference): "id:<id>".
 * - Otherwise: date|amount|description plus an occurrence counter so two
 *   identical coffees on the same day are both kept.
 */
export function computeDedupeKeys(txns: ParsedTransaction[]): string[] {
  const seen = new Map<string, number>();
  return txns.map((t) => {
    if (t.externalId) return `id:${t.externalId}`;
    const base = `h:${t.date}|${t.amountCents}|${descKey(t.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

/** Key used to spot "probably the same" rows even when bank ids differ between downloads. */
export function looseKey(t: Pick<ParsedTransaction, 'date' | 'amountCents' | 'description'>): string {
  return `${t.date}|${t.amountCents}|${descKey(t.description)}`;
}
