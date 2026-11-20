export type Classification = 'business' | 'personal' | 'transfer';
export type ReviewStatus = 'unreviewed' | 'suggested' | 'reviewed';
export type SuggestionSource = 'rule' | 'history' | 'keyword' | 'transfer' | 'trip' | 'import' | 'manual';

export type RuleField = 'description' | 'merchant' | 'amount' | 'direction' | 'account' | 'state' | 'city' | 'date';
export type RuleOp =
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'equals'
  | 'regex'
  | 'between'
  | 'gte'
  | 'lte'
  | 'in';

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  /** Text, number (amount in cents), ISO date, or list for 'in'. */
  value: string | number | (string | number)[];
  /** Upper bound for 'between'. */
  value2?: string | number;
}

export interface RuleConditions {
  match: 'all' | 'any';
  items: RuleCondition[];
}

export interface RuleActions {
  classification?: Classification;
  categoryId?: number | null;
  /** 1–99: split the transaction, this % business and the rest personal. */
  businessPct?: number;
  note?: string;
  tripId?: number | null;
  /** Tag the client who paid you / the contractor you paid. */
  clientId?: number | null;
  projectId?: number | null;
  contractorId?: number | null;
}

export interface Rule {
  id: number;
  name: string;
  priority: number;
  enabled: boolean;
  /** When true, matching transactions are marked reviewed; otherwise only suggested. */
  autoConfirm: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
}

/** The fields rules can look at. */
export interface TxnFacts {
  description: string;
  merchant: string;
  amountCents: number;
  accountId: number;
  state: string | null;
  city: string | null;
  date: string;
  /** Online/phone merchant (its location is HQ, not where you were). */
  isOnline?: boolean;
}

export interface CategorizeResult {
  status: ReviewStatus;
  classification: Classification | null;
  categoryId: number | null;
  businessPct?: number;
  source: SuggestionSource | null;
  confidence: number | null;
  ruleId?: number;
  note?: string;
  /** Business trip this transaction was matched to. */
  tripId?: number;
  clientId?: number;
  projectId?: number;
  contractorId?: number;
}
