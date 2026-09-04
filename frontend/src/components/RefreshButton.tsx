import { useState } from 'react';
import { apiClient } from '../api/client';
import styles from './RefreshButton.module.css';

function statusClassName(status: string): string {
  if (status === 'success') return `${styles.status} ${styles.statusSuccess}`;
  if (status === 'failed') return `${styles.status} ${styles.statusFailed}`;
  return styles.status;
}

export function RefreshButton({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  async function handleClick() {
    const { data: job } = await apiClient.post(`/accounts/${accountId}/sync`);
    setStatus(job.status);
    const poll = setInterval(async () => {
      const { data: updated } = await apiClient.get(`/sync-jobs/${job.id}`);
      setStatus(updated.status);
      if (updated.status === 'success' || updated.status === 'failed') clearInterval(poll);
    }, 2000);
  }

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.button} onClick={handleClick}>
        Обновить
      </button>
      {status && <span className={statusClassName(status)}>{status}</span>}
    </div>
  );
}
