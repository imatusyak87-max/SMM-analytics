import { calculateEr } from './er-calculator';

describe('calculateEr', () => {
  it('computes engagement rate as a percentage of followers', () => {
    expect(calculateEr(50, 10, 5, 1000)).toBeCloseTo(6.5);
  });

  it('returns null when followers count is zero', () => {
    expect(calculateEr(10, 2, 1, 0)).toBeNull();
  });
});
