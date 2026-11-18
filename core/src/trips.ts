import { addDays, daysBetween } from './dates';
import { categoryKeyForType, merchantTypeOf, TRAVEL_BOOKING_TYPES, type MerchantType } from './categorize/merchantTypes';
import { looksLikeTransfer } from './categorize/transfers';

/**
 * Business trips: "everything I spent in Detroit Oct 12–16 was for work, plus
 * the flight/hotel/rental car I booked beforehand".
 */
export interface TripWindow {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  destCity: string | null;
  destState: string | null;
  /** How far before the trip to look for flight/hotel/car bookings. */
  beforeDays: number;
  /** How far after the trip to look for late-posting hotel/rental charges. */
  afterDays: number;
}

export interface TripTxn {
  id: number;
  date: string;
  amountCents: number;
  merchantKey: string;
  description: string;
  city: string | null;
  state: string | null;
  isOnline: boolean;
  status: 'unreviewed' | 'suggested' | 'reviewed';
  classification: 'business' | 'personal' | 'transfer' | null;
  categoryId: number | null;
  tripId: number | null;
}

export type CandidateReason = 'during' | 'booked_before' | 'posted_after';

export interface TripCandidate {
  id: number;
  reason: CandidateReason;
  /** Pre-ticked in the review screen. */
  preselect: boolean;
  /** Trip-aware category (meals → travel meals, gas → rental-car fuel…). */
  suggestedCategoryKey: string | null;
  /** Short human explanation shown next to the row. */
  why: string;
  merchantType: MerchantType | null;
}

const ALWAYS_PERSONAL_ON_TRIP: MerchantType[] = ['streaming', 'grocery'];
const POST_TRIP_TYPES: MerchantType[] = ['lodging', 'car_rental', 'airline', 'airport', 'parking', 'rideshare'];

/** The state you live in: the most common state among in-person card purchases. */
export function inferHomeState(txns: Pick<TripTxn, 'state' | 'isOnline'>[]): string | null {
  const counts = new Map<string, number>();
  for (const t of txns) {
    if (!t.state || t.isOnline) continue;
    counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [s, c] of counts) {
    if (c > n) {
      best = s;
      n = c;
    }
  }
  return best;
}

