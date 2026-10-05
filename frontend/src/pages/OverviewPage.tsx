import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { AccountCard } from '../components/AccountCard';
import { AddAccountModal } from '../components/AddAccountModal';
import styles from './OverviewPage.module.css';

interface OverviewItem {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export function OverviewPage() {
  const [items, setItems] = useState<OverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // The Facebook login (for Instagram competitors) redirects back to /?add=competitor,
  // optionally with the error it failed with; reopen the dialog where the user left it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [isAdding, setIsAdding] = useState(searchParams.get('add') === 'competitor');
  const [addError] = useState(searchParams.get('discoveryError'));

  const mounted = useRef(true);

  useEffect(() => {
    // Drop the params so a reload or a later visit does not reopen the dialog.
    if (searchParams.has('add') || searchParams.has('discoveryError')) setSearchParams({}, { replace: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    return apiClient
      .get('/stats/overview')
      .then((res) => {
        if (mounted.current) setItems(res.data);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  function handleCreated() {
    setIsAdding(false);
    load();
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Overview</h1>
        <button type="button" className={styles.addButton} onClick={() => setIsAdding(true)}>
          Добавить аккаунт
        </button>
      </div>
      {loading ? (
        <p className={styles.loading}>Loading accounts…</p>
      ) : error ? (
        <p className={styles.error}>Couldn't load accounts. Try again later.</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>No accounts yet.</p>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <AccountCard
              key={item.account.id}
              account={item.account}
              latestSnapshot={item.latestSnapshot}
              onDeleted={load}
            />
          ))}
        </div>
      )}
      {isAdding && <AddAccountModal onClose={() => setIsAdding(false)} onCreated={handleCreated} initialError={addError} />}
    </div>
  );
}
