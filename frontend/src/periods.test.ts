import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  formatIsoDate,
  formatPeriod,
  fromIsoDate,
  presetRange,
  selectPreset,
  toIsoDate,
} from './periods';

const on = (iso: string) => fromIsoDate(iso);

describe('presetRange', () => {
  const today = on('2026-09-11');

  it.each([
    ['last7', '2026-09-05', '2026-09-11'],
    ['last30', '2026-08-13', '2026-09-11'],
    ['thisMonth', '2026-09-01', '2026-09-11'],
    ['lastMonth', '2026-08-01', '2026-08-31'],
    ['thisQuarter', '2026-07-01', '2026-09-11'],
    ['lastQuarter', '2026-04-01', '2026-06-30'],
    ['thisYear', '2026-01-01', '2026-09-11'],
    ['lastYear', '2025-01-01', '2025-12-31'],
  ] as const)('%s on 11.09.2026 runs from %s to %s', (preset, from, to) => {
    expect(presetRange(preset, today)).toEqual({ from, to });
  });

  it('counts «Последние 7 дней» as seven days including today, across a month boundary', () => {
    expect(presetRange('last7', on('2026-03-03'))).toEqual({ from: '2026-02-25', to: '2026-03-03' });
  });

  it('reaches back into last year from January', () => {
    const january = on('2027-01-15');
    expect(presetRange('lastMonth', january)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetRange('lastQuarter', january)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(presetRange('thisQuarter', january)).toEqual({ from: '2027-01-01', to: '2027-01-15' });
  });

  it('starts a quarter on its first day and ends the last one on its last', () => {
    expect(presetRange('thisQuarter', on('2026-04-01'))).toEqual({ from: '2026-04-01', to: '2026-04-01' });
    expect(presetRange('lastQuarter', on('2026-04-01'))).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(presetRange('thisQuarter', on('2026-12-31'))).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('ends last February on the 29th in a leap year and the 28th otherwise', () => {
    expect(presetRange('lastMonth', on('2028-03-10')).to).toBe('2028-02-29');
    expect(presetRange('lastMonth', on('2027-03-10')).to).toBe('2027-02-28');
  });
});

describe('selectPreset', () => {
  it('remembers which preset produced the range', () => {
    expect(selectPreset('lastYear', on('2026-09-11'))).toEqual({
      preset: 'lastYear',
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });
});

describe('PRESETS', () => {
  it('offers the eight presets in order, in Russian', () => {
    expect(PRESETS.map((preset) => preset.label)).toEqual([
      'Последние 7 дней',
      'Последние 30 дней',
      'Этот месяц',
      'Прошлый месяц',
      'Текущий квартал',
      'Прошлый квартал',
      'Текущий год',
      'Прошлый год',
    ]);
  });
});

describe('date helpers', () => {
  it('round-trips a local calendar date through its ISO form', () => {
    expect(toIsoDate(fromIsoDate('2026-02-05'))).toBe('2026-02-05');
  });

  it('formats dates and periods the Russian way', () => {
    expect(formatIsoDate('2026-07-01')).toBe('01.07.2026');
    expect(formatPeriod({ from: '2026-07-01', to: '2026-07-31' })).toBe('01.07.2026 – 31.07.2026');
  });
});
