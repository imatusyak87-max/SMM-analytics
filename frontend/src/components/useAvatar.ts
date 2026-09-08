import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

/**
 * The avatar endpoint is JWT-guarded, so a plain <img src> would be sent
 * without the Authorization header and rejected — the bytes have to come
 * through the API client and be handed to the browser as an object URL.
 */
export function useAvatar(accountId: string, hasAvatar: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!hasAvatar) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    apiClient
      .get(`/accounts/${accountId}/avatar`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, hasAvatar]);

  return src;
}
