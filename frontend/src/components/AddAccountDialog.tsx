import { useState } from 'react';
import { apiClient } from '../api/client';
import { LinkField, NETWORKS, type LinkPlatform } from './LinkField';
import styles from './AddProjectModal.module.css';

interface AddAccountDialogProps {
  projectId: string;
  platform: LinkPlatform;
  onClose: () => void;
  onAdded: () => void;
}

export function AddAccountDialog({ projectId, platform, onClose, onAdded }: AddAccountDialogProps) {
  const network = NETWORKS.find((n) => n.platform === platform)!;
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    setAdding(true);
    setError(null);
    try {
      await apiClient.post(`/profiles/${projectId}/accounts`, { link: link.trim(), platform });
      onAdded();
    } catch (err: any) {
      const message = err.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : (message ?? 'Не удалось добавить аккаунт'));
      setAdding(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label={`Добавить ${network.name}`} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавить {network.name}</h2>
        <LinkField id="tile-link" platform={platform} value={link} onChange={setLink} autoFocus />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>Отмена</button>
          <button type="button" className={styles.submit} onClick={handleAdd} disabled={adding || link.trim() === ''}>Добавить</button>
        </div>
      </div>
    </div>
  );
}
