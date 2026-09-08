import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import { useAvatar } from './useAvatar';
import styles from './AccountCard.module.css';

interface AccountCardProps {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
  onDeleted: () => void;
}

export function AccountCard({ account, latestSnapshot, onDeleted }: AccountCardProps) {
  const avatarSrc = useAvatar(account.id, account.avatarUrl !== null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Удалить «${account.name}» и всю собранную статистику?`)) return;
    try {
      setDeleteError(null);
      await apiClient.delete(`/accounts/${account.id}`);
      onDeleted();
    } catch (err: any) {
      // Without this the card just sat there, giving no sign the delete had failed.
      setDeleteError(err.response?.data?.message ?? 'Не удалось удалить аккаунт');
    }
  }

  return (
    <Link to={`/accounts/${account.id}`} className={styles.card} data-testid="account-card">
      <button type="button" className={styles.delete} aria-label="Удалить аккаунт" onClick={handleDelete}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6.5 1h3a.5.5 0 0 1 .5.5V2h3.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H6v-.5a.5.5 0 0 1 .5-.5Zm-2.9 4h8.8l-.6 8.55A1.5 1.5 0 0 1 10.3 15H5.7a1.5 1.5 0 0 1-1.5-1.45L3.6 5Zm2.4 2a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 1 0v-5a.5.5 0 0 0-.5-.5Zm4 0a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 1 0v-5a.5.5 0 0 0-.5-.5Z"
          />
        </svg>
      </button>
      {deleteError && (
        <span className={styles.deleteError} role="alert">
          {deleteError}
        </span>
      )}
      <div className={styles.identity}>
        {avatarSrc ? (
          <img className={styles.avatar} src={avatarSrc} alt={account.name} />
        ) : (
          <div className={styles.avatarFallback} aria-hidden="true" />
        )}
        <div className={styles.identityText}>
          <span className={styles.badge}>
            <PlatformIcon platform={account.platform} />
            {account.platform}
          </span>
          <h3 className={styles.name}>{account.name}</h3>
        </div>
      </div>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Followers</span>
          <span className={styles.statValue}>{latestSnapshot ? latestSnapshot.followersCount : '—'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>ER</span>
          <span className={styles.statValue}>
            {latestSnapshot?.avgEr != null ? `${latestSnapshot.avgEr.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>
    </Link>
  );
}
