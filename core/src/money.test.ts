import { describe, expect, it } from 'vitest';
import { formatCents, parseAmountToCents, splitByPercents } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['12.34', 1234],
    ['-12.34', -1234],
    ['$1,234.56', 123456],
    ['-$1,234.56', -123456],
    ['$-5.00', -500],
    ['(45.10)', -4510],
    ['45.10-', -4510],
    ['45.10 CR', 4510],
    ['45.10 DR', -4510],
    ['+5', 500],
    ['0.5', 50],
    ['.99', 99],
    ['1.005', 101],
    [12.3, 1230],
  ])('%s → %s', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it.each(['', '  ', 'abc', '--', null, undefined, '12.3.4'])('rejects %s', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats with separators and sign', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5)).toBe('-$0.05');
    expect(formatCents(500, { sign: true })).toBe('+$5.00');
  });
});

describe('splitByPercents', () => {
  it('always sums to the original amount', () => {
    const parts = splitByPercents(-1001, [60, 40]);
    expect(parts[0] + parts[1]).toBe(-1001);
    expect(parts[0]).toBe(-601);
  });
});
