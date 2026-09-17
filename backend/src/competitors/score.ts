/**
 * score = (fit / 10) * (0.5 + 0.5 * sizeSimilarity)
 *
 * Size matters, but only half as much as subject fit: a 5k channel should not be
 * shown a 2M-subscriber giant, yet a great topical match of a different size must
 * still outrank a weak match of identical size.
 */
export function scoreCandidate(fit: number, ownFollowers: number, candidateFollowers: number): number {
  const clampedFit = Math.min(10, Math.max(1, fit)) / 10;
  const sizeSimilarity =
    ownFollowers > 0 && candidateFollowers > 0
      ? Math.min(ownFollowers, candidateFollowers) / Math.max(ownFollowers, candidateFollowers)
      : 0;
  return clampedFit * (0.5 + 0.5 * sizeSimilarity);
}
