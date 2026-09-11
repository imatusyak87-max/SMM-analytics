import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import styles from './RefreshButton.module.css';

function statusClassName(status: string): string {
  if (status === 'success') return `${styles.status} ${styles.statusSuccess}`;
  if (status === 'failed') return `${styles.status} ${styles.statusFailed}`;
  return styles.status;
}

/** The job stores the backend's English error; known causes get a Russian explanation. */
function describeSyncFailure(errorMessage: string | null | undefined): string {
  if (errorMessage?.startsWith('No posts found on the preview page')) {
    return 'Telegram не показывает посты этого канала: у него отключён веб-просмотр';
  }
  return errorMessage ?? 'Обновление не удалось';
}

interface RefreshButtonProps {
  accountId: string;
  onSynced?: () => void;
}

export function RefreshButton({ accountId, onSynced }: RefreshButtonProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (poll.current) clearInterval(poll.current);
  }, []);

  function stopPolling() {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  }

  async function handleClick() {
    // Two clicks landing before the first POST resolves would queue two syncs.
    if (starting) return;
    setStarting(true);
    setError(null);
    setStatus(null);
    // A second click used to start a new interval on top of the old one. The orphan
    // polled forever, and its own clearInterval(poll.current) killed the newer poller
    // instead of itself, freezing the status badge.
    stopPolling();
    try {
      const { data: job } = await apiClient.post(`/accounts/${accountId}/sync`);
      setStatus(job.status);
      const thisPoll: ReturnType<typeof setInterval> = setInterval(async () => {
        try {
          const { data: updated } = await apiClient.get(`/sync-jobs/${job.id}`);
          setStatus(updated.status);
          if (updated.status === 'success' || updated.status === 'failed') {
            clearInterval(thisPoll);
            if (poll.current === thisPoll) poll.current = null;
            if (updated.status === 'success') onSynced?.();
            else setError(describeSyncFailure(updated.errorMessage));
          }
        } catch {
          clearInterval(thisPoll);
          if (poll.current === thisPoll) poll.current = null;
          setError('Потеряна связь с сервером при обновлении статуса');
        }
      }, 2000);
      poll.current = thisPoll;
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось запустить обновление');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.button} onClick={handleClick} disabled={starting}>
        Обновить
      </button>
      {status && <span className={statusClassName(status)}>{status}</span>}
      {error && (
        <span className={`${styles.status} ${styles.statusFailed}`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
