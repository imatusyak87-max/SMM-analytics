import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import styles from './HistoryLoadPanel.module.css';

interface HistoryLoad {
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  phase: 'posts' | 'insights';
  postsLoaded: number;
  oldestPostAt: string | null;
  insightsDone: number;
  insightsTotal: number;
  pausedUntil: string | null;
  pauseReason: 'instagram_rate_limit' | 'telegram_rate_limit' | 'network' | null;
  errorMessage: string | null;
}

interface HistoryLoadPanelProps {
  accountId: string;
  /** Called once when a load this page watched reaches «done». */
  onFinished: () => void;
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const pad = (n: number) => String(n).padStart(2, '0');
const posts = (n: number) => `${n} ${plural(n, 'пост', 'поста', 'постов')}`;
const monthYear = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
};
const date = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const time = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const minutesLeft = (iso: string) => {
  const m = Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
  return `${m} ${plural(m, 'минуту', 'минуты', 'минут')}`;
};

function isLoad(data: unknown): data is HistoryLoad {
  return !!data && typeof data === 'object' && 'status' in data;
}

function progressText(load: HistoryLoad): string {
  if (load.phase === 'insights') return `Досчитываем охваты: ${load.insightsDone} из ${load.insightsTotal}`;
  const reached = load.oldestPostAt ? `, дошли до ${monthYear(load.oldestPostAt)}` : '';
  return `Загружаем историю: ${posts(load.postsLoaded)}${reached}`;
}

function pauseText(load: HistoryLoad): string {
  const until = load.pausedUntil ?? new Date().toISOString();
  if (load.pauseReason === 'instagram_rate_limit') return `Пауза: лимит запросов Instagram, продолжим в ${time(until)}`;
  if (load.pauseReason === 'telegram_rate_limit') return `Telegram ограничил запросы, продолжим через ${minutesLeft(until)}`;
  return `Проблема с сетью, продолжим через ${minutesLeft(until)}`;
}

const POLL_ACTIVE_MS = 5_000;
const POLL_PAUSED_MS = 60_000;

export function HistoryLoadPanel({ accountId, onFinished }: HistoryLoadPanelProps) {
  const [load, setLoad] = useState<HistoryLoad | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a transition seen on this page counts as «finished»; a load that was
  // already done when the page opened must not trigger a reload.
  const lastStatus = useRef<HistoryLoad['status'] | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const accept = useCallback((data: unknown) => {
    const next = isLoad(data) ? data : null;
    if (next?.status === 'done' && lastStatus.current !== null && lastStatus.current !== 'done') finishedRef.current();
    lastStatus.current = next?.status ?? null;
    setLoad(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/accounts/${accountId}/history-load`);
      accept(data);
    } catch {
      // A missed poll is retried on the next tick.
    }
  }, [accountId, accept]);

  useEffect(() => {
    lastStatus.current = null;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!load) return;
    const wait =
      load.status === 'queued' || load.status === 'running'
        ? POLL_ACTIVE_MS
        : load.status === 'paused'
          ? POLL_PAUSED_MS
          : null;
    if (wait === null) return;
    const timer = setTimeout(() => void refresh(), wait);
    return () => clearTimeout(timer);
  }, [load, refresh]);

  async function start() {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const { data } = await apiClient.post(`/accounts/${accountId}/history-load`);
      accept(data);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось запустить загрузку истории');
    } finally {
      setStarting(false);
    }
  }

  const status = load?.status;

  return (
    <div className={styles.panel}>
      {!load && (
        <>
          <button type="button" className={styles.button} onClick={start} disabled={starting}>
            Загрузить все посты
          </button>
          <p className={styles.hint}>Один раз загрузит все посты аккаунта. Может занять от минут до нескольких часов.</p>
        </>
      )}

      {load && (status === 'queued' || status === 'running' || status === 'paused') && (
        <div className={styles.progress} aria-live="polite">
          {status !== 'paused' && <span className={styles.spinner} aria-hidden="true" />}
          <span>{progressText(load)}</span>
          {status === 'paused' && <span className={styles.pause}>{pauseText(load)}</span>}
        </div>
      )}

      {load && status === 'done' && (
        <div className={styles.progress}>
          <span>
            Вся история загружена: {posts(load.postsLoaded)}
            {load.oldestPostAt ? ` с ${date(load.oldestPostAt)}` : ''}
          </span>
          <button type="button" className={styles.link} onClick={start} disabled={starting}>
            Обновить всю историю
          </button>
        </div>
      )}

      {load && status === 'failed' && (
        <div className={styles.progress}>
          <span className={styles.failure}>Не удалось загрузить историю: {load.errorMessage}</span>
          <button type="button" className={styles.button} onClick={start} disabled={starting}>
            Продолжить
          </button>
        </div>
      )}

      {error && (
        <p className={styles.failure} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
