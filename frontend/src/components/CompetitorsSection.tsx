import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatCount } from '../format';
import { formatIsoDate } from '../periods';
import styles from './CompetitorsSection.module.css';

interface Suggestion {
  externalId: string;
  name: string;
  followersCount: number;
  reason: string;
  fit: number;
  rank: number;
  alreadyTracked: boolean;
  trackedAccountId: string | null;
}

interface CompetitorsPayload {
  enabled: boolean;
  run: {
    id: string;
    status: 'pending' | 'running' | 'success' | 'failed';
    niche: string | null;
    errorMessage: string | null;
    finishedAt: string | null;
  } | null;
  suggestions: Suggestion[];
}

const POLL_MS = 5000;

export function CompetitorsSection({ accountId }: { accountId: string }) {
  const [data, setData] = useState<CompetitorsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  }, []);

  // Polling is armed and disarmed right here, as soon as a response comes in,
  // rather than from a separate effect watching derived state: a state update
  // from outside an event handler (like this one) isn't guaranteed to have
  // its follow-on render/effects flushed before the caller's next line runs
  // (tests advancing fake timers right after mount rely on this), so the
  // interval itself must not wait on that.
  const load = useCallback(async () => {
    const res = await apiClient.get(`/accounts/${accountId}/competitors`);
    const payload = res.data as CompetitorsPayload;
    setData(payload);
    const stillRunning = payload.run?.status === 'pending' || payload.run?.status === 'running';
    if (stillRunning) {
      if (!poll.current) {
        poll.current = setInterval(() => {
          load().catch(() => undefined);
        }, POLL_MS);
      }
    } else {
      stopPolling();
    }
    return payload;
  }, [accountId, stopPolling]);

  useEffect(() => {
    load().catch(() => setError('Не удалось загрузить конкурентов'));
    return () => stopPolling();
  }, [load, stopPolling]);

  // Derived purely for rendering (disabling the button, showing the "in progress" note).
  const running = data?.run?.status === 'pending' || data?.run?.status === 'running';

  async function refresh() {
    setError(null);
    try {
      await apiClient.post(`/accounts/${accountId}/competitors/refresh`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось запустить подбор');
    }
  }

  async function add(handle: string) {
    setAdding(handle);
    setError(null);
    try {
      await apiClient.post('/accounts/from-link', { link: `https://t.me/${handle}` });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить канал');
    } finally {
      setAdding(null);
    }
  }

  const suggestions = data?.suggestions ?? [];
  const failed = data?.run?.status === 'failed';

  return (
    <section className={styles.section} aria-labelledby="competitors-heading">
      <div className={styles.header}>
        <h3 id="competitors-heading" className={styles.heading}>
          Конкуренты
        </h3>
        {data?.run?.niche && (
          <span className={styles.niche}>
            Ниша: {data.run.niche}
            {data.run.finishedAt && ` · обновлено ${formatIsoDate(data.run.finishedAt.slice(0, 10))}`}
          </span>
        )}
        <button
          type="button"
          className={styles.refresh}
          onClick={refresh}
          disabled={!data?.enabled || running}
        >
          Обновить конкурентов
        </button>
      </div>

      {data && !data.enabled && <p className={styles.note}>Подбор конкурентов не настроен</p>}
      {running && <p className={styles.note}>Подбираем конкурентов… обычно 1–2 минуты</p>}
      {(error || (failed && data?.run?.errorMessage)) && (
        <p className={styles.error} role="alert">
          {error ?? data?.run?.errorMessage}
        </p>
      )}

      {suggestions.length > 0 ? (
        <ul className={styles.list}>
          {suggestions.map((s) => (
            <li key={s.externalId} className={styles.item}>
              <div className={styles.info}>
                <span className={styles.name}>{s.name}</span>
                <a
                  className={styles.handle}
                  href={`https://t.me/${s.externalId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{s.externalId}
                </a>
                <span className={styles.followers}>{formatCount(s.followersCount)} подписчиков</span>
                <span className={styles.reason}>{s.reason}</span>
              </div>
              {s.alreadyTracked ? (
                <Link className={styles.tracked} to={`/accounts/${s.trackedAccountId}`}>
                  Уже отслеживается
                </Link>
              ) : (
                <button
                  type="button"
                  className={styles.add}
                  onClick={() => add(s.externalId)}
                  disabled={adding === s.externalId}
                >
                  Добавить
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        data?.run?.status === 'success' && <p className={styles.note}>Не нашли похожих каналов</p>
      )}
    </section>
  );
}
