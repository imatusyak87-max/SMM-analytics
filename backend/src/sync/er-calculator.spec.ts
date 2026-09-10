import { calculateEr, calculateErByViews } from './er-calculator';

describe('calculateEr', () => {
  it('computes engagement rate as a percentage of followers', () => {
    expect(calculateEr(50, 10, 5, 1000)).toBeCloseTo(6.5);
  });

  it('returns null when followers count is zero', () => {
    expect(calculateEr(10, 2, 1, 0)).toBeNull();
  });
});

describe('calculateErByViews', () => {
  it('is reactions as a percentage of the people who saw the post', () => {
    expect(calculateErByViews(50, 1000)).toBe(5);
  });

  it('is null when views are unknown, rather than zero', () => {
    expect(calculateErByViews(50, null)).toBeNull();
  });

  it('is null rather than infinite when a post has no views', () => {
    expect(calculateErByViews(50, 0)).toBeNull();
  });
});
