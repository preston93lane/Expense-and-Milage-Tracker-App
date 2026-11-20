import { addDays, daysBetween } from './dates';

/**
 * Income, clients, contractors and 1099 rules.
 *
 * 1099-NEC threshold (payments for services to a non-employee):
 *   - payments made through 2025: $600
 *   - payments made in 2026 and later: $2,000 (One Big Beautiful Bill Act, §70433),
 *     indexed for inflation from 2027 — update NEC_THRESHOLDS when the IRS publishes it.
 * Payments made by credit/debit card or through a payment processor (PayPal,
 * Stripe, Square, Venmo/PayPal "goods & services") are reported by the processor
 * on Form 1099-K, so they are NOT counted toward the 1099-NEC you must send.
 * Corporations (C-corp, S-corp) generally don't get a 1099-NEC (attorneys excepted).
 * Bookkeeping guidance, not tax advice.
 */
const NEC_THRESHOLDS: { fromYear: number; cents: number }[] = [
  { fromYear: 0, cents: 60_000 },
  { fromYear: 2026, cents: 200_000 },
];

export function necThresholdCents(year: number): number {
  let cents = NEC_THRESHOLDS[0].cents;
  for (const t of NEC_THRESHOLDS) if (year >= t.fromYear) cents = t.cents;
  return cents;
}

export type PaymentMethod = 'direct' | 'card_or_processor';

const PROCESSOR_RE = /\b(PAYPAL|PP\*|VENMO|STRIPE|SQUARE|SQ \*|SQ\*|CASH ?APP|SQC\*|UPWORK|FIVERR|GUSTO|DEEL|WISE|PAYONEER|ETSY|SHOPIFY|AMAZON PAYMENTS)\b/i;

/**
 * How a payment was made, for 1099 purposes. Card purchases and payment
 * processors go on the processor's 1099-K; checks, ACH, Zelle, wire and cash
 * are "direct" and count toward the 1099-NEC.
 */
export function inferPaymentMethod(description: string, accountType: string): PaymentMethod {
  if (accountType === 'credit_card') return 'card_or_processor';
  if (PROCESSOR_RE.test(description)) return 'card_or_processor';
  return 'direct';
}

export type EntityType = 'individual' | 'sole_prop' | 'llc' | 'partnership' | 's_corp' | 'c_corp' | 'other';

export interface ContractorFacts {
  id: number;
  name: string;
  entityType: EntityType;
  w9Received: boolean;
  tinLast4: string | null;
  address: string | null;
}

export interface ContractorPayment {
  date: string;
  /** Positive number = money you paid them. */
  paidCents: number;
  method: PaymentMethod;
}

export interface Contractor1099 {
  contractorId: number;
  name: string;
  year: number;
  thresholdCents: number;
  directCents: number;
  processorCents: number;
  totalCents: number;
  /** Box 1 amount when a 1099-NEC is required. */
  needs1099: boolean;
  /** Close to the threshold (≥ 75%) — worth getting a W-9 now. */
  approaching: boolean;
  exemptCorporation: boolean;
  warnings: string[];
}

export function contractor1099(c: ContractorFacts, payments: ContractorPayment[], year: number): Contractor1099 {
  const inYear = payments.filter((p) => p.date.startsWith(String(year)));
  const directCents = inYear.filter((p) => p.method === 'direct').reduce((s, p) => s + p.paidCents, 0);
  const processorCents = inYear.filter((p) => p.method === 'card_or_processor').reduce((s, p) => s + p.paidCents, 0);
  const thresholdCents = necThresholdCents(year);
  const exemptCorporation = c.entityType === 's_corp' || c.entityType === 'c_corp';
  const needs1099 = !exemptCorporation && directCents >= thresholdCents;
  const approaching = !exemptCorporation && !needs1099 && directCents >= thresholdCents * 0.75;
  const warnings: string[] = [];
  if ((needs1099 || approaching) && !c.w9Received) warnings.push('No W-9 on file — ask for one before paying more.');
  if (needs1099 && !c.tinLast4) warnings.push('Missing taxpayer ID (SSN/EIN) — it is required on the 1099-NEC.');
  if (needs1099 && !c.address) warnings.push('Missing mailing address.');
  if (exemptCorporation && directCents >= thresholdCents) warnings.push('Corporations usually don’t need a 1099-NEC (except attorneys).');
  return {
    contractorId: c.id,
    name: c.name,
    year,
    thresholdCents,
    directCents,
    processorCents,
    totalCents: directCents + processorCents,
    needs1099,
    approaching,
    exemptCorporation,
    warnings,
  };
}

