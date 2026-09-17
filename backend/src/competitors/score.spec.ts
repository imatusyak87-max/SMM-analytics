import { scoreCandidate } from './score';

describe('scoreCandidate', () => {
  it('gives a perfect fit at an identical size the maximum score', () => {
    expect(scoreCandidate(10, 5000, 5000)).toBeCloseTo(1);
  });

  it('halves the weight of size, so a great match of a different size still beats a poor match of the same size', () => {
    const differentSize = scoreCandidate(10, 5000, 500);
    const sameSizePoorFit = scoreCandidate(3, 5000, 5000);
    expect(differentSize).toBeGreaterThan(sameSizePoorFit);
  });

  it('ranks the closer size higher when the fit is equal', () => {
    expect(scoreCandidate(8, 10_000, 9000)).toBeGreaterThan(scoreCandidate(8, 10_000, 100));
  });

  it('treats an unknown or zero follower count as no size information', () => {
    expect(scoreCandidate(10, 0, 5000)).toBeCloseTo(0.5);
    expect(scoreCandidate(10, 5000, 0)).toBeCloseTo(0.5);
  });
});
