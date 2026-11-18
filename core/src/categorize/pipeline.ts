import { categoryKeyForType, LIKELY_PERSONAL_TYPES, merchantTypeOf } from './merchantTypes';
import { matchTrip, type TripWindow } from '../trips';
import { firstMatchingRule } from './rules';
import { looksLikeTransfer } from './transfers';
import type { CategorizeResult, Classification, Rule, TxnFacts } from './types';

/** How you've categorised a merchant before (from reviewed transactions). */
export interface HistoryEntry {
  classification: Classification;
  categoryId: number | null;
  count: number;
}

export interface CategorizeContext {
  rules: Rule[];
  /** merchantKey (upper case) → past outcomes. */
  history: Map<string, HistoryEntry[]>;
  /** Default-category key → database id. */
  categoryIdByKey: Record<string, number>;
  /** Business trips: spending inside a trip window is suggested as business. */
  trips?: TripWindow[];
  homeState?: string | null;
}

const NONE: CategorizeResult = {
  status: 'unreviewed',
  classification: null,
  categoryId: null,
  source: null,
  confidence: null,
};

export function suggestFromHistory(entries: HistoryEntry[] | undefined): CategorizeResult | null {
  if (!entries || entries.length === 0) return null;
  const total = entries.reduce((s, e) => s + e.count, 0);
  const top = [...entries].sort((a, b) => b.count - a.count)[0];
  const confidence = top.count / total;
  if (confidence < 0.6) return null; // you've done different things with this merchant; ask
  return {
    status: 'suggested',
    classification: top.classification,
    categoryId: top.categoryId,
    source: 'history',
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * Decide what to do with a new transaction:
 *  1. your rules (auto-confirmed or suggested, per rule)
 *  2. transfers / card payments
 *  3. inside a business trip (or a booking just before one) → suggested business
 *  4. how you treated this merchant before
 *  5. built-in merchant knowledge → category hint only
 *  6. otherwise → Needs Review with no hint
 */
export function categorize(t: TxnFacts & { merchantKey: string }, ctx: CategorizeContext): CategorizeResult {
  const rule = firstMatchingRule(ctx.rules, t);
  if (rule) {
    const a = rule.actions;
    const classification: Classification = a.classification ?? 'business';
    return {
      status: rule.autoConfirm ? 'reviewed' : 'suggested',
      classification,
      categoryId: classification === 'business' ? a.categoryId ?? null : null,
      businessPct: a.businessPct && a.businessPct > 0 && a.businessPct < 100 ? a.businessPct : undefined,
      source: 'rule',
      confidence: 1,
      ruleId: rule.id,
      note: a.note,
    };
  }

  if (looksLikeTransfer(t.description)) {
    return { status: 'suggested', classification: 'transfer', categoryId: null, source: 'transfer', confidence: 0.9 };
  }

  const fromHistory = suggestFromHistory(ctx.history.get(t.merchantKey.toUpperCase()));

  if (ctx.trips?.length) {
    const trip = matchTrip(
      ctx.trips,
      {
        date: t.date,
        amountCents: t.amountCents,
        merchantKey: t.merchantKey,
        description: t.description,
        city: t.city,
        state: t.state,
        isOnline: !!t.isOnline,
      },
      ctx.homeState ?? null,
    );
    if (trip) {
      const historyCategory = fromHistory?.classification === 'business' ? fromHistory.categoryId : null;
      return {
        status: 'suggested',
        classification: 'business',
        categoryId: (trip.categoryKey ? ctx.categoryIdByKey[trip.categoryKey] : null) ?? historyCategory ?? null,
        source: 'trip',
        confidence: 0.8,
        tripId: trip.tripId,
      };
    }
  }

  if (fromHistory) return fromHistory;

  const type = merchantTypeOf(t.merchantKey, t.description);
  if (type) {
    if (LIKELY_PERSONAL_TYPES.includes(type)) {
      return { status: 'suggested', classification: 'personal', categoryId: null, source: 'keyword', confidence: 0.5 };
    }
    const key = categoryKeyForType(type);
    const categoryId = key ? ctx.categoryIdByKey[key] ?? null : null;
    if (type === 'tax_payment_federal' || type === 'tax_payment_state') {
      return { status: 'suggested', classification: 'business', categoryId, source: 'keyword', confidence: 0.8 };
    }
    // Category hint only — you still decide business vs personal.
    return { ...NONE, categoryId, source: 'keyword', confidence: 0.4 };
  }
  return { ...NONE };
}
