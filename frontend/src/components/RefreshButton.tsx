import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import styles from './RefreshButton.module.css';

function statusClassName(status: string): string {
  if (status === 'success') return `${styles.status} ${styles.statusSuccess}`;
  if (status === 'failed') return `${styles.status} ${styles.statusFailed}`;
  return styles.status;
}

export function RefreshButton({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (poll.current) clearInterval(poll.current);
  }, []);

  async function handleClick() {
    setError(null);
    setStatus(null);
    try {
      const { data: job } = await apiClient.post(`/accounts/${accountId}/sync`);
      setStatus(job.status);
      poll.current = setInterval(async () => {
        try {
          const { data: updated } = await apiClient.get(`/sync-jobs/${job.id}`);
          setStatus(updated.status);
          if (updated.status === 'success' || updated.status === 'failed') {
            clearInterval(poll.current!);
          }
        } catch {
          clearInterval(poll.current!);
          setError('Потеряна связь с сервером при обновлении статуса');
        }
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось запустить обновление');
    }
  }

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.button} onClick={handleClick}>
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
