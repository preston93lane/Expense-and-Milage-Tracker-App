import { addDays, daysBetween, DATE_FORMATS, parseDateWithFormat } from './dates';
import { normalizeMerchant } from './merchant';
import { parseAmountToCents } from './money';

/**
 * Electronic receipts: read the merchant, date and total from an emailed or
 * downloaded receipt, then find the bank/card transaction it belongs to.
 */
export interface ReceiptFacts {
  merchant: string | null;
  merchantKey: string | null;
  date: string | null;
  totalCents: number | null;
  /** Other dollar amounts seen (for manual correction). */
  amountsCents: number[];
}

const SENDER_DOMAINS: [RegExp, string][] = [
  [/(^|\.)delta\.com$/, 'DELTA AIR LINES'],
  [/(^|\.)united\.com$/, 'UNITED AIRLINES'],
  [/(^|\.)(aa\.com|americanairlines\.com)$/, 'AMERICAN AIRLINES'],
  [/(^|\.)(southwest\.com|luv\.southwest\.com|ifly\.southwest\.com)$/, 'SOUTHWEST AIRLINES'],
  [/(^|\.)alaskaair\.com$/, 'ALASKA AIRLINES'],
  [/(^|\.)jetblue\.com$/, 'JETBLUE'],
  [/(^|\.)spirit\.com$/, 'SPIRIT AIRLINES'],
  [/(^|\.)flyfrontier\.com$/, 'FRONTIER AIRLINES'],
  [/(^|\.)hertz\.com$/, 'HERTZ'],
  [/(^|\.)enterprise\.com$/, 'ENTERPRISE RENT-A-CAR'],
  [/(^|\.)nationalcar\.com$/, 'NATIONAL CAR RENTAL'],
  [/(^|\.)avis\.com$/, 'AVIS'],
  [/(^|\.)budget\.com$/, 'BUDGET RENT A CAR'],
  [/(^|\.)sixt\.com$/, 'SIXT'],
  [/(^|\.)turo\.com$/, 'TURO'],
  [/(^|\.)marriott\.com$/, 'MARRIOTT'],
  [/(^|\.)hilton\.com$/, 'HILTON'],
  [/(^|\.)hyatt\.com$/, 'HYATT'],
  [/(^|\.)ihg\.com$/, 'IHG HOTELS'],
  [/(^|\.)airbnb\.com$/, 'AIRBNB'],
  [/(^|\.)vrbo\.com$/, 'VRBO'],
  [/(^|\.)expedia\.com$/, 'EXPEDIA'],
  [/(^|\.)booking\.com$/, 'BOOKING.COM'],
  [/(^|\.)hotels\.com$/, 'HOTELS.COM'],
  [/(^|\.)uber\.com$/, 'UBER'],
  [/(^|\.)lyft\.com$/, 'LYFT'],
  [/(^|\.)doordash\.com$/, 'DOORDASH'],
  [/(^|\.)grubhub\.com$/, 'GRUBHUB'],
  [/(^|\.)amazon\.com$/, 'AMAZON'],
  [/(^|\.)apple\.com$/, 'APPLE.COM'],
  [/(^|\.)adobe\.com$/, 'ADOBE'],
  [/(^|\.)google\.com$/, 'GOOGLE'],
  [/(^|\.)paypal\.com$/, 'PAYPAL'],
  [/(^|\.)squareup\.com$/, 'SQUARE'],
  [/(^|\.)bhphotovideo\.com$/, 'B&H PHOTO'],
  [/(^|\.)adorama\.com$/, 'ADORAMA'],
  [/(^|\.)bestbuy\.com$/, 'BEST BUY'],
];

