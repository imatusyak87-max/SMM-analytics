import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { AddProjectModal } from '../components/AddProjectModal';
import { ProfileCard } from '../components/ProfileCard';
import type { ProfileSummary } from '../profiles';
import styles from './ProjectsPage.module.css';

export function ProjectsPage() {
  const [items, setItems] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // The Facebook login (for Instagram competitors) redirects back to /projects?add=project,
  // optionally with the error it failed with; reopen the dialog where the user left it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [isAdding, setIsAdding] = useState(searchParams.get('add') === 'project');
  const [addError, setAddError] = useState<string | null>(searchParams.get('discoveryError'));

  const mounted = useRef(true);

  // The Facebook token behind Instagram competitors lasts ~60 days; once it
  // has expired their data silently stops updating, so say so here.
  const [facebookExpired, setFacebookExpired] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/instagram/discovery/status')
      .then((res) => {
        if (!cancelled && res.data?.connected && res.data?.needsReconnect) setFacebookExpired(true);
      })
      .catch(() => {
        // No status, no banner.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReconnect() {
    setReconnecting(true);
    setReconnectError(null);
    try {
      const { data } = await apiClient.get('/instagram/discovery/connect');
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setReconnectError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setReconnecting(false);
    }
  }

  useEffect(() => {
    // Drop the params so a reload or a later visit does not reopen the dialog.
    if (searchParams.has('add') || searchParams.has('discoveryError')) setSearchParams({}, { replace: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    return apiClient
      .get('/profiles')
      .then((res) => {
        if (mounted.current) setItems(res.data);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  function closeAdding() {
    setIsAdding(false);
    setAddError(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Все проекты</h1>
        <button type="button" className={styles.addButton} onClick={() => setIsAdding(true)}>
          Добавить проект
        </button>
      </div>
      {facebookExpired && (
        <div className={styles.reconnectBanner} role="alert">
          <span>Доступ к Facebook истёк — конкуренты из Instagram не обновляются.</span>
          <button type="button" onClick={handleReconnect} disabled={reconnecting}>
            {reconnecting ? 'Переходим…' : 'Переподключить Facebook'}
          </button>
          {reconnectError && <span>{reconnectError}</span>}
        </div>
      )}
      {loading ? (
        <p className={styles.loading}>Загрузка…</p>
      ) : error ? (
        <p className={styles.error}>Не удалось загрузить проекты. Попробуйте позже.</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>Пока нет ни одного проекта.</p>
      ) : (
        <div className={styles.grid}>
          {items.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} />
          ))}
        </div>
      )}
      {isAdding && (
        <AddProjectModal onClose={closeAdding} initialError={addError} />
      )}
    </div>
  );
}
