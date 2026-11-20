import { describe, expect, it } from 'vitest';
import { assetReminders, assetWarnings, deductionForYear, depreciationSchedule, suggestMethod } from './assets';

describe('depreciation', () => {
  it('expenses de minimis, Section 179 and bonus items in the first year (business % only)', () => {
    expect(depreciationSchedule({ costCents: 120_000, businessUsePct: 100, placedInService: '2026-03-01', method: 'de_minimis' })).toEqual([{ year: 2026, deductionCents: 120_000, remainingCents: 0 }]);
    expect(deductionForYear({ costCents: 400_000, businessUsePct: 80, placedInService: '2026-03-01', method: 'section179' }, 2026)).toBe(320_000);
    expect(deductionForYear({ costCents: 400_000, businessUsePct: 80, placedInService: '2026-03-01', method: 'bonus' }, 2027)).toBe(0);
  });

  it('spreads 5-year MACRS with the half-year convention and adds up exactly', () => {
    const s = depreciationSchedule({ costCents: 500_000, businessUsePct: 100, placedInService: '2026-06-01', method: 'macrs5' });
    expect(s.map((x) => x.deductionCents)).toEqual([100_000, 160_000, 96_000, 57_600, 57_600, 28_800]);
    expect(s.reduce((t, x) => t + x.deductionCents, 0)).toBe(500_000);
    expect(s.map((x) => x.year)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
  });

  it('handles straight-line with half years and stops after disposal', () => {
    const s = depreciationSchedule({ costCents: 300_000, businessUsePct: 100, placedInService: '2026-01-01', method: 'straight_line', lifeYears: 3 });
    expect(s.map((x) => x.deductionCents)).toEqual([50_000, 100_000, 100_000, 50_000]);
    const d = depreciationSchedule({ costCents: 500_000, businessUsePct: 100, placedInService: '2026-01-01', method: 'macrs5', disposedDate: '2027-05-01' });
    expect(d.map((x) => x.year)).toEqual([2026, 2027]);
  });

  it('suggests a method and warns about common mistakes', () => {
    expect(suggestMethod(199_900)).toBe('de_minimis');
    expect(suggestMethod(349_900)).toBe('section179');
    expect(assetWarnings({ costCents: 300_000, businessUsePct: 100, placedInService: '2026-01-01', method: 'de_minimis', type: 'camera' })[0]).toMatch(/2,500/);
    expect(assetWarnings({ costCents: 300_000, businessUsePct: 40, placedInService: '2026-01-01', method: 'section179', type: 'computer' })[0]).toMatch(/straight-line/);
  });
});

describe('reminders', () => {
  it('flags warranties ending soon and gear due for replacement', () => {
    const r = assetReminders({ name: 'Sony A7 IV', purchaseDate: '2022-12-01', warrantyUntil: '2026-12-15', replaceAfterYears: 4, disposedDate: null }, '2026-11-20');
    expect(r.map((x) => x.kind)).toEqual(['warranty', 'replace']);
    expect(assetReminders({ name: 'Old', purchaseDate: '2010-01-01', warrantyUntil: null, replaceAfterYears: 4, disposedDate: '2015-01-01' }, '2026-11-20')).toEqual([]);
  });
});
