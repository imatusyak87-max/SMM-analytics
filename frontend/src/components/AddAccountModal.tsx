import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import styles from './AddAccountModal.module.css';

interface AddAccountModalProps {
  onClose: () => void;
  onCreated: () => void;
}

interface AccountPreview {
  platform: string;
  externalId: string;
  name: string;
  followersCount: number;
  avatarDataUri: string | null;
}

export function AddAccountModal({ onClose, onCreated }: AddAccountModalProps) {
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const trimmed = link.trim();
    setPreview(null);
    setError(null);
    if (trimmed === '') return;

    let cancelled = false;
    setResolving(true);
    const timer = setTimeout(() => {
      apiClient
        .post('/accounts/preview', { link: trimmed })
        .then((res) => {
          if (!cancelled) setPreview(res.data);
        })
        .catch((err) => {
          if (!cancelled) setError(err.response?.data?.message ?? 'Не удалось найти аккаунт');
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link]);

  async function handleAdd() {
    setAdding(true);
    setError(null);
    try {
      await apiClient.post('/accounts/from-link', { link: link.trim() });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить аккаунт');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавьте аккаунт" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавьте аккаунт конкурента</h2>

        <label className={styles.label} htmlFor="account-link">
          Ссылка на аккаунт
        </label>
        <input
          id="account-link"
          className={styles.input}
          placeholder="https://t.me/channelname"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />

        {resolving && <p className={styles.resolving}>Проверяем…</p>}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {preview && (
          <div className={styles.preview}>
            {preview.avatarDataUri ? (
              <img className={styles.avatar} src={preview.avatarDataUri} alt={preview.name} />
            ) : (
              <div className={styles.avatarFallback} aria-hidden="true" />
            )}
            <div className={styles.previewText}>
              <div className={styles.previewName}>
                <PlatformIcon platform={preview.platform} />
                {preview.name}
              </div>
              <div className={styles.previewFollowers}>
                <span className={styles.previewCount}>{preview.followersCount}</span> подписчиков
              </div>
            </div>
            <button type="button" className={styles.submit} onClick={handleAdd} disabled={adding}>
              Добавить
            </button>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
