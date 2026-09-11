import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useApiGet } from './useApiGet';
import { apiClient } from './client';

vi.mock('./client', () => ({ apiClient: { get: vi.fn() } }));

const get = apiClient.get as any;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe('useApiGet', () => {
  it('fetches with the given params and exposes the data', async () => {
    get.mockResolvedValue({ data: { ok: 1 } });

    const { result } = renderHook(() => useApiGet('/x', { page: 2 }));

    await waitFor(() => expect(result.current.data).toEqual({ ok: 1 }));
    expect(get).toHaveBeenCalledWith('/x', { params: { page: 2 } });
    expect(result.current.pending).toBe(false);
  });

  it('does not send params whose value is undefined', async () => {
    get.mockResolvedValue({ data: 1 });
    renderHook(() => useApiGet('/x', { page: 1, type: undefined }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/x', { params: { page: 1 } }));
  });

  it('ignores a slow response once newer params have been requested', async () => {
    const slow = deferred<any>();
    const fast = deferred<any>();
    get.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    const { result, rerender } = renderHook(({ page }) => useApiGet('/x', { page }), {
      initialProps: { page: 1 },
    });
    rerender({ page: 2 });

    fast.resolve({ data: 'page 2' });
    await waitFor(() => expect(result.current.data).toBe('page 2'));

    slow.resolve({ data: 'page 1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.data).toBe('page 2');
  });

  it('ignores a response that arrives after the hook is disabled', async () => {
    const slow = deferred<any>();
    get.mockReturnValueOnce(slow.promise);

    const { result, rerender } = renderHook(({ enabled }) => useApiGet('/x', {}, { enabled }), {
      initialProps: { enabled: true },
    });
    rerender({ enabled: false });

    // Resolve inside act so React commits any state write before we assert —
    // otherwise a late write would be invisible and the test would pass either way.
    await act(async () => {
      slow.resolve({ data: 'late' });
      await slow.promise;
    });
    expect(result.current.data).toBeNull();
  });

  it('does not refetch when the params are equal but a new object', async () => {
    get.mockResolvedValue({ data: 1 });

    const { rerender } = renderHook(() => useApiGet('/x', { page: 1 }));
    rerender();
    rerender();

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  });

  it('fetches nothing while disabled', () => {
    renderHook(() => useApiGet('/x', {}, { enabled: false }));
    expect(get).not.toHaveBeenCalled();
  });

  it('refetches when reloadKey changes', async () => {
    get.mockResolvedValue({ data: 1 });

    const { rerender } = renderHook(({ key }) => useApiGet('/x', {}, { reloadKey: key }), {
      initialProps: { key: 0 },
    });
    rerender({ key: 1 });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('exposes the rejection it received and stops pending', async () => {
    const failure = { response: { status: 500 } };
    get.mockRejectedValue(failure);

    const { result } = renderHook(() => useApiGet('/x', {}));

    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.pending).toBe(false);
  });
});
