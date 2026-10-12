import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import { AccountCard } from '../components/AccountCard';
import { formatCount } from '../format';
import type { ProfileSummary } from '../profiles';
import styles from './ProfilePage.module.css';

export function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const profile = useApiGet<ProfileSummary>(`/profiles/${id}`, {}, { reloadKey });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  // Escape blurs the input too; this tells the blur handler not to save.
  const cancelled = useRef(false);

  if (profile.error) {
    const status = (profile.error as { response?: { status?: number } }).response?.status;
    return (
      <div className={styles.page}>
        <p className={styles.error} role="alert">
          {status === 404 ? 'Профиль не найден' : 'Не удалось загрузить профиль'}
        </p>
        <Link to="/" className={styles.back}>
          Вернуться к обзору
        </Link>
      </div>
    );
  }

  if (!profile.data) return <p className={styles.loading}>Загрузка…</p>;

  const { name, totalFollowers, accounts } = profile.data;

  function startEditing() {
    setDraft(name);
    setRenameError(null);
    cancelled.current = false;
    setEditing(true);
  }

  async function finishEditing() {
    setEditing(false);
    if (cancelled.current || draft === name) return;
    try {
      await apiClient.patch(`/profiles/${id}`, { name: draft });
      setReloadKey((key) => key + 1);
    } catch (err: any) {
      setRenameError(err.response?.data?.message ?? 'Не удалось переименовать профиль');
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        {editing ? (
          <input
            className={styles.nameInput}
            aria-label="Название профиля"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <>
            <h2 className={styles.heading}>{name}</h2>
            <button type="button" className={styles.rename} aria-label="Переименовать" onClick={startEditing}>
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
                <path
                  fill="currentColor"
                  d="M11.3 1.3a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-8.5 8.5-3.4.9a.5.5 0 0 1-.6-.6l.9-3.4 8.2-8.8Z"
                />
              </svg>
            </button>
          </>
        )}
        <span className={styles.total}>
          Подписчики: <span className={styles.totalValue}>{formatCount(totalFollowers)}</span>
        </span>
      </div>
      {renameError && (
        <p className={styles.error} role="alert">
          {renameError}
        </p>
      )}
      <div className={styles.grid}>
        {accounts.map((item) => (
          <AccountCard
            key={item.account.id}
            account={item.account}
            latestSnapshot={item.latestSnapshot}
            // The last account takes the profile with it, so there is nothing left to show here.
            onDeleted={() => (accounts.length <= 1 ? navigate('/') : setReloadKey((key) => key + 1))}
          />
        ))}
      </div>
    </div>
  );
}
