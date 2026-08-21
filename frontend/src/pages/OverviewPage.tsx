import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { AccountCard } from '../components/AccountCard';
import styles from './OverviewPage.module.css';

interface OverviewItem {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export function OverviewPage() {
  const [items, setItems] = useState<OverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get('/stats/overview')
      .then((res) => {
        if (!cancelled) setItems(res.data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Overview</h1>
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
    </div>
  );
}
