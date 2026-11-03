import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import type { ProfileSummary } from '../profiles';
import styles from './MoveAccountButton.module.css';

interface MoveAccountButtonProps {
  accountId: string;
  currentProjectId: string;
  onMoved: () => void;
}

/** «Перенести…»: moves the account into another project, keeping all its statistics. */
export function MoveAccountButton({ accountId, currentProjectId, onMoved }: MoveAccountButtonProps) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const list = useApiGet<ProfileSummary[]>('/profiles', {}, { enabled: open });
  const others = (list.data ?? []).filter((p) => p.id !== currentProjectId);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function move(projectId: string) {
    setMoving(true);
    setError(null);
    try {
      await apiClient.patch(`/accounts/${accountId}/profile`, { profileId: projectId });
      setOpen(false);
      onMoved();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось перенести аккаунт');
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Перенести…
      </button>
      {open && (
        <div className={styles.popover} role="menu" aria-label="Перенести в проект">
          {list.data && others.length === 0 && <p className={styles.empty}>Других проектов нет</p>}
          {others.map((p) => (
            // Names can repeat across clients; the networks tell them apart.
            <button key={p.id} type="button" role="menuitem" className={styles.item} disabled={moving}
              onClick={() => move(p.id)}>
              {`${p.name} (${p.accounts.map((a) => a.account.platform).join(', ')})`}
            </button>
          ))}
        </div>
      )}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
