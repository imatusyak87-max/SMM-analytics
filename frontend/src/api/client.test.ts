import { describe, it, expect, vi } from 'vitest';
import { apiClient, onUnauthorized } from './client';

describe('onUnauthorized', () => {
  it('runs the handler when a request is rejected as unauthorized', async () => {
    const handler = vi.fn();
    const stop = onUnauthorized(handler);
    apiClient.defaults.adapter = () => Promise.reject({ response: { status: 401 } });

    await expect(apiClient.get('/anything')).rejects.toBeDefined();

    expect(handler).toHaveBeenCalled();
    stop();
  });

  it('leaves other failures alone', async () => {
    const handler = vi.fn();
    const stop = onUnauthorized(handler);
    apiClient.defaults.adapter = () => Promise.reject({ response: { status: 500 } });

    await expect(apiClient.get('/anything')).rejects.toBeDefined();

    expect(handler).not.toHaveBeenCalled();
    stop();
  });
});
