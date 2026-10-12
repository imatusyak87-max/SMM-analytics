import { useState } from 'react';
import { apiClient } from '../api/client';
import { useApiGet } from '../api/useApiGet';
import type { ProfileSummary } from '../profiles';
import styles from './ProfileSwitcher.module.css';

const NEW_PROFILE = '__new__';

interface ProfileSwitcherProps {
  accountId: string;
  profile: { id: string; name: string; accountCount: number };
  onMoved: () => void;
}

/** Where the user regroups accounts, including merging the one-account profiles the migration made. */
export function ProfileSwitcher({ accountId, profile, onMoved }: ProfileSwitcherProps) {
  const [listKey, setListKey] = useState(0);
  const list = useApiGet<ProfileSummary[]>('/profiles', {}, { reloadKey: listKey });
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = (list.data ?? []).filter((p) => p.id !== profile.id);

  async function move(value: string) {
    if (value === profile.id) return;
    setMoving(true);
    setError(null);
    try {
      await apiClient.patch(
        `/accounts/${accountId}/profile`,
        value === NEW_PROFILE ? { newProfile: true } : { profileId: value },
      );
      setListKey((key) => key + 1);
      onMoved();
    } catch (err: any) {
      if (err.response?.status === 404) {
        setError('Профиль не найден');
        setListKey((key) => key + 1);
      } else {
        setError(err.response?.data?.message ?? 'Не удалось перенести аккаунт');
      }
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className={styles.switcher}>
      <label className={styles.label} htmlFor="profile-switcher">
        Профиль:
      </label>
      <select
        id="profile-switcher"
        className={styles.select}
        value={profile.id}
        disabled={moving}
        onChange={(e) => move(e.target.value)}
      >
        <option value={profile.id}>{profile.name}</option>
        {others.map((p) => (
          // Names can repeat across clients; the networks tell them apart.
          <option key={p.id} value={p.id}>
            {`${p.name} (${p.accounts.map((a) => a.account.platform).join(', ')})`}
          </option>
        ))}
        {profile.accountCount > 1 && <option value={NEW_PROFILE}>Отдельный профиль</option>}
      </select>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
