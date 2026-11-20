import { parseDateWithFormat } from '../dates';
import { parseAmountToCents } from '../money';
import type { OfxStatement, ParsedTransaction, RowError } from './types';

/**
 * Minimal, dependency-free reader for OFX / QFX / QBO files ("Download for
 * Quicken / QuickBooks"). Handles both OFX 1.x (SGML, leaf tags without
 * closing tags) and OFX 2.x (XML).
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&');
}

/** Read leaf values (<TAG>value) from an OFX fragment. First occurrence wins. */
function leafValues(fragment: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<([A-Z0-9_.]+)>([^<\r\n]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) {
    const tag = m[1].toUpperCase();
    const value = decodeEntities(m[2].trim());
    if (value !== '' && !(tag in out)) out[tag] = value;
  }
  return out;
}

export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 4000).toUpperCase();
  return head.includes('OFXHEADER') || head.includes('<OFX>') || head.includes('<?OFX');
}

export function parseOfx(text: string): OfxStatement {
  const upper = text.toUpperCase();
  const start = upper.indexOf('<OFX>');
  if (start < 0) throw new Error('This does not look like an OFX/QFX/QBO file (no <OFX> section).');
  const body = text.slice(start);
  const bodyUpper = body.toUpperCase();

  const isCard = bodyUpper.includes('<CCSTMTRS>') || bodyUpper.includes('<CCACCTFROM>');
  const acctBlock = body.match(/<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)(<\/\1>|<BANKTRANLIST>|<\/STMTRS>|<\/CCSTMTRS>)/i);
  const acct = acctBlock ? leafValues(acctBlock[2]) : {};
  let accountType: OfxStatement['accountType'] = isCard ? 'credit_card' : 'other';
  if (!isCard && acct.ACCTTYPE) {
    const t = acct.ACCTTYPE.toUpperCase();
    accountType = t === 'CHECKING' ? 'checking' : t === 'SAVINGS' || t === 'MONEYMRKT' ? 'savings' : t === 'CREDITLINE' ? 'credit_card' : 'other';
  }
  const curMatch = body.match(/<CURDEF>([^<\r\n]+)/i);
  const ledger = body.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i);
  const ledgerVals = ledger ? leafValues(ledger[1]) : {};
  const balanceCents = ledgerVals.BALAMT ? parseAmountToCents(ledgerVals.BALAMT) : null;
  const balanceDate = ledgerVals.DTASOF ? parseDateWithFormat(ledgerVals.DTASOF, 'YYYYMMDD') : null;

  const transactions: ParsedTransaction[] = [];
  const errors: RowError[] = [];
  const trnRe = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = trnRe.exec(body))) {
    n++;
    const f = leafValues(m[1]);
    const rawDate = f.DTUSER || f.DTPOSTED;
    const date = rawDate ? parseDateWithFormat(rawDate, 'YYYYMMDD') : null;
    const amount = parseAmountToCents(f.TRNAMT);
    if (!date || amount === null) {
      errors.push({ row: n, message: `Transaction ${n}: missing date or amount` });
      continue;
    }
    const name = (f.NAME || f.PAYEE || '').trim();
    const memo = (f.MEMO || '').trim();
    let description = name;
    if (memo) {
      if (!name) description = memo;
      else if (memo.toUpperCase().includes(name.toUpperCase())) description = memo;
    }
    if (!description) description = f.TRNTYPE || 'Transaction';
    transactions.push({
      date,
      amountCents: amount,
      description,
      memo: memo && memo !== description ? memo : null,
      externalId: f.FITID || null,
      checkNumber: f.CHECKNUM || null,
    });
  }
  if (n === 0) errors.push({ row: 0, message: 'No transactions found in this file.' });
  return {
    accountId: acct.ACCTID ?? null,
    bankId: acct.BANKID ?? null,
    accountType,
    currency: curMatch ? curMatch[1].trim() : null,
    balanceCents,
    balanceDate,
    transactions,
    errors,
  };
}
