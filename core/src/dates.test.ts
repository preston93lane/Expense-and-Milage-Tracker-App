import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, detectDateFormat, parseDateWithFormat } from './dates';

describe('dates', () => {
  it('detects US formats first', () => {
    expect(detectDateFormat(['10/01/2026', '03/04/2026'])).toBe('MM/DD/YYYY');
    expect(detectDateFormat(['2026-10-01'])).toBe('YYYY-MM-DD');
    expect(detectDateFormat(['10/01/26'])).toBe('MM/DD/YY');
    expect(detectDateFormat(['20261001120000.000[-5:EST]'])).toBe('YYYYMMDD');
    expect(detectDateFormat(['Oct 1, 2026', 'Sep 30, 2026'])).toBe('MON DD, YYYY');
  });

  it('switches to day-first only when a sample proves it', () => {
    expect(detectDateFormat(['13/01/2026', '02/01/2026'])).toBe('DD/MM/YYYY');
  });

  it('rejects impossible dates', () => {
    expect(parseDateWithFormat('02/30/2026', 'MM/DD/YYYY')).toBeNull();
    expect(parseDateWithFormat('2026-13-01', 'YYYY-MM-DD')).toBeNull();
  });

  it('does date arithmetic across months and leap years', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-10-12', '2026-10-16')).toBe(4);
  });
});