function sameCity(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Hotels and rental cars are charged where they are; airlines and booking sites bill from HQ. */
const LOCAL_CHARGE_TYPES: MerchantType[] = ['lodging', 'car_rental'];
const HQ_BILLED_TYPES: MerchantType[] = ['airline', 'travel_agency'];

/**
 * Decide which transactions belong to a trip and which should be pre-ticked.
 * Transfers and transactions already assigned to another trip are excluded.
 */
export function tripCandidates(trip: TripWindow, txns: TripTxn[], homeState: string | null): TripCandidate[] {
  const out: TripCandidate[] = [];
  const bookFrom = addDays(trip.startDate, -trip.beforeDays);
  const postTo = addDays(trip.endDate, trip.afterDays);
  const destState = trip.destState?.toUpperCase() ?? null;
  const awayFromHome = !!destState && !!homeState && destState !== homeState;
  const destinationKnown = !!destState || !!trip.destCity;

  // In-person purchases in some *other* state before this trip are evidence of
  // a different trip; bookings made before those are probably for that one.
  // (Airlines and booking sites don't count: their location is their HQ.)
  const otherTrips = txns
    .filter(
      (t) =>
        t.amountCents < 0 && !t.isOnline && t.state && t.date < trip.startDate &&
        t.state !== homeState && t.state !== destState && t.classification !== 'transfer' &&
        !HQ_BILLED_TYPES.includes(merchantTypeOf(t.merchantKey, t.description) as MerchantType),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const t of txns) {
    if (t.tripId !== null && t.tripId !== trip.id) continue;
    if (t.classification === 'transfer' || looksLikeTransfer(t.description)) continue;
    if (t.date < bookFrom || t.date > postTo) continue;

    const type = merchantTypeOf(t.merchantKey, t.description);
    const atDestination = (destState && t.state === destState && !t.isOnline) || sameCity(t.city, trip.destCity);
    const atHome = awayFromHome && !t.isOnline && t.state === homeState;
    const personalAlready = t.status === 'reviewed' && t.classification === 'personal';
    const category = type ? categoryKeyForType(type, true) : null;

    if (t.date >= trip.startDate && t.date <= trip.endDate) {
      let preselect = true;
      let why = 'During the trip';
      if (personalAlready) {
        preselect = false;
        why = 'During the trip, but you marked it personal';
      } else if (type && ALWAYS_PERSONAL_ON_TRIP.includes(type)) {
        preselect = false;
        why = 'During the trip, but usually personal';
      } else if (atHome) {
        preselect = false;
        why = `During the trip, but charged in ${t.city ? `${t.city}, ` : ''}${t.state} (home)`;
      } else if (atDestination) {
        why = `During the trip, in ${t.city ? `${t.city}, ` : ''}${t.state}`;
      } else if (t.amountCents > 0) {
        why = 'Refund/credit during the trip';
      }
      out.push({ id: t.id, reason: 'during', preselect, suggestedCategoryKey: category, why, merchantType: type });
      continue;
    }

    // A hotel or rental car charged in person somewhere other than the destination
    // belongs to some other stay.
    const chargedElsewhere =
      destinationKnown && !!type && LOCAL_CHARGE_TYPES.includes(type) && !t.isOnline && !!t.state && !atDestination;

    if (t.date < trip.startDate) {
      // Only travel bookings count before the trip.
      if (!type || !TRAVEL_BOOKING_TYPES.includes(type) || chargedElsewhere || t.amountCents > 0) continue;
      const days = daysBetween(t.date, trip.startDate);
      const laterTrip = otherTrips.find((o) => o.date >= t.date);
      out.push({
        id: t.id,
        reason: 'booked_before',
        preselect: !personalAlready && !laterTrip,
        suggestedCategoryKey: category,
        why: laterTrip
          ? `${typeLabel(type)} — probably for your ${monthDay(laterTrip.date)} trip to ${laterTrip.state}`
          : `${typeLabel(type)} booked ${days} day${days === 1 ? '' : 's'} before`,
        merchantType: type,
      });
      continue;
    }

    // After the trip: late-posting hotel folios, rental car final bills…
    const travelType = type && POST_TRIP_TYPES.includes(type);
    if ((!travelType && !atDestination) || chargedElsewhere) continue;
    const days = daysBetween(trip.endDate, t.date);
    out.push({
      id: t.id,
      reason: 'posted_after',
      preselect: !personalAlready && (type === 'lodging' || type === 'car_rental' || !!atDestination),
      suggestedCategoryKey: category,
      why: `Posted ${days} day${days === 1 ? '' : 's'} after${atDestination ? ` · ${t.state}` : ''}`,
      merchantType: type,
    });
  }
  const order: Record<CandidateReason, number> = { booked_before: 0, during: 1, posted_after: 2 };
  return out.sort((a, b) => order[a.reason] - order[b.reason]);
}

function typeLabel(t: MerchantType): string {
  switch (t) {
    case 'airline':
      return 'Flight';
    case 'lodging':
      return 'Lodging';
    case 'car_rental':
      return 'Rental car';
    case 'travel_agency':
      return 'Travel booking';
    case 'airport':
      return 'Airport charge';
    default:
      return 'Booking';
  }
}

/**
 * For a newly imported transaction: does it fall inside (or just before/after)
 * an existing trip? Returns the trip and a trip-aware category key.
 */
export function matchTrip(
  trips: TripWindow[],
  t: Omit<TripTxn, 'id' | 'status' | 'classification' | 'categoryId' | 'tripId'>,
  homeState: string | null,
): { tripId: number; categoryKey: string | null; reason: CandidateReason } | null {
  for (const trip of trips) {
    const c = tripCandidates(trip, [{ ...t, id: -1, status: 'unreviewed', classification: null, categoryId: null, tripId: null }], homeState)[0];
    if (c && c.preselect) return { tripId: trip.id, categoryKey: c.suggestedCategoryKey, reason: c.reason };
  }
  return null;
}

export interface TripSuggestion {
  state: string;
  cities: string[];
  startDate: string;
  endDate: string;
  transactionCount: number;
  totalCents: number;
}

/**
 * Spot likely trips: runs of in-person card purchases outside your home state,
 * at most `maxGapDays` apart, not already covered by a trip.
 */
export function suggestTrips(
  txns: TripTxn[],
  homeState: string | null,
  existing: Pick<TripWindow, 'startDate' | 'endDate'>[],
  maxGapDays = 2,
): TripSuggestion[] {
  if (!homeState) return [];
  const away = txns
    .filter((t) => t.state && !t.isOnline && t.state !== homeState && t.amountCents < 0 && t.classification !== 'transfer')
    .filter((t) => !existing.some((e) => t.date >= e.startDate && t.date <= e.endDate))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: TripSuggestion[] = [];
  let cur: { state: string; items: TripTxn[] } | null = null;
  const flush = () => {
    if (cur && cur.items.length >= 2) {
      const cities = [...new Set(cur.items.map((i) => i.city).filter((c): c is string => !!c))];
      out.push({
        state: cur.state,
        cities,
        startDate: cur.items[0].date,
        endDate: cur.items[cur.items.length - 1].date,
        transactionCount: cur.items.length,
        totalCents: cur.items.reduce((s, i) => s + i.amountCents, 0),
      });
    }
    cur = null;
  };
  for (const t of away) {
    if (cur && (t.state !== cur.state || daysBetween(cur.items[cur.items.length - 1].date, t.date) > maxGapDays)) flush();
    if (!cur) cur = { state: t.state!, items: [] };
    cur.items.push(t);
  }
  flush();
  return out.sort((a, b) => b.startDate.localeCompare(a.startDate));
}
