import { isUsStateCode } from './usStates';

/**
 * Turn a raw bank description into a clean merchant name plus (when present)
 * the city/state that card networks append. Example:
 *   "PURCHASE AUTHORIZED ON 10/12 SQ *JOES DINER #12 DETROIT MI S386285123 CARD 1234"
 *   → { merchant: "Joes Diner", city: "Detroit", state: "MI" }
 */
export interface MerchantInfo {
  /** Display name, Title Case. */
  merchant: string;
  /** Upper-case key used for matching/history ("JOES DINER"). */
  merchantKey: string;
  city: string | null;
  state: string | null;
  /** True when the description looks like an online/phone merchant (location is HQ, not you). */
  online: boolean;
}

const BANK_PREFIXES: RegExp[] = [
  /^PURCHASE AUTHORI[SZ]ED ON \d{1,2}\/\d{1,2}(\/\d{2,4})?\s*/,
  /^RECURRING (DEBIT CARD |CARD )?PURCHASE( \d{1,2}\/\d{1,2})?\s*-?\s*/,
  /^(POS|DEBIT|DBT|VISA|MC)\s+(DEBIT|PURCHASE|WITHDRAWAL|PUR|CRD|CARD)(\s+(PURCHASE|PUR))?\s*-?\s*/,
  /^DEBIT CARD (PURCHASE|PURCH|DEBIT|TRANSACTION)\s*-?\s*/,
  /^CHECK ?CARD( PURCHASE)?( \d{4})?\s*-?\s*/,
  /^CARD PURCHASE( WITH PIN)?( \d{1,2}\/\d{1,2})?\s*-?\s*/,
  /^POS\s+(\d{1,2}\/\d{1,2}\s+)?/,
  /^PURCHASE\s*-?\s*(\d{1,2}\/\d{1,2}\s+)?/,
  /^ACH (DEBIT|CREDIT|WITHDRAWAL|DEPOSIT|PMT|PAYMENT)\s*-?\s*/,
  /^ELECTRONIC (WITHDRAWAL|PAYMENT|DEPOSIT)\s*-?\s*/,
  /^PRE-?AUTHORI[SZ]ED (DEBIT|CREDIT|PAYMENT)\s*-?\s*/,
  /^(WEB|TEL|PPD|CCD) (AUTHORIZED )?(PMT|PAYMENT)\s*-?\s*/,
  /^BILL ?PAY(MENT)?\s*-?\s*/,
  /^\d{1,2}\/\d{1,2}\s+/, // leading date "10/12 "
];

/** Payment processors / aggregators whose prefix hides the real merchant. */
const PROCESSOR_PREFIXES =
  /^(SQ|SQU|TST|SP|PP|PAYPAL|IN|DD|PY|CKE|FS|BT|LS|EB|AplPay|APLPAY|APPLE PAY|GPAY|SMK|ZSK|PAR|WPY|IC|CLR|PMT|GOOGLE PAY)\s*\*\s*/i;

