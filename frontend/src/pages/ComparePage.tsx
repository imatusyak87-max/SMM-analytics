import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { CompareTable } from '../components/CompareTable';
import { TrendChart } from '../components/TrendChart';
import styles from './ComparePage.module.css';

interface OverviewItem {
  account: { id: string; name: string; platform: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

interface CompareItem {
  account: { id: string; name: string };
  trend: Array<{ date: string; followersCount: number }>;
}

export function ComparePage() {
  const [candidates, setCandidates] = useState<OverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<CompareItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get('/stats/overview')
      .then((res) => {
        if (!cancelled) setCandidates(res.data);
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

  useEffect(() => {
    if (selected.length === 0) {
      setCompareData([]);
      return;
    }
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    apiClient
      .get('/stats/compare', { params: { accountIds: selected.join(','), from, to } })
      .then((res) => setCompareData(res.data));
  }, [selected]);

  function toggle(accountId: string) {
    setSelected((prev) => (prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]));
  }

  const rows = candidates.filter((c) => selected.includes(c.account.id));

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Compare</h1>

      {loading ? (
        <p className={styles.loading}>Loading accounts…</p>
      ) : error ? (
        <p className={styles.error}>Couldn't load accounts. Try again later.</p>
      ) : candidates.length === 0 ? (
        <p className={styles.empty}>No accounts yet.</p>
      ) : (
        <>
          <div className={styles.section}>
            <p className={styles.sectionLabel}>Select accounts to compare</p>
            <div className={styles.picker}>
              {candidates.map((c) => (
                <label key={c.account.id} className={styles.chip}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    aria-label={c.account.name}
                    checked={selected.includes(c.account.id)}
                    onChange={() => toggle(c.account.id)}
                  />
                  <span className={styles.badge}>{c.account.platform}</span>
                  {c.account.name}
                </label>
              ))}
            </div>
          </div>

          {selected.length === 0 ? (
            <p className={styles.empty}>Pick two or more accounts above to compare their stats.</p>
          ) : (
            <>
              <CompareTable rows={rows} />
              <TrendChart
                series={compareData.map((item) => ({
                  label: item.account.name,
                  data: item.trend.map((t) => ({ date: t.date, value: t.followersCount })),
                }))}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