/** Merchant from the email sender ("Delta Air Lines <receipts@t.delta.com>"). */
export function merchantFromSender(from: string | null | undefined): string | null {
  if (!from) return null;
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const domain = email.includes('@') ? email.split('@')[1] : '';
  for (const [re, name] of SENDER_DOMAINS) if (domain && re.test(domain)) return name;
  const display = from.replace(/<[^>]*>/, '').replace(/["']/g, '').trim();
  if (display && !display.includes('@')) {
    const cleaned = display.replace(/\b(receipts?|no-?reply|noreply|orders?|billing|notifications?|team|support|reservations?)\b/gi, '').trim();
    if (cleaned) return normalizeMerchant(cleaned).merchantKey;
  }
  if (domain) {
    const parts = domain.split('.');
    const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return label.toUpperCase();
  }
  return null;
}

const TOTAL_LABELS: [RegExp, number][] = [
  [/\b(grand total|total charged|amount charged|total charges?|charged to (your )?card|total paid|amount paid|you paid|payment total|trip total|order total|total price|total cost|total due|balance paid)\b/i, 3],
  [/\btotal\b(?!\s*(savings|discount|points|miles|before))/i, 2],
  [/\b(amount|charged|paid)\b/i, 1],
];

const MONEY_RE = /(?:USD\s*)?\$\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|-?\d{1,3}(?:,\d{3})*\.\d{2}\s*(?:USD)\b/g;

function amountsIn(line: string): number[] {
  return [...line.matchAll(MONEY_RE)]
    .map((m) => parseAmountToCents(m[0].replace(/USD/gi, '').trim()))
    .filter((c): c is number => c !== null && c > 0 && c < 10_000_000);
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RE = new RegExp(`\\b(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|(?:${MONTHS})\\.? \\d{1,2},? \\d{4}|\\d{1,2} (?:${MONTHS}) \\d{4})\\b`, 'gi');

function parseAnyDate(s: string): string | null {
  const clean = s.replace(/\./g, '').replace(/(\w+) (\d{1,2}) (\d{4})/, '$1 $2, $3');
  for (const f of DATE_FORMATS) {
    const d = parseDateWithFormat(clean, f);
    if (d) return d;
  }
  return null;
}

export function parseReceiptText(text: string, meta: { from?: string | null; subject?: string | null; date?: string | null } = {}): ReceiptFacts {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // Total: the strongest "total" label wins; ties → the largest amount near it.
  let best: { prio: number; cents: number } | null = null;
  lines.forEach((line, i) => {
    if (/\b(sub\s*-?total|subtotal|before tax|tax total|taxes and fees total)\b/i.test(line) && !/grand total/i.test(line)) return;
    for (const [re, prio] of TOTAL_LABELS) {
      if (!re.test(line)) continue;
      const here = amountsIn(line);
      const cands = here.length ? here : amountsIn(lines[i + 1] ?? '');
      for (const c of cands) {
        if (!best || prio > best.prio || (prio === best.prio && c > best.cents)) best = { prio, cents: c };
      }
      break;
    }
  });
  const all = [...new Set(lines.flatMap(amountsIn))].sort((a, b) => b - a);
  const picked = best as { prio: number; cents: number } | null;
  const totalCents = picked ? picked.cents : all[0] ?? null;

  // Date: a labelled date in the text, else the email's date.
  let date: string | null = null;
  for (const line of lines) {
    if (!/\b(date|issued|purchased|ordered|booked|paid on|charged on|transaction)\b/i.test(line)) continue;
    const m = line.match(DATE_RE);
    if (m) {
      date = parseAnyDate(m[0]);
      if (date) break;
    }
  }
  if (!date && meta.date) date = meta.date.slice(0, 10);
  if (!date) {
    const m = text.match(DATE_RE);
    if (m) date = parseAnyDate(m[0]);
  }

  let merchantKey = merchantFromSender(meta.from);
  if (!merchantKey && meta.subject) {
    const m = meta.subject.match(/(?:from|at|with)\s+([A-Z][\w&.' -]{2,40})/);
    if (m) merchantKey = normalizeMerchant(m[1]).merchantKey;
  }
  if (!merchantKey && lines[0]) merchantKey = normalizeMerchant(lines[0]).merchantKey;
  return {
    merchant: merchantKey ? normalizeMerchant(merchantKey).merchant : null,
    merchantKey,
    date,
    totalCents,
    amountsCents: all.slice(0, 10),
  };
}

/** Very small HTML → text for receipt emails/pages (keeps line breaks at block tags). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#36;|&dollar;/gi, '$')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export interface MatchTxn {
  id: number;
  date: string;
  amountCents: number;
  merchantKey: string;
  description: string;
}

export interface ReceiptMatch {
  transactionId: number;
  score: number;
  reasons: string[];
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !['THE', 'INC', 'LLC', 'COM', 'WWW', 'AND', 'CARD', 'PURCHASE', 'DEBIT'].includes(w)),
  );
}

/**
 * Score transactions for a receipt: exact amount, close date (bookings can be
 * charged up to ~30 days later, e.g. hotels at checkout), and merchant name.
 */
export function matchReceipt(r: Pick<ReceiptFacts, 'merchantKey' | 'date' | 'totalCents'>, txns: MatchTxn[]): ReceiptMatch[] {
  if (!r.totalCents) return [];
  const rt = tokens(r.merchantKey ?? '');
  const out: ReceiptMatch[] = [];
  for (const t of txns) {
    const amt = Math.abs(t.amountCents);
    const reasons: string[] = [];
    let score = 0;
    if (amt === r.totalCents) {
      score += 50;
      reasons.push('same amount');
    } else if (Math.abs(amt - r.totalCents) <= Math.max(100, r.totalCents * 0.01)) {
      score += 30;
      reasons.push('almost the same amount');
    } else continue;
    if (r.date) {
      const gap = daysBetween(r.date, t.date);
      if (gap >= -2 && gap <= 3) {
        score += 30;
        reasons.push('same few days');
      } else if (gap >= -5 && gap <= 10) {
        score += 20;
        reasons.push(`${Math.abs(gap)} days apart`);
      } else if (gap >= -5 && gap <= 35) {
        score += 8;
        reasons.push(`${gap} days later`);
      } else continue;
    }
    if (rt.size) {
      const tt = tokens(`${t.merchantKey} ${t.description}`);
      const overlap = [...rt].filter((w) => tt.has(w) || [...tt].some((x) => x.startsWith(w) || w.startsWith(x))).length;
      if (overlap) {
        score += Math.min(30, 15 + overlap * 8);
        reasons.push('merchant name matches');
      }
    }
    out.push({ transactionId: t.id, score: Math.min(100, score), reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Auto-link only when the best match is strong and clearly ahead of the next one. */
export function confidentMatch(matches: ReceiptMatch[]): ReceiptMatch | null {
  const [a, b] = matches;
  if (!a || a.score < 80) return null;
  if (b && a.score - b.score < 15) return null;
  return a;
}

/** Window of transaction dates worth checking for a receipt dated `date`. */
export function receiptSearchWindow(date: string | null): { from: string; to: string } {
  if (!date) return { from: '0000-01-01', to: '9999-12-31' };
  return { from: addDays(date, -5), to: addDays(date, 35) };
}
