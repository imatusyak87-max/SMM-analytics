import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { PeriodSelector } from '../components/PeriodSelector';
import { PostList } from '../components/PostList';
import { PostTypeFilter } from '../components/PostTypeFilter';
import { RefreshButton } from '../components/RefreshButton';
import { StatTiles, type AccountSummary } from '../components/StatTiles';
import { TrendChart } from '../components/TrendChart';
import styles from './AccountDetailPage.module.css';

const DAY_MS = 86_400_000;

interface DetailData {
  account: { id: string; name: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
  trend: Array<{ date: string; followersCount: number }>;
  posts: Array<{ id: string; type: string; caption: string | null; likes: number; comments: number; shares: number; publishedAt: string }>;
  summary: AccountSummary;
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [days, setDays] = useState(30);
  const [pending, setPending] = useState(false);
  // Only the most recent request may write state, so a slow response for a
  // period the user has already switched away from cannot overwrite a newer one.
  const latestRequest = useRef(0);

  const load = useCallback(() => {
    const request = ++latestRequest.current;
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
    setPending(true);
    return apiClient
      .get(`/accounts/${id}/detail`, { params: { from, to } })
      .then((res) => {
        if (request !== latestRequest.current) return;
        setError(null);
        setData(res.data);
        setPending(false);
      })
      .catch((err: any) => {
        if (request !== latestRequest.current) return;
        setError(
          err.response?.status === 404
            ? 'Аккаунт не найден'
            : 'Не удалось загрузить данные аккаунта',
        );
        setPending(false);
      });
  }, [id, days]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredPosts = useMemo(() => {
    if (!data) return [];
    return typeFilter === 'all' ? data.posts : data.posts.filter((p) => p.type === typeFilter);
  }, [data, typeFilter]);

  if (error) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }

  if (!data) return <p className={styles.loading}>Загрузка…</p>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>{data.account.name}</h2>
        <RefreshButton accountId={data.account.id} onSynced={load} />
      </div>
      <section className={styles.overview} aria-label="Сводка за период">
        <PeriodSelector value={days} onChange={setDays} />
        <div className={styles.tilesRegion} aria-busy={pending}>
          <StatTiles summary={data.summary} />
        </div>
      </section>
      <TrendChart
        series={[
          {
            label: data.account.name,
            data: data.trend.map((s) => ({ date: s.date, value: s.followersCount })),
          },
        ]}
      />
      <div className={styles.toolbar}>
        <PostTypeFilter value={typeFilter} onChange={setTypeFilter} />
      </div>
      <PostList posts={filteredPosts} />
    </div>
  );
}
