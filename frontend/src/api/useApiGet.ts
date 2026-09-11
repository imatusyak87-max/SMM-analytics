import { useEffect, useRef, useState } from 'react';
import { apiClient } from './client';

export interface ApiState<T> {
  data: T | null;
  error: unknown;
  pending: boolean;
}

/**
 * GETs `url` with `params` whenever either changes or `reloadKey` is bumped.
 * Only the most recent request may write state, so a slow response for
 * parameters the user has already moved away from cannot overwrite a newer one.
 * Earlier data stays in place while a new request is pending, so a page can show
 * it as stale instead of blanking.
 */
export function useApiGet<T>(
  url: string,
  params: Record<string, string | number | undefined>,
  { enabled = true, reloadKey = 0 }: { enabled?: boolean; reloadKey?: number } = {},
): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, pending: enabled });
  const latest = useRef(0);
  // Params arrive as a new object every render, so compare them by value. JSON
  // also drops keys whose value is undefined, so those are never sent.
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!enabled) return;
    const request = ++latest.current;
    setState((current) => ({ ...current, pending: true }));
    apiClient
      .get(url, { params: JSON.parse(paramsKey) })
      .then((res) => {
        if (request === latest.current) setState({ data: res.data as T, error: null, pending: false });
      })
      .catch((error: unknown) => {
        if (request === latest.current) setState((current) => ({ ...current, error, pending: false }));
      });
  }, [url, paramsKey, enabled, reloadKey]);

  return state;
}
