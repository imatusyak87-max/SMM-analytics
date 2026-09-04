import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [isAdding, setIsAdding] = useState(false);

  const mounted = useRef(true);

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
            <AccountCard key={item.account.id} account={item.account} latestSnapshot={item.latestSnapshot} />
          ))}
        </div>
      )}
      {isAdding && <AddAccountModal onClose={() => setIsAdding(false)} onCreated={handleCreated} />}
    </div>
  );
}
