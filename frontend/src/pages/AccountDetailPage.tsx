import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApiGet } from '../api/useApiGet';
import { Pagination } from '../components/Pagination';
import { PeriodPicker } from '../components/PeriodPicker';
import { PostList, type PostItem, type PostSort } from '../components/PostList';
import { PostModal } from '../components/PostModal';
import { PostSortSelect } from '../components/PostSortSelect';
import { PostTable } from '../components/PostTable';
import { PostTypeFilter } from '../components/PostTypeFilter';
import { RefreshButton } from '../components/RefreshButton';
import { StatTiles, type AccountSummary } from '../components/StatTiles';
import { TrendChart } from '../components/TrendChart';
import { formatCount } from '../format';
import { formatIsoDate, selectPreset, type SelectedPeriod } from '../periods';
import styles from './AccountDetailPage.module.css';

const TOP_COUNT = 10;

interface DetailData {
  account: { id: string; name: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
  trend: Array<{ date: string; followersCount: number }>;
  summary: AccountSummary;
  /** Where collected data begins; earlier periods are shown as far as it reaches. */
  coverage: { postsFrom: string; followersFrom: string };
}

interface PostsPage {
  total: number;
  items: PostItem[];
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<SelectedPeriod>(() => selectPreset('last30', new Date()));
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState<PostSort>('views');
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [tableSize, setTableSize] = useState(10);
  const [openPost, setOpenPost] = useState<PostItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const range = { from: period.from, to: period.to };
  const postFilter = { ...range, sort, type: typeFilter === 'all' ? undefined : typeFilter };

  const detail = useApiGet<DetailData>(`/accounts/${id}/detail`, range, { reloadKey });
  const top = useApiGet<PostsPage>(
    `/accounts/${id}/posts`,
    { ...postFilter, page: 1, size: TOP_COUNT },
    { reloadKey },
  );
  const table = useApiGet<PostsPage>(
    `/accounts/${id}/posts`,
    { ...postFilter, page: tablePage, size: tableSize },
    { enabled: tableOpen, reloadKey },
  );

  // Anything that changes which posts the table holds sends it back to page 1.
  const changePeriod = (next: SelectedPeriod) => {
    setPeriod(next);
    setTablePage(1);
  };
  const changeType = (next: string) => {
    setTypeFilter(next);
    setTablePage(1);
  };
  const changeSort = (next: PostSort) => {
    setSort(next);
    setTablePage(1);
  };
  const changeSize = (next: number) => {
    setTableSize(next);
    setTablePage(1);
  };

  if (detail.error) {
    const status = (detail.error as { response?: { status?: number } }).response?.status;
    return (
      <p className={styles.error} role="alert">
        {status === 404 ? 'Аккаунт не найден' : 'Не удалось загрузить данные аккаунта'}
      </p>
    );
  }

  if (!detail.data) return <p className={styles.loading}>Загрузка…</p>;

  const { account, trend, summary, coverage } = detail.data;
  const showCoverage = period.from < coverage.postsFrom || period.from < coverage.followersFrom;
  const total = top.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>{account.name}</h2>
        <RefreshButton accountId={account.id} onSynced={() => setReloadKey((key) => key + 1)} />
      </div>
      <section className={styles.overview} aria-label="Сводка за период">
        <PeriodPicker value={period} onChange={changePeriod} />
        {showCoverage && (
          <p className={styles.coverage} role="note">
            Посты собраны с {formatIsoDate(coverage.postsFrom)}, подписчики — с{' '}
            {formatIsoDate(coverage.followersFrom)}. Более ранние данные недоступны.
          </p>
        )}
        <div className={styles.tilesRegion} aria-busy={detail.pending}>
          <StatTiles summary={summary} />
        </div>
      </section>
      <TrendChart
        series={[
          {
            label: account.name,
            data: trend.map((s) => ({ date: s.date, value: s.followersCount })),
          },
        ]}
      />
      <section className={styles.posts} aria-labelledby="top-posts-heading">
        <div className={styles.postsHeader}>
          <h3 id="top-posts-heading" className={styles.subheading}>
            Топ-10 постов
          </h3>
          <div className={styles.toolbar}>
            <PostTypeFilter value={typeFilter} onChange={changeType} />
            <PostSortSelect value={sort} onChange={changeSort} />
          </div>
        </div>
        {top.error ? (
          <p className={styles.error} role="alert">
            Не удалось загрузить посты
          </p>
        ) : top.data ? (
          <div className={styles.postsRegion} aria-busy={top.pending}>
            <PostList posts={top.data.items} onOpen={setOpenPost} />
          </div>
        ) : (
          <p className={styles.loading}>Загрузка…</p>
        )}
        {(total > 0 || tableOpen) && (
          <button
            type="button"
            className={styles.reveal}
            aria-expanded={tableOpen}
            onClick={() => setTableOpen((open) => !open)}
          >
            {tableOpen ? 'Скрыть список' : `Показать все посты (${formatCount(total)})`}
          </button>
        )}
      </section>
      {tableOpen && (
        <section className={styles.posts} aria-label="Все посты">
          {table.error ? (
            <p className={styles.error} role="alert">
              Не удалось загрузить посты
            </p>
          ) : table.data ? (
            <div className={styles.postsRegion} aria-busy={table.pending}>
              <PostTable posts={table.data.items} total={table.data.total} onOpen={setOpenPost} />
              <Pagination
                page={tablePage}
                size={tableSize}
                total={table.data.total}
                onPageChange={setTablePage}
                onSizeChange={changeSize}
              />
            </div>
          ) : (
            <p className={styles.loading}>Загрузка…</p>
          )}
        </section>
      )}
      <PostModal post={openPost} onClose={() => setOpenPost(null)} />
    </div>
  );
}
