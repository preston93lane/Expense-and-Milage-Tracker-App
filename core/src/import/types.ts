import type { DateFormat } from '../dates';

/** One transaction as read from a bank file, before it touches the database. */
export interface ParsedTransaction {
  /** ISO date YYYY-MM-DD (purchase/transaction date when the file has one). */
  date: string;
  /** Integer cents. Negative = money out of the account. */
  amountCents: number;
  description: string;
  memo?: string | null;
  /** Bank-provided unique id (OFX FITID or a CSV "Reference" column). */
  externalId?: string | null;
  checkNumber?: string | null;
  /** Optional columns found in history exports (e.g. QuickBooks Self-Employed). */
  categoryLabel?: string | null;
  classificationLabel?: string | null;
  notes?: string | null;
}

export interface CsvMapping {
  /** Number of junk rows before the header (or before the data when there is no header). */
  skipRows: number;
  hasHeader: boolean;
  dateColumn: number;
  dateFormat: DateFormat;
  descriptionColumn: number;
  /** Additional text columns appended to the description (e.g. "Memo"/"Extended Details"). */
  extraDescriptionColumns?: number[];
  amountMode: 'single' | 'debit_credit';
  amountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
  /** A "Debit/Credit" or "Type" column that tells the sign when amounts are all positive. */
  typeColumn?: number;
  /** Flip signs (for card exports that show purchases as positive numbers). */
  invertSign: boolean;
  memoColumn?: number;
  checkColumn?: number;
  idColumn?: number;
  categoryColumn?: number;
  classificationColumn?: number;
  notesColumn?: number;
}

export interface CsvDetection {
  mapping: CsvMapping;
  headers: string[] | null;
  /** Data rows only (after skipRows and header). */
  rows: string[][];
  warnings: string[];
}

export interface RowError {
  row: number;
  message: string;
}

export interface OfxStatement {
  accountId: string | null;
  accountType: 'checking' | 'savings' | 'credit_card' | 'other';
  bankId: string | null;
  currency: string | null;
  transactions: ParsedTransaction[];
  errors: RowError[];
}

export type FileKind = 'ofx' | 'csv' | 'timeline' | 'unknown';
