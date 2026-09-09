import { parseCompactNumber } from './compact-number';

describe('parseCompactNumber', () => {
  it('parses a plain integer', () => {
    expect(parseCompactNumber('999')).toBe(999);
  });

  it('parses thousands and millions', () => {
    expect(parseCompactNumber('322K')).toBe(322000);
    expect(parseCompactNumber('12.3K')).toBe(12300);
    expect(parseCompactNumber('5.7M')).toBe(5700000);
    expect(parseCompactNumber('9.51M')).toBe(9510000);
  });

  it('ignores surrounding whitespace and thousands separators', () => {
    expect(parseCompactNumber('  1 234 ')).toBe(1234);
    expect(parseCompactNumber('1,234')).toBe(1234);
  });

  it('returns null for anything it cannot read', () => {
    expect(parseCompactNumber(null)).toBeNull();
    expect(parseCompactNumber(undefined)).toBeNull();
    expect(parseCompactNumber('')).toBeNull();
    expect(parseCompactNumber('views')).toBeNull();
  });
});
