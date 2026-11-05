import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import { HistoryLoadPanel } from '../components/HistoryLoadPanel';
import { MoveAccountButton } from '../components/MoveAccountButton';
import { Pagination } from '../components/Pagination';
import { PeriodPicker } from '../components/PeriodPicker';
import { PostList, type PostItem, type PostSort } from '../components/PostList';
import { PostModal } from '../components/PostModal';
import { PostSortSelect } from '../components/PostSortSelect';
import { PostTable } from '../components/PostTable';
import { extraPostMetrics } from '../postMetrics';
import { PostTypeFilter } from '../components/PostTypeFilter';
import { RefreshButton } from '../components/RefreshButton';
import { StatTiles, type AccountSummary } from '../components/StatTiles';
import { TrendChart } from '../components/TrendChart';
import { ViewModeSwitch } from '../components/ViewModeSwitch';
import { formatCount } from '../format';
import { formatIsoDate, selectPreset, type SelectedPeriod } from '../periods';
import styles from './AccountDetailPage.module.css';

const TOP_COUNT = 10;

interface DetailData {
  profile: { id: string; name: string };
  account: { id: string; name: string; platform: string; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
  trend: Array<{ date: string; followersCount: number }>;
  summary: AccountSummary;
  /** Where collected data begins; earlier periods are shown as far as it reaches. */
  coverage: { postsFrom: string; followersFrom: string };
  needsReconnect: boolean;
}

interface PostsPage {
  total: number;
  items: PostItem[];
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the Instagram login callback when the login did not go through.
  const [instagramError] = useState(() => searchParams.get('instagramError'));
  useEffect(() => {
    if (searchParams.has('instagramError')) setSearchParams({}, { replace: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [period, setPeriod] = useState<SelectedPeriod>(() => selectPreset('last30', new Date()));
  const [typeFilter, setTypeFilter] = useState('all');
  const [sort, setSort] = useState<PostSort>('views');
  const [tableOpen, setTableOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [tableSize, setTableSize] = useState(10);
  const [openPost, setOpenPost] = useState<PostItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const range = { from: period.from, to: period.to };
  const postFilter = { ...range, sort, type: typeFilter === 'all' ? undefined : typeFilter };

  const detail = useApiGet<DetailData>(`/accounts/${id}/detail`, range, { reloadKey });

  // History loads move the first known post back; keep «За всё время» honest.
  const postsFrom = detail.data?.coverage.postsFrom;
  useEffect(() => {
    if (postsFrom && period.preset === 'allTime' && period.from !== postsFrom) {
      setPeriod(selectPreset('allTime', new Date(), postsFrom));
    }
  }, [postsFrom, period.preset, period.from]);

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

  /** Full access (a linked account) and reconnect (an own one) are the same per-account login. */
  async function startInstagramLogin() {
    setReconnecting(true);
    setReconnectError(null);
    try {
      const { data } = await apiClient.get(`/accounts/${id}/instagram/connect`);
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setReconnectError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setReconnecting(false);
    }
  }

  async function handleDelete(target: { id: string; name: string }, profile: DetailData['profile']) {
    if (!confirm(`Убрать «${target.name}» из проекта? Собранная статистика сохранится — если добавить аккаунт снова, она вернётся.`)) return;
    try {
      setDeleteError(null);
      await apiClient.delete(`/accounts/${target.id}`);
      navigate(`/projects/${profile.id}`);
    } catch (err: any) {
      setDeleteError(err.response?.data?.message ?? 'Не удалось удалить аккаунт');
    }
  }

  if (detail.error) {
    const status = (detail.error as { response?: { status?: number } }).response?.status;
    return (
      <p className={styles.error} role="alert">
        {status === 404 ? 'Аккаунт не найден' : 'Не удалось загрузить данные аккаунта'}
      </p>
    );
  }

  if (!detail.data) return <p className={styles.loading}>Загрузка…</p>;

  const { account, trend, summary, coverage, profile } = detail.data;
  const extraMetrics = extraPostMetrics(account);
  const showCoverage = period.from < coverage.postsFrom || period.from < coverage.followersFrom;
  const total = top.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <Link to={`/projects/${profile.id}`} className={styles.breadcrumb}>
        ← {profile.name}
      </Link>
      <div className={styles.header}>
        <div className={styles.title}>
          <h2 className={styles.heading}>{account.name}</h2>
          <ViewModeSwitch />
        </div>
        <div className={styles.actions}>
          <RefreshButton
            accountId={account.id}
            onSynced={() => {
              setReloadKey((key) => key + 1);
              setTablePage(1);
            }}
          />
          <HistoryLoadPanel
            accountId={account.id}
            onFinished={() => {
              setReloadKey((key) => key + 1);
              setTablePage(1);
            }}
          />
          <MoveAccountButton
            accountId={account.id}
            currentProjectId={profile.id}
            onMoved={() => setReloadKey((key) => key + 1)}
          />
          <button
            type="button"
            className={styles.deleteButton}
            aria-label="Удалить аккаунт"
            onClick={() => handleDelete(account, profile)}
          >
            Удалить
          </button>
        </div>
      </div>
      {deleteError && (
        <p className={styles.error} role="alert">
          {deleteError}
        </p>
      )}
      {detail.data.needsReconnect && (
        <div className={styles.reconnectBanner} role="alert">
          <span>Переподключите Instagram — доступ к аккаунту был потерян.</span>
          <button type="button" onClick={startInstagramLogin} disabled={reconnecting}>
            {reconnecting ? 'Переходим…' : 'Переподключить'}
          </button>
          {reconnectError && <span className={styles.error}>{reconnectError}</span>}
        </div>
      )}
      {instagramError && <p className={styles.error} role="alert">{instagramError}</p>}
      {account.platform === 'instagram' && account.type === 'public_no_access' && (
        <div className={styles.fullAccess}>
          <span>Публичные данные: охват и репосты недоступны</span>
          <button type="button" onClick={startInstagramLogin} disabled={reconnecting}>
            {reconnecting ? 'Переходим…' : 'Подключить полный доступ'}
          </button>
          {reconnectError && !detail.data.needsReconnect && <span className={styles.error}>{reconnectError}</span>}
        </div>
      )}
      <section className={styles.overview} aria-label="Сводка за период">
        <PeriodPicker value={period} onChange={changePeriod} allTimeFrom={coverage.postsFrom} />
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
            <PostTypeFilter platform={account.platform} value={typeFilter} onChange={changeType} />
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
              <PostTable posts={table.data.items} total={table.data.total} onOpen={setOpenPost} extraMetrics={extraMetrics} />
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
      <PostModal post={openPost} platform={account.platform} extraMetrics={extraMetrics} onClose={() => setOpenPost(null)} />
    </div>
  );
}
