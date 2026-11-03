import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { LinkField, NETWORKS, type LinkPlatform } from './LinkField';
import styles from './AddProjectModal.module.css';

interface AddProjectModalProps {
  onClose: () => void;
  /** An error carried back in the URL from the Facebook login redirect. */
  initialError?: string | null;
}

export function AddProjectModal({ onClose, initialError = null }: AddProjectModalProps) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [links, setLinks] = useState<Record<LinkPlatform, string>>({ instagram: '', telegram: '' });
  const [error, setError] = useState<string | null>(initialError);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    const filled = Object.fromEntries(Object.entries(links).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
    try {
      const { data } = await apiClient.post('/profiles', { name: name.trim(), links: filled });
      navigate(`/projects/${data.profile.id}`, { state: { failed: data.failed } });
    } catch (err: any) {
      const message = err.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : (message ?? 'Не удалось создать проект'));
      setCreating(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавить проект" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавить проект</h2>

        <p className={styles.step}>Шаг 1</p>
        <label className={styles.label} htmlFor="project-name">Название проекта</label>
        <input id="project-name" className={styles.input} maxLength={100} autoFocus
          placeholder="Например: Pheromone, Мезопроф, Ренессанс Страхование"
          value={name} onChange={(e) => setName(e.target.value)} />

        <p className={styles.step}>Шаг 2</p>
        <p className={styles.helperText}>Добавьте ссылки на аккаунты проекта — одну или несколько. Можно пропустить и добавить позже.</p>
        {NETWORKS.map((network) =>
          network.available ? (
            <LinkField key={network.platform} id={`link-${network.platform}`} platform={network.platform as LinkPlatform}
              value={links[network.platform as LinkPlatform]}
              onChange={(value) => setLinks((prev) => ({ ...prev, [network.platform]: value }))} />
          ) : (
            <div key={network.platform} className={styles.field}>
              <label className={styles.label} htmlFor={`link-${network.platform}`}>{network.name}</label>
              <span className={styles.soon}>Скоро</span>
              <input id={`link-${network.platform}`} className={styles.input} placeholder={network.example} disabled />
              <p className={styles.example}>Например: {network.example}</p>
            </div>
          ),
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>Отмена</button>
          <button type="button" className={styles.submit} onClick={handleCreate} disabled={creating || name.trim() === ''}>
            {creating ? 'Создаём…' : 'Создать проект'}
          </button>
        </div>
      </div>
    </div>
  );
}
