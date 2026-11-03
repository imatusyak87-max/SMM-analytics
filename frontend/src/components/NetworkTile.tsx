import { Link } from 'react-router-dom';
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
}

export function NetworkTile({ network, item, onAdd }: NetworkTileProps) {
  if (item) return <FilledTile item={item} />;
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

function FilledTile({ item }: { item: ProfileAccountItem }) {
  const { account, latestSnapshot } = item;
  const avatarSrc = useAvatar(account.id, account.avatarUrl !== null);

  return (
    <div className={styles.tile} data-testid="network-tile" data-platform={account.platform}>
      <Link to={`/accounts/${account.id}`} className={styles.link}>
        {avatarSrc ? <img className={styles.avatar} src={avatarSrc} alt="" /> : <div className={styles.avatarFallback} aria-hidden="true" />}
        <span className={styles.name}><PlatformIcon platform={account.platform} /> {account.name}</span>
        <span className={styles.followers}>{formatCount(latestSnapshot?.followersCount ?? null)} подписчиков</span>
      </Link>
    </div>
  );
}
