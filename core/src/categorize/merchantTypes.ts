/**
 * Built-in knowledge about common merchants. Used for:
 *  - a category *hint* when nothing else is known (never auto-confirmed),
 *  - spotting travel bookings before/after a business trip (Phase 3).
 */
export type MerchantType =
  | 'airline'
  | 'lodging'
  | 'car_rental'
  | 'rideshare'
  | 'transit'
  | 'travel_agency'
  | 'airport'
  | 'restaurant'
  | 'coffee'
  | 'gas'
  | 'parking'
  | 'software'
  | 'office'
  | 'shipping'
  | 'phone_internet'
  | 'advertising'
  | 'education'
  | 'bank_fee'
  | 'tax_payment_federal'
  | 'tax_payment_state'
  | 'professional'
  | 'grocery'
  | 'streaming';

const PATTERNS: [MerchantType, RegExp][] = [
  ['tax_payment_federal', /\bIRS\b|USATAXPYMT|US TREASURY TAX|EFTPS/],
  ['tax_payment_state', /DEPT OF (REVENUE|TAXATION)|STATE OF \w+ TAX|DEPT REVENUE|FRANCHISE TAX|TREAS(URY)? DEPT.*TAX|MI DEPT OF TREASURY/],
  ['airline', /\b(DELTA AIR|UNITED AIRLINES|AMERICAN AIRLINES|SOUTHWEST|SPIRIT AIRL|ALASKA AIR|JETBLUE|FRONTIER AIR|ALLEGIANT|SUN COUNTRY|HAWAIIAN AIR|BREEZE AIRWAYS|AIR CANADA|BRITISH AIRWAYS|LUFTHANSA)\b|AIRLINE|AIRWAYS/],
  ['lodging', /\b(MARRIOTT|HILTON|HYATT|IHG HOTELS|HOLIDAY INN|BEST WESTERN|SHERATON|WESTIN|RADISSON|LA QUINTA|MOTEL 6|SUPER 8|DAYS INN|COMFORT INN|COMFORT SUITES|QUALITY INN|HAMPTON|EMBASSY SUITES|AIRBNB|VRBO|WYNDHAM|OMNI HOTEL|KIMPTON|FOUR POINTS|ALOFT|CANDLEWOOD|STAYBRIDGE|EXTENDED STAY|DRURY|RED ROOF|COURTYARD|RESIDENCE INN|FAIRFIELD INN|SPRINGHILL|HOMEWOOD|DOUBLETREE|HOME2|TRU BY HILTON|HYATT PLACE|HOLIDAY INN EXPRESS|MOTEL|HOSTEL)\b|\bHOTEL\b|\bINN\b|\bRESORT\b|\bLODGE\b|\bSUITES\b/],
  ['car_rental', /\b(HERTZ|AVIS|ENTERPRISE RENT|NATIONAL CAR|BUDGET RENT|ALAMO|DOLLAR RENT|THRIFTY|SIXT|TURO|ZIPCAR|PAYLESS CAR)\b|RENT-?A-?CAR|CAR RENTAL/],
  ['rideshare', /^(UBER|LYFT)$|\bUBER TRIP\b|\bLYFT\b|\bTAXI\b|\bCAB\b|YELLOW CAB|CURB MOBILITY/],
  ['transit', /\bAMTRAK\b|\bGREYHOUND\b|\bMEGABUS\b|\bMETRO(CARD)?\b|\bTRANSIT\b|\bDDOT\b|\bSEPTA\b|\bMTA\b|\bBART\b|\bCTA\b|\bWMATA\b|\bPEOPLE ?MOVER\b/],
  ['travel_agency', /\b(EXPEDIA|PRICELINE|ORBITZ|HOTELS\.COM|BOOKING\.COM|KAYAK|TRAVELOCITY|HOPPER|CHEAPOAIR|TRIP\.COM)\b/],
  ['airport', /\bAIRPORT\b|\bDTW\b|\bORD\b|\bATL\b|\bLAX\b|\bTSA PRE|\bCLEAR\s?ME|\bHUDSON NEWS|\bPRIORITY PASS/],
  ['parking', /\bPARK(ING|MOBILE| WHIZ|WHIZ)\b|SPOTHERO|\bGARAGE\b|\bTOLL\b|E-ZPASS|\bSUNPASS\b|\bFASTRAK\b|\bI-PASS\b|\bPEACH PASS\b|\bTXTAG\b|\bPLATEPAY\b/],
  ['gas', /^(SHELL|EXXONMOBIL|BP|SPEEDWAY|CHEVRON|MARATHON|CIRCLE K|SUNOCO|CITGO|VALERO|PHILLIPS 66|CONOCO|ARCO|MOBIL|WAWA|SHEETZ|QUIKTRIP|QT|KWIK TRIP|CASEY'?S|MURPHY USA|RACETRAC|PILOT|LOVE'?S|FLYING J|MEIJER GAS|KROGER FUEL|COSTCO GAS|SAMS FUEL|THORNTONS|GETGO)\b|\bFUEL\b|\bGAS STATION\b|\bPETRO\b/],
  ['coffee', /\b(STARBUCKS|DUNKIN|TIM HORTONS|PEET'?S|CARIBOU|BIGGBY|DUTCH BROS|BLUE BOTTLE)\b|\bCOFFEE\b|\bCAFE\b|\bESPRESSO\b/],
  ['restaurant', /\b(MCDONALDS|CHIPOTLE|PANERA|SUBWAY|WENDY'?S|BURGER KING|TACO BELL|CHICK-FIL-A|CHICK FIL A|POTBELLY|JIMMY JOHNS|DOMINOS|PIZZA HUT|PAPA JOHNS|OLIVE GARDEN|APPLEBEES|CHILIS|BUFFALO WILD|SHAKE SHACK|FIVE GUYS|QDOBA|NOODLES|PANDA EXPRESS|DOORDASH|GRUBHUB|UBER EATS|POSTMATES|SEAMLESS)\b|RESTAURANT|\bGRILL\b|\bDINER\b|\bBISTRO\b|\bTAVERN\b|\bPIZZA\b|\bSUSHI\b|\bTACO\b|\bBBQ\b|\bBAR ?-?B ?-?Q\b|BARBE?CUE|\bBAR & GRILL\b|\bKITCHEN\b|\bEATERY\b|\bBURGER\b|\bSTEAKHOUSE\b|\bPUB\b|\bCANTINA\b|\bBAKERY\b|\bDELI\b/],
  ['software', /\b(ADOBE|MICROSOFT|GOOGLE WORKSPACE|GOOGLE ONE|DROPBOX|ZOOM|SLACK|NOTION|GITHUB|OPENAI|ANTHROPIC|INTUIT|CANVA|SQUARESPACE|WIX|GODADDY|NAMECHEAP|SHOPIFY|MAILCHIMP|HUBSPOT|DOCUSIGN|CALENDLY|LASTPASS|1PASSWORD|AMAZON WEB SERVICES|DIGITALOCEAN|HEROKU|ATLASSIAN|FIGMA|AUTODESK|JETBRAINS|GRAMMARLY|DOCUSIGN|QUICKBOOKS|FRESHBOOKS|XERO|GUSTO)\b/],
  ['office', /\b(OFFICE DEPOT|STAPLES|OFFICEMAX)\b/],
  ['shipping', /^(USPS|FEDEX|UPS)$|\bSTAMPS\.COM\b|\bPIRATE SHIP\b|\bSHIPSTATION\b/],
  ['phone_internet', /^(VERIZON|AT&T|T-MOBILE|XFINITY|SPECTRUM|COX|FRONTIER|CENTURYLINK|GOOGLE FI|MINT MOBILE|VISIBLE|STARLINK)$|\bWIRELESS\b|\bINTERNET\b/],
  ['advertising', /\b(FACEBK|FACEBOOK ADS|META ADS|GOOGLE ADS|GOOGLE \*ADS|LINKEDIN ADS|YELP ADS|NEXTDOOR|VISTAPRINT|MOO PRINT)\b/],
  ['education', /\b(UDEMY|COURSERA|LINKEDIN LEARNING|SKILLSHARE|MASTERCLASS|PLURALSIGHT|O'?REILLY)\b/],
  ['bank_fee', /\b(MONTHLY (SERVICE|MAINTENANCE) FEE|SERVICE CHARGE|ANNUAL FEE|OVERDRAFT|WIRE FEE|FOREIGN TRANSACTION FEE|ATM FEE)\b/],
  ['professional', /\b(CPA|ACCOUNTING|ATTORNEY|LAW OFFICE|LEGALZOOM|TAX PREP|H&R BLOCK|TURBOTAX)\b/],
  ['grocery', /\b(KROGER|MEIJER|WHOLE FOODS|TRADER JOE'?S|ALDI|PUBLIX|SAFEWAY|WEGMANS|HEB|H-E-B|ALBERTSONS|FOOD LION|GIANT EAGLE|HY-VEE|SPROUTS|INSTACART)\b|GROCERY|SUPERMARKET/],
  ['streaming', /^(NETFLIX|SPOTIFY|HULU|DISNEY PLUS|DISNEYPLUS|HBO MAX|MAX|PEACOCK|PARAMOUNT|YOUTUBE PREMIUM|APPLE TV)$|NETFLIX|SPOTIFY|HULU/],
];

export function merchantTypeOf(merchantKey: string, description = ''): MerchantType | null {
  const hay = `${merchantKey}`.toUpperCase();
  const full = `${merchantKey} ${description}`.toUpperCase();
  for (const [type, re] of PATTERNS) {
    if (re.test(hay)) return type;
  }
  for (const [type, re] of PATTERNS) {
    if (re.test(full)) return type;
  }
  return null;
}

export const TRAVEL_BOOKING_TYPES: MerchantType[] = ['airline', 'lodging', 'car_rental', 'travel_agency', 'airport'];

/**
 * Default category key for a merchant type.
 * `onTrip` switches meals → travel meals and gas → rental-car fuel.
 */
export function categoryKeyForType(type: MerchantType, onTrip = false): string | null {
  switch (type) {
    case 'airline':
      return 'travel_airfare';
    case 'lodging':
      return 'travel_lodging';
    case 'car_rental':
      return 'travel_car';
    case 'rideshare':
    case 'transit':
      return 'travel_ground';
    case 'travel_agency':
      return 'travel_airfare';
    case 'airport':
      return 'travel_other';
    case 'restaurant':
    case 'coffee':
      return onTrip ? 'travel_meals' : 'meals';
    case 'gas':
      return onTrip ? 'travel_car' : 'vehicle_actual';
    case 'parking':
      return onTrip ? 'travel_other' : 'parking_tolls';
    case 'software':
      return 'software';
    case 'office':
      return 'office';
    case 'shipping':
      return 'office';
    case 'phone_internet':
      return 'phone_internet';
    case 'advertising':
      return 'advertising';
    case 'education':
      return 'education';
    case 'bank_fee':
      return 'bank_fees';
    case 'professional':
      return 'legal_professional';
    case 'tax_payment_federal':
      return 'est_tax_federal';
    case 'tax_payment_state':
      return 'est_tax_state';
    case 'grocery':
    case 'streaming':
      return null;
  }
}

/** Types that are almost always personal for most self-employed people. */
export const LIKELY_PERSONAL_TYPES: MerchantType[] = ['grocery', 'streaming'];
