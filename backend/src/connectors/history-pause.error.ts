import { HistoryPauseReason } from '../db/entities/history-load.entity';

export const MINUTE_MS = 60_000;

/**
 * A temporary condition (rate limit, network trouble) that should pause a
 * history load and retry later, not fail it. `message` is Russian and safe to
 * show the user; it never contains a token or a URL. The nightly sync can
 * surface the same error, so messages must not promise a history-load
 * schedule — the history panel builds its own text from `reason`.
 */
export class HistoryPauseError extends Error {
  constructor(
    readonly reason: HistoryPauseReason,
    readonly retryAfterMs: number,
    message: string,
  ) {
    super(message);
    this.name = 'HistoryPauseError';
  }
}

const NETWORK_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** An axios error that never got an HTTP response: timeout, DNS failure, dropped connection. */
export function isNetworkError(error: unknown): boolean {
  const e = error as { code?: unknown; response?: unknown } | null | undefined;
  return !!e && e.response === undefined && typeof e.code === 'string' && NETWORK_CODES.has(e.code);
}

export function networkPause(): HistoryPauseError {
  return new HistoryPauseError(HistoryPauseReason.NETWORK, 5 * MINUTE_MS, 'Проблема с сетью, попробуйте позже');
}