/** Deadline to send the 1099-NEC to the contractor and file it with the IRS. */
export function necDeadline(year: number): string {
  const d = new Date(Date.UTC(year + 1, 0, 31));
  // Weekend → next business day.
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Retainers (expected recurring client payments)
// ---------------------------------------------------------------------------
export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RetainerFacts {
  id: number;
  clientId: number;
  name: string;
  amountCents: number;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  active: boolean;
}

function addMonthsClamped(iso: string, months: number, dayOfMonth: number): string {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(dayOfMonth, dim)).padStart(2, '0')}`;
}

/** Every date a retainer payment is expected between from and to (inclusive). */
export function retainerDueDates(r: RetainerFacts, from: string, to: string): string[] {
  const out: string[] = [];
  const end = r.endDate && r.endDate < to ? r.endDate : to;
  const day = Number(r.startDate.slice(8, 10));
  for (let i = 0; i < 2000; i++) {
    let d: string;
    switch (r.frequency) {
      case 'weekly':
        d = addDays(r.startDate, 7 * i);
        break;
      case 'biweekly':
        d = addDays(r.startDate, 14 * i);
        break;
      case 'monthly':
        d = addMonthsClamped(r.startDate, i, day);
        break;
      case 'quarterly':
        d = addMonthsClamped(r.startDate, 3 * i, day);
        break;
      case 'yearly':
        d = addMonthsClamped(r.startDate, 12 * i, day);
        break;
    }
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export interface Deposit {
  id: number;
  date: string;
  amountCents: number;
  clientId: number | null;
}

export interface ExpectedPayment {
  retainerId: number;
  clientId: number;
  name: string;
  dueDate: string;
  amountCents: number;
  status: 'received' | 'upcoming' | 'late' | 'missed';
  transactionId: number | null;
}

/**
 * Match expected retainer payments to deposits from that client: amount
 * within 5% and dated within ±10 days. Each deposit is used once.
 */
export function retainerSchedule(retainers: RetainerFacts[], deposits: Deposit[], from: string, to: string, today: string): ExpectedPayment[] {
  const used = new Set<number>();
  const out: ExpectedPayment[] = [];
  for (const r of retainers) {
    if (!r.active) continue;
    for (const due of retainerDueDates(r, from, to)) {
      const match = deposits
        .filter(
          (d) =>
            !used.has(d.id) &&
            d.clientId === r.clientId &&
            Math.abs(d.amountCents - r.amountCents) <= Math.max(100, r.amountCents * 0.05) &&
            Math.abs(daysBetween(due, d.date)) <= 10,
        )
        .sort((a, b) => Math.abs(daysBetween(due, a.date)) - Math.abs(daysBetween(due, b.date)))[0];
      if (match) used.add(match.id);
      const late = daysBetween(due, today);
      out.push({
        retainerId: r.id,
        clientId: r.clientId,
        name: r.name,
        dueDate: due,
        amountCents: r.amountCents,
        status: match ? 'received' : late > 30 ? 'missed' : late > 3 ? 'late' : 'upcoming',
        transactionId: match?.id ?? null,
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number;
}

export function lineTotal(l: InvoiceLine): number {
  return Math.round(l.quantity * l.unitCents);
}

export function invoiceTotal(lines: InvoiceLine[]): number {
  return lines.reduce((s, l) => s + lineTotal(l), 0);
}

export type InvoiceState = 'draft' | 'void' | 'paid' | 'partial' | 'overdue' | 'open';

export function invoiceState(
  inv: { status: 'draft' | 'sent' | 'void'; dueDate: string | null },
  totalCents: number,
  paidCents: number,
  today: string,
): InvoiceState {
  if (inv.status === 'void') return 'void';
  if (inv.status === 'draft') return 'draft';
  if (totalCents > 0 && paidCents >= totalCents) return 'paid';
  if (inv.dueDate && inv.dueDate < today) return 'overdue';
  if (paidCents > 0) return 'partial';
  return 'open';
}

/**
 * Deposits that could be the payment for an open invoice: the exact remaining
 * balance, on/after the issue date (allowing 3 days early), from the same
 * client or not yet tagged to a client.
 */
export function invoicePaymentCandidates(
  inv: { clientId: number; issueDate: string; balanceCents: number },
  deposits: Deposit[],
): Deposit[] {
  if (inv.balanceCents <= 0) return [];
  return deposits
    .filter(
      (d) =>
        d.amountCents === inv.balanceCents &&
        d.date >= addDays(inv.issueDate, -3) &&
        (d.clientId === null || d.clientId === inv.clientId),
    )
    .sort((a, b) => (a.clientId === inv.clientId ? -1 : 0) - (b.clientId === inv.clientId ? -1 : 0) || a.date.localeCompare(b.date));
}

/** Clients that paid you enough that they may send you a 1099-NEC (direct payments only). */
export function expectedClient1099s(
  totals: { clientId: number; name: string; directCents: number; processorCents: number }[],
  year: number,
) {
  const threshold = necThresholdCents(year);
  return totals
    .filter((t) => t.directCents >= threshold || t.processorCents > 0)
    .map((t) => ({
      ...t,
      thresholdCents: threshold,
      expect1099Nec: t.directCents >= threshold,
      // Processors send a 1099-K only above $20,000 and 200 payments (OBBBA restored this).
      viaProcessor: t.processorCents > 0,
    }));
}
