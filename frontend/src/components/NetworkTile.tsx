import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatCount } from '../format';
import type { ProfileAccountItem } from '../profiles';
import type { NETWORKS } from './LinkField';
import { PlatformIcon } from './PlatformIcon';
import { useAvatar } from './useAvatar';
import styles from './NetworkTile.module.css';

interface NetworkTileProps {
  network: (typeof NETWORKS)[number];
  item?: ProfileAccountItem;
  onAdd: () => void;
  onRemoved: () => void;
}

export function NetworkTile({ network, item, onAdd, onRemoved }: NetworkTileProps) {
  if (item) return <FilledTile item={item} onRemoved={onRemoved} />;
  if (!network.available) {
    return (
      <div className={`${styles.tile} ${styles.soon}`} data-testid="network-tile" data-platform={network.platform}>
        <span className={styles.plus} aria-hidden="true">+</span>
        <span>{network.name} — скоро</span>
      </div>
    );
  }
  return (
    <button type="button" className={`${styles.tile} ${styles.empty}`} data-testid="network-tile"
      data-platform={network.platform} onClick={onAdd} aria-label={`Добавить ${network.name}`}>
      <span className={styles.plus} aria-hidden="true">+</span>
      <span>Добавить {network.name}</span>
    </button>
  );
}

function FilledTile({ item, onRemoved }: { item: ProfileAccountItem; onRemoved: () => void }) {
  const { account, latestSnapshot } = item;
  const avatarSrc = useAvatar(account.id, account.avatarUrl !== null);
  const [error, setError] = useState<string | null>(null);

  async function remove(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Убрать «${account.name}» из проекта? Вся собранная статистика этого аккаунта будет удалена.`)) return;
    try {
      setError(null);
      await apiClient.delete(`/accounts/${account.id}`);
      onRemoved();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось убрать аккаунт');
    }
  }

  return (
    <div className={styles.tile} data-testid="network-tile" data-platform={account.platform}>
      <Link to={`/accounts/${account.id}`} className={styles.link}>
        {avatarSrc ? <img className={styles.avatar} src={avatarSrc} alt="" /> : <div className={styles.avatarFallback} aria-hidden="true" />}
        <span className={styles.name}><PlatformIcon platform={account.platform} /> {account.name}</span>
        <span className={styles.followers}>{formatCount(latestSnapshot?.followersCount ?? null)} подписчиков</span>
      </Link>
      <button type="button" className={styles.remove} onClick={remove}>Убрать</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
