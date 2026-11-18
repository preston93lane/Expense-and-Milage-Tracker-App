import type { Rule, RuleCondition, TxnFacts } from './types';

function text(field: RuleCondition['field'], t: TxnFacts): string {
  switch (field) {
    case 'description':
      return t.description;
    case 'merchant':
      return t.merchant;
    case 'state':
      return t.state ?? '';
    case 'city':
      return t.city ?? '';
    case 'date':
      return t.date;
    case 'direction':
      return t.amountCents < 0 ? 'out' : 'in';
    case 'account':
      return String(t.accountId);
    case 'amount':
      return String(Math.abs(t.amountCents));
  }
}

const regexCache = new Map<string, RegExp | null>();
function safeRegex(src: string): RegExp | null {
  if (!regexCache.has(src)) {
    try {
      regexCache.set(src, new RegExp(src, 'i'));
    } catch {
      regexCache.set(src, null);
    }
  }
  return regexCache.get(src) ?? null;
}

export function conditionMatches(c: RuleCondition, t: TxnFacts): boolean {
  if (c.field === 'amount') {
    const abs = Math.abs(t.amountCents);
    const v = Number(c.value);
    switch (c.op) {
      case 'equals':
        return abs === v;
      case 'gte':
        return abs >= v;
      case 'lte':
        return abs <= v;
      case 'between':
        return abs >= v && abs <= Number(c.value2);
      default:
        return false;
    }
  }
  if (c.field === 'date') {
    const d = t.date;
    switch (c.op) {
      case 'equals':
        return d === c.value;
      case 'gte':
        return d >= String(c.value);
      case 'lte':
        return d <= String(c.value);
      case 'between':
        return d >= String(c.value) && d <= String(c.value2);
      default:
        return false;
    }
  }
  if (c.field === 'account') {
    const ids = Array.isArray(c.value) ? c.value.map(Number) : [Number(c.value)];
    return ids.includes(t.accountId);
  }

  const hay = text(c.field, t).toUpperCase();
  if (c.op === 'in') {
    const list = (Array.isArray(c.value) ? c.value : String(c.value).split(','))
      .map((v) => String(v).trim().toUpperCase())
      .filter(Boolean);
    return list.includes(hay);
  }
  const needle = String(c.value ?? '').toUpperCase();
  switch (c.op) {
    case 'contains':
      return needle !== '' && hay.includes(needle);
    case 'not_contains':
      return !hay.includes(needle);
    case 'starts_with':
      return needle !== '' && hay.startsWith(needle);
    case 'equals':
      return hay === needle;
    case 'regex': {
      const re = safeRegex(String(c.value));
      return re ? re.test(text(c.field, t)) : false;
    }
    default:
      return false;
  }
}

export function ruleMatches(rule: Rule, t: TxnFacts): boolean {
  if (!rule.enabled || rule.conditions.items.length === 0) return false;
  return rule.conditions.match === 'any'
    ? rule.conditions.items.some((c) => conditionMatches(c, t))
    : rule.conditions.items.every((c) => conditionMatches(c, t));
}

/** Lower priority number runs first; ties broken by newest rule (more specific, usually). */
export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => a.priority - b.priority || b.id - a.id);
}

export function firstMatchingRule(rules: Rule[], t: TxnFacts): Rule | null {
  for (const r of sortRules(rules)) if (ruleMatches(r, t)) return r;
  return null;
}

/** Build the default "always do this for <merchant>" rule from a transaction. */
export function ruleFromTransaction(
  t: Pick<TxnFacts, 'merchant' | 'amountCents'>,
  actions: Rule['actions'],
  categoryName?: string,
): Omit<Rule, 'id'> {
  const label = actions.classification === 'personal'
    ? 'Personal'
    : actions.classification === 'transfer'
      ? 'Transfer'
      : categoryName ?? 'Business';
  return {
    name: `${t.merchant} → ${label}`,
    priority: 100,
    enabled: true,
    autoConfirm: true,
    conditions: {
      match: 'all',
      // No direction condition on purpose: a refund from the same merchant
      // should land in the same category so it nets against the purchase.
      items: [{ field: 'merchant', op: 'equals', value: t.merchant.toUpperCase() }],
    },
    actions,
  };
}
