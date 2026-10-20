import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import { AddAccountDialog } from '../components/AddAccountDialog';
import { NETWORKS, type LinkPlatform } from '../components/LinkField';
import { NetworkTile } from '../components/NetworkTile';
import { formatCount } from '../format';
import type { ProfileSummary } from '../profiles';
import styles from './ProjectPage.module.css';

export function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const failed = (location.state as { failed?: Array<{ platform: string; message: string }> } | null)?.failed ?? [];
  const [adding, setAdding] = useState<LinkPlatform | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
          {status === 404 ? 'Проект не найден' : 'Не удалось загрузить проект'}
        </p>
        <Link to="/projects" className={styles.back}>
          Вернуться ко всем проектам
        </Link>
      </div>
    );
  }

  if (!profile.data) return <p className={styles.loading}>Загрузка…</p>;

  const { name, totalFollowers, accounts } = profile.data;

  // One tile per network; a legacy second account of a network gets an extra tile after the four.
  const firsts = NETWORKS.map((network) => accounts.find((a) => a.account.platform === network.platform));
  const extras = accounts.filter((a) => !firsts.includes(a));
  const reload = () => setReloadKey((key) => key + 1);

  async function deleteProject() {
    if (!confirm(`Удалить проект «${name}» вместе со всеми аккаунтами и данными?`)) return;
    try {
      setDeleteError(null);
      await apiClient.delete(`/profiles/${id}`);
      navigate('/projects');
    } catch (err: any) {
      setDeleteError(err.response?.data?.message ?? 'Не удалось удалить проект');
    }
  }

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
      // class-validator reports several problems as an array of messages.
      const message = err.response?.data?.message;
      setRenameError(Array.isArray(message) ? message.join(', ') : (message ?? 'Не удалось переименовать проект'));
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        {editing ? (
          <input
            className={styles.nameInput}
            aria-label="Название проекта"
            value={draft}
            maxLength={100}
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
        <button type="button" className={styles.deleteButton} onClick={deleteProject}>Удалить проект</button>
      </div>
      {failed.length > 0 && (
        <p className={styles.error} role="alert">
          {failed.map((f) => `Не удалось добавить: ${NETWORKS.find((n) => n.platform === f.platform)?.name ?? f.platform} — ${f.message}`).join('. ')}
        </p>
      )}
      {deleteError && <p className={styles.error} role="alert">{deleteError}</p>}
      {renameError && (
        <p className={styles.error} role="alert">
          {renameError}
        </p>
      )}
      <div className={styles.grid}>
        {NETWORKS.map((network, i) => (
          <NetworkTile key={network.platform} network={network} item={firsts[i]}
            onAdd={() => setAdding(network.platform as LinkPlatform)} onRemoved={reload} />
        ))}
        {extras.map((item) => {
          const network = NETWORKS.find((n) => n.platform === item.account.platform) ?? NETWORKS[0];
          return <NetworkTile key={item.account.id} network={network} item={item} onAdd={() => {}} onRemoved={reload} />;
        })}
      </div>
      {adding && (
        <AddAccountDialog projectId={id!} platform={adding} onClose={() => setAdding(null)}
          onAdded={() => { setAdding(null); reload(); }} />
      )}
    </div>
  );
}
