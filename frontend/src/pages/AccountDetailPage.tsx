import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { PostList } from '../components/PostList';
import { PostTypeFilter } from '../components/PostTypeFilter';
import { RefreshButton } from '../components/RefreshButton';
import styles from './AccountDetailPage.module.css';

interface DetailData {
  account: { id: string; name: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
  trend: unknown[];
  posts: Array<{ id: string; type: string; caption: string | null; likes: number; comments: number; shares: number; publishedAt: string }>;
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    apiClient.get(`/accounts/${id}/detail`, { params: { from, to } }).then((res) => setData(res.data));
  }, [id]);

  const filteredPosts = useMemo(() => {
    if (!data) return [];
    return typeFilter === 'all' ? data.posts : data.posts.filter((p) => p.type === typeFilter);
  }, [data, typeFilter]);

  if (!data) return <p className={styles.loading}>Загрузка…</p>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.heading}>{data.account.name}</h2>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Подписчики</span>
              <span className={styles.statValue}>{data.latestSnapshot?.followersCount ?? '—'}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>ER</span>
              <span className={styles.statValue}>
                {data.latestSnapshot?.avgEr != null ? `${data.latestSnapshot.avgEr.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
        </div>
        <RefreshButton accountId={data.account.id} />
      </div>
      <div className={styles.toolbar}>
        <PostTypeFilter value={typeFilter} onChange={setTypeFilter} />
      </div>
      <PostList posts={filteredPosts} />
    </div>
  );
}
