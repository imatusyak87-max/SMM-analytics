/** The channel a search is being run for. */
export interface ChannelProfile {
  handle: string;
  title: string;
  followersCount: number;
  description: string | null;
  captions: string[];
}

export interface RankedCandidate {
  handle: string;
  reason: string;
  fit: number;
}

export interface FinderResult {
  niche: string;
  candidates: RankedCandidate[];
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
}

/**
 * The single provider seam. The worker depends on this and never on a concrete
 * implementation, so Claude can replace Gemini without other changes.
 */
export interface CompetitorFinder {
  suggest(profile: ChannelProfile): Promise<FinderResult>;
}

export const COMPETITOR_FINDER = Symbol('COMPETITOR_FINDER');
