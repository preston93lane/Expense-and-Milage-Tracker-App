import { daysBetween } from '../dates';

/**
 * Credit-card payments and moves between your own accounts are not expenses.
 * Counting them would double-count (the card purchases are already expenses).
 */
const TRANSFER_PATTERNS: RegExp[] = [
  /PAYMENT\s*(-\s*)?THANK\s*YOU/,
  /THANK YOU FOR YOUR PAYMENT/,
  /\bAUTO\s?PAY(MENT)?\b/,
  /AUTOMATIC PAYMENT/,
  /ONLINE (BANKING )?TRANSFER/,
  /\bTRANSFER (TO|FROM)\b/,
  /\bXFER\b/,
  /INTERNAL TRANSFER/,
  /CREDIT CARD (PAYMENT|PMT|PYMT)/,
  /\bCARD (PAYMENT|PMT|PYMT)\b/,
  /\bE-?PAYMENT\b/,
  /\bEPAY\b/,
  /(MOBILE|ONLINE|INTERNET|ELECTRONIC) PAYMENT/,
  /PAYMENT RECEIVED/,
  /CAPITAL ONE.*(PMT|PAYMENT)|CAPITAL ONE ONLINE/,
  /CHASE CREDIT CRD|CHASE CARD SERV|PAYMENT TO CHASE CARD/,
  /AMEX EPAYMENT|AMERICAN EXPRESS ACH PMT|AMEX ACH PMT/,
  /DISCOVER E-?PAYMENT|DISCOVER (CARD )?PMT/,
  /CITI (AUTOPAY|CARD ONLINE)|CITICARD/,
  /BK OF AMER VISA|BANK OF AMERICA CREDIT CARD|BA ELECTRONIC PAYMENT/,
  /WF CREDIT CARD|WELLS FARGO CARD/,
  /SYNCHRONY|SYNCB|BARCLAYCARD|US BANK CREDIT CARD/,
  /APPLECARD GSBANK|APPLE CARD/,
];

export function looksLikeTransfer(description: string): boolean {
  const d = description.toUpperCase();
  return TRANSFER_PATTERNS.some((re) => re.test(d));
}

export interface TransferCandidate {
  id: number;
  accountId: number;
  date: string;
  amountCents: number;
  description: string;
}

/**
 * Pair up the two sides of a transfer: same amount, opposite sign, different
 * accounts, within `windowDays`. Returns [outId, inId] pairs.
 */
export function findTransferPairs(txns: TransferCandidate[], windowDays = 5): [number, number][] {
  const outs = txns.filter((t) => t.amountCents < 0);
  const ins = txns.filter((t) => t.amountCents > 0);
  const used = new Set<number>();
  const pairs: [number, number][] = [];
  for (const o of outs) {
    let best: TransferCandidate | null = null;
    let bestGap = Infinity;
    for (const i of ins) {
      if (used.has(i.id) || i.accountId === o.accountId || i.amountCents !== -o.amountCents) continue;
      const gap = Math.abs(daysBetween(o.date, i.date));
      if (gap > windowDays) continue;
      // Require at least one side to look like a transfer to avoid pairing a refund with a purchase.
      if (!looksLikeTransfer(o.description) && !looksLikeTransfer(i.description)) continue;
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(best.id);
      pairs.push([o.id, best.id]);
    }
  }
  return pairs;
}