const KNOWN_ALIASES: [RegExp, string][] = [
  [/^AMZN( MKTP| MARKETPLACE)?( US)?\b|^AMAZON\.COM|^AMAZON MKTPL|^AMAZON MARK/, 'AMAZON'],
  [/^AMAZON PRIME|^PRIME VIDEO/, 'AMAZON PRIME'],
  [/^AMAZON WEB SERVICES|^AWS\b/, 'AMAZON WEB SERVICES'],
  [/^UBER\s*\*?\s*EATS|^UBEREATS/, 'UBER EATS'],
  [/^UBER\b/, 'UBER'],
  [/^LYFT\b/, 'LYFT'],
  [/^DOORDASH|^DD DOORDASH/, 'DOORDASH'],
  [/^WM SUPERCENTER|^WAL-?MART/, 'WALMART'],
  [/^TARGET\b/, 'TARGET'],
  [/^COSTCO( WHSE| GAS)?/, 'COSTCO'],
  [/^STARBUCKS/, 'STARBUCKS'],
  [/^MCDONALD'?S/, 'MCDONALDS'],
  [/^DELTA AIR|^DELTA\b/, 'DELTA AIR LINES'],
  [/^UNITED AIR|^UNITED\s+\d{6,}/, 'UNITED AIRLINES'],
  [/^AMERICAN AIR|^AA\s+\d{6,}/, 'AMERICAN AIRLINES'],
  [/^SOUTHWEST AIR|^SOUTHWES\b|^SWA\b/, 'SOUTHWEST AIRLINES'],
  [/^SPIRIT AIR/, 'SPIRIT AIRLINES'],
  [/^ALASKA AIR/, 'ALASKA AIRLINES'],
  [/^JETBLUE/, 'JETBLUE'],
  [/^FRONTIER AIR|^FRONTIER\s+\d+/, 'FRONTIER AIRLINES'],
  [/^HERTZ/, 'HERTZ'],
  [/^ENTERPRISE RENT|^ENTERPRISE\b/, 'ENTERPRISE RENT-A-CAR'],
  [/^NATIONAL CAR/, 'NATIONAL CAR RENTAL'],
  [/^AVIS\b/, 'AVIS'],
  [/^BUDGET RENT|^BUDGET CAR/, 'BUDGET RENT A CAR'],
  // Hotels keep their own brand name (Hampton Inn stays Hampton Inn).
  [/^MARRIOTT/, 'MARRIOTT'],
  [/^COURTYARD\b/, 'COURTYARD BY MARRIOTT'],
  [/^HILTON\b/, 'HILTON'],
  [/^HAMPTON INN/, 'HAMPTON INN'],
  [/^HYATT/, 'HYATT'],
  [/^HOLIDAY INN|^IHG|^CROWNE PLAZA/, 'IHG HOTELS'],
  [/^AIRBNB/, 'AIRBNB'],
  [/^VRBO/, 'VRBO'],
  [/^EXPEDIA/, 'EXPEDIA'],
  [/^GOOGLE\s*\*?\s*(GSUITE|WORKSPACE|G SUITE)/, 'GOOGLE WORKSPACE'],
  [/^GOOGLE\s*\*?\s*(STORAGE|ONE)/, 'GOOGLE ONE'],
  [/^MICROSOFT\s*\*?|^MSFT\b/, 'MICROSOFT'],
  [/^ADOBE/, 'ADOBE'],
  [/^APPLE\.COM\/BILL|^APPLE\.COM/, 'APPLE.COM'],
  [/^INTUIT|^QBOOKS|^QUICKBOOKS/, 'INTUIT'],
  [/^SHELL( OIL)?\b/, 'SHELL'],
  [/^EXXON|^EXXONMOBIL|^MOBIL\b/, 'EXXONMOBIL'],
  [/^BP\b|^BP#/, 'BP'],
  [/^SPEEDWAY/, 'SPEEDWAY'],
  [/^CHEVRON/, 'CHEVRON'],
  [/^MARATHON PETRO|^MARATHON\b/, 'MARATHON'],
  [/^CIRCLE K/, 'CIRCLE K'],
  [/^7-ELEVEN|^7 ELEVEN/, '7-ELEVEN'],
  [/^VERIZON/, 'VERIZON'],
  [/^AT&T|^ATT\b/, 'AT&T'],
  [/^T-MOBILE|^TMOBILE/, 'T-MOBILE'],
  [/^COMCAST|^XFINITY/, 'XFINITY'],
  [/^SPECTRUM/, 'SPECTRUM'],
  [/^USPS/, 'USPS'],
  [/^FEDEX/, 'FEDEX'],
  [/^THE UPS STORE|^UPS\b/, 'UPS'],
  [/^OFFICE DEPOT|^OFFICEMAX/, 'OFFICE DEPOT'],
  [/^STAPLES/, 'STAPLES'],
  [/^HOME DEPOT|^THE HOME DEPOT/, 'HOME DEPOT'],
  [/^LOWE'?S/, 'LOWES'],
  [/^BEST BUY|^BESTBUY/, 'BEST BUY'],
  [/^IRS USATAXPYMT|^IRS\s+TREAS|^US TREASURY\s+TAX/, 'IRS'],
  [/^ZOOM\.US|^ZOOM VIDEO/, 'ZOOM'],
  [/^OPENAI|^CHATGPT/, 'OPENAI'],
  [/^ANTHROPIC|^CLAUDE\.AI/, 'ANTHROPIC'],
  [/^GITHUB/, 'GITHUB'],
  [/^DROPBOX/, 'DROPBOX'],
  [/^NETFLIX/, 'NETFLIX'],
  [/^SPOTIFY/, 'SPOTIFY'],
  [/^PARKMOBILE/, 'PARKMOBILE'],
  [/^SPOTHERO/, 'SPOTHERO'],
  [/^E-?Z ?PASS|^EZPASS/, 'E-ZPASS'],
];

/** Words that commonly start two-word US city names. */
const CITY_FIRST_WORDS = new Set([
  'SAN', 'LOS', 'LAS', 'NEW', 'ST', 'SAINT', 'FT', 'FORT', 'EL', 'SANTA', 'PORT', 'GRAND',
  'SALT', 'BATON', 'CEDAR', 'COLORADO', 'WEST', 'EAST', 'NORTH', 'SOUTH', 'LAKE', 'PALM',
  'MOUNT', 'MT', 'BEVERLY', 'ANN', 'ROYAL', 'STERLING', 'OVERLAND', 'KANSAS', 'OKLAHOMA',
  'CORPUS', 'VIRGINIA', 'LONG', 'NIAGARA', 'GREEN', 'BOWLING', 'CAPE', 'CORAL', 'DES',
  'CHULA', 'DALY', 'DEL', 'DOWNERS', 'ELK', 'FALLS', 'GLEN', 'GULF', 'HIGH', 'HUNTINGTON',
  'IOWA', 'JERSEY', 'JOHNSON', 'LA', 'LITTLE', 'MIAMI', 'MORENO', 'NEWPORT', 'OAK', 'ORANGE',
  'PALO', 'PEMBROKE', 'POMPANO', 'RANCHO', 'REDONDO', 'RIO', 'ROCK', 'ROUND', 'SIOUX',
  'SILVER', 'SPRING', 'STATE', 'SUGAR', 'SUN', 'THOUSAND', 'TWIN', 'UNION', 'UNIVERSITY',
  'VALLEY', 'WALNUT', 'WHITE', 'WINSTON', 'BLOOMFIELD', 'FARMINGTON', 'MADISON', 'STERLING',
  'ROCHESTER', 'DEARBORN', 'GROSSE', 'BATTLE', 'TRAVERSE', 'BAY', 'BENTON', 'MUSKEGON',
]);

const NOISE_PATTERNS: RegExp[] = [
  /\bCARD\s*(ENDING IN\s*)?\d{4}\b/g,
  /\bX{2,}\d{2,}\b/g,
  /\*{2,}\d{2,}/g,
  /\bREF\s*#?\s*[A-Z0-9]+\b/g,
  /\bS\d{9,}\b/g,
  /\bP\d{9,}\b/g,
  /\bTRACE\s*#?\s*\d+\b/g,
  /\bID:?\s*[A-Z0-9]{6,}\b/g,
  /\bPPD\s+ID:?\s*\S+/g,
  /\bWEB\s+ID:?\s*\S+/g,
  /\bCONF\s*#?\s*\S+/g,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g,
];

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Usa|Us|Ups|Usps|Bp|Irs|Ihg|Aws|At&t|Atm|Cvs|Ikea|Dmv)\b/g, (m) => m.toUpperCase())
    .replace(/'S\b/g, "'s");
}

function isWebOrPhoneToken(tok: string): boolean {
  return /\.(COM|NET|ORG|IO|CO|AI|US)\b|WWW\.|HTTP|\b\d{3}[-.]\d{3}[-.]\d{4}\b|\b\d{10}\b|\//.test(tok);
}

/** Extract a trailing "CITY ST [ZIP] [USA]" location. Mutates nothing; returns remainder. */
function extractLocation(desc: string): { rest: string; city: string | null; state: string | null; online: boolean } {
  let s = desc.replace(/\s+(USA|US|UNITED STATES)$/, '').trim();
  s = s.replace(/\s+\d{5}(-\d{4})?$/, '').trim();

  // Glued web+state ("AMZN.COM/BILLWA", "HELP.UBER.COMCA")
  const glued = s.match(/^(.*?)(\S*\.(?:COM|NET|ORG)\S*?)([A-Z]{2})$/);
  if (glued && isUsStateCode(glued[3])) {
    return { rest: (glued[1] + glued[2]).trim(), city: null, state: glued[3], online: true };
  }

  const m = s.match(/^(.*?)[\s,]+([A-Z]{2})$/);
  if (!m || !isUsStateCode(m[2])) return { rest: s, city: null, state: null, online: isWebOrPhoneToken(s) };
  const state = m[2];
  const before = m[1].trim();

  // Fixed-width card descriptors often separate city with 2+ spaces.
  const wide = before.match(/^(.*\S)\s{2,}([A-Z][A-Z .'-]{1,24})$/);
  let rest = before;
  let city: string | null = null;
  if (wide && !/\d/.test(wide[2])) {
    rest = wide[1];
    city = wide[2].trim();
  } else {
    const tokens = before.split(/\s+/);
    const last = tokens[tokens.length - 1] ?? '';
    if (tokens.length >= 2 && /^[A-Z][A-Z.'-]+$/.test(last) && !isWebOrPhoneToken(last)) {
      const prev = tokens[tokens.length - 2];
      if (tokens.length >= 3 && CITY_FIRST_WORDS.has(prev.replace(/\./g, ''))) {
        city = `${prev} ${last}`;
        rest = tokens.slice(0, -2).join(' ');
      } else {
        city = last;
        rest = tokens.slice(0, -1).join(' ');
      }
    }
  }
  const online = isWebOrPhoneToken(before);
  if (online) city = null;
  return { rest: rest.trim(), city: city ? titleCase(city) : null, state, online };
}

export function normalizeMerchant(rawDescription: string): MerchantInfo {
  let s = String(rawDescription ?? '')
    .toUpperCase()
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{3,}/g, '  ')
    .trim();

  for (const re of BANK_PREFIXES) s = s.replace(re, '');
  for (const re of NOISE_PATTERNS) s = s.replace(re, ' ');
  s = s.replace(/[ ]{3,}/g, '  ').trim();

  const loc = extractLocation(s);
  s = loc.rest;

  s = s.replace(PROCESSOR_PREFIXES, '');
  s = s.replace(PROCESSOR_PREFIXES, ''); // e.g. "PAYPAL *SQ *..."

  // "AMAZON.COM*2K3L45" / "UBER *TRIP" — drop codes after '*', keep words.
  s = s.replace(/\s*\*\s*([A-Z0-9]+)/g, (_m, tail: string) => (/\d/.test(tail) ? '' : ` ${tail}`));
  // Store numbers and long digit runs
  s = s
    .replace(/#\s*\d+/g, ' ')
    .replace(/\bSTORE\s*\d+/g, ' ')
    .replace(/\b(NO|NUM)\.?\s*\d+\b/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\s[-–]\s*$/, '')
    .replace(/[^A-Z0-9&'.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [re, canonical] of KNOWN_ALIASES) {
    if (re.test(s)) {
      s = canonical;
      break;
    }
  }
  if (!s) s = String(rawDescription ?? '').trim().toUpperCase().slice(0, 40) || 'UNKNOWN';

  return {
    merchant: titleCase(s),
    merchantKey: s,
    city: loc.city,
    state: loc.state,
    online: loc.online,
  };
}
