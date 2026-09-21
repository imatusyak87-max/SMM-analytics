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

type RunStatus = 'pending' | 'running' | 'success' | 'failed';

interface CompetitorsPayload {
  enabled: boolean;
  run: {
    id: string;
    status: RunStatus;
    niche: string | null;
    errorMessage: string | null;
    finishedAt: string | null;
  } | null;
  suggestions: Suggestion[];
}

const POLL_MS = 5000;

/** «Подбираем…» covers both queue states; nothing else in the UI cares which one it is. */
function isInProgress(status: RunStatus | undefined): boolean {
  return status === 'pending' || status === 'running';
}

export function CompetitorsSection({ accountId }: { accountId: string }) {
  const [data, setData] = useState<CompetitorsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  // The last channel marked «Не конкурент», kept for «Отменить». Hidden locally
  // at once, before the reload confirms it.
  const [hidden, setHidden] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  // A load() started before unmount can still resolve after it: its continuation
  // must not arm a fresh interval for a component nothing will ever clear again.
  const mounted = useRef(true);
  // Bumped on every load() call, so a response for an account the user has
  // already navigated away from (accountId changed mid-flight) can tell it is
  // stale and must neither render nor arm a poller for the account it fetched —
  // same generation-counter idea as useApiGet's `latest` ref.
  const generation = useRef(0);

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
    const gen = ++generation.current;
    const res = await apiClient.get(`/accounts/${accountId}/competitors`);
    const payload = res.data as CompetitorsPayload;
    // A response for an account the user has already navigated away from, or one
    // arriving after unmount, must neither render nor arm a poller.
    if (!mounted.current || gen !== generation.current) return payload;
    setData(payload);
    const stillRunning = isInProgress(payload.run?.status);
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
    return () => stopPolling(); // fires on accountId change AND on unmount
  }, [load, stopPolling]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Derived purely for rendering (disabling the button, showing the "in progress" note).
  const running = isInProgress(data?.run?.status);

  async function refresh() {
    setError(null);
    setHidden(null);
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
    setHidden(null);
    try {
      await apiClient.post('/accounts/from-link', { link: `https://t.me/${handle}` });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить канал');
    } finally {
      setAdding(null);
    }
  }

  async function reject(handle: string) {
    setError(null);
    try {
      await apiClient.post(`/accounts/${accountId}/competitors/${handle}/reject`);
      setHidden(handle);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось скрыть канал');
    }
  }

  async function undoReject() {
    if (!hidden) return;
    const handle = hidden;
    setError(null);
    setHidden(null);
    try {
      await apiClient.delete(`/accounts/${accountId}/competitors/${handle}/reject`);
      await load();
    } catch (err: any) {
      setHidden(handle);
      setError(err.response?.data?.message ?? 'Не удалось вернуть канал');
    }
  }

  const suggestions = (data?.suggestions ?? []).filter((s) => s.externalId !== hidden);
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
      {(error || failed) && (
        <p className={styles.error} role="alert">
          {error ?? 'Не удалось подобрать конкурентов'}
        </p>
      )}

      {hidden && (
        <p className={styles.undo}>
          Канал @{hidden} скрыт
          <button type="button" className={styles.undoButton} onClick={undoReject}>
            Отменить
          </button>
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
              <div className={styles.actions}>
                <button type="button" className={styles.reject} onClick={() => reject(s.externalId)}>
                  Не конкурент
                </button>
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
              </div>
            </li>
          ))}
        </ul>
      ) : (
        data?.run?.status === 'success' && <p className={styles.note}>Не нашли похожих каналов</p>
      )}
    </section>
  );
}
