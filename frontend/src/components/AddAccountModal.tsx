import { useState, type FormEvent } from 'react';
import { apiClient } from '../api/client';
import styles from './AddAccountModal.module.css';

interface AddAccountModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function AddAccountModal({ onClose, onCreated }: AddAccountModalProps) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/accounts/from-link', { link });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить аккаунт');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавьте аккаунт" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавьте аккаунт конкурента</h2>
        <form onSubmit={handleSubmit}>
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
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className={styles.submit} disabled={submitting || link.trim() === ''}>
              Добавить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
