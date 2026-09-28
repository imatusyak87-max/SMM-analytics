import { HistoryPauseError, isNetworkError, networkPause, MINUTE_MS } from './history-pause.error';
import { HistoryPauseReason } from '../db/entities/history-load.entity';

describe('isNetworkError', () => {
  it('recognises axios errors that never got a response', () => {
    expect(isNetworkError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isNetworkError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isNetworkError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('does not treat an HTTP error response as a network error', () => {
    expect(isNetworkError({ code: 'ERR_BAD_REQUEST', response: { status: 400 } })).toBe(false);
    expect(isNetworkError(new Error('boom'))).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('networkPause', () => {
  it('pauses for five minutes with a Russian message', () => {
    const pause = networkPause();
    expect(pause).toBeInstanceOf(HistoryPauseError);
    expect(pause.reason).toBe(HistoryPauseReason.NETWORK);
    expect(pause.retryAfterMs).toBe(5 * MINUTE_MS);
    expect(pause.message).toBe('Проблема с сетью, попробуйте позже');
  });
});
