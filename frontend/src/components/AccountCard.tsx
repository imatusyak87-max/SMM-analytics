import { Link } from 'react-router-dom';
import styles from './AccountCard.module.css';

interface AccountCardProps {
  account: { id: string; platform: string; name: string; avatarUrl: string | null; type: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export function AccountCard({ account, latestSnapshot }: AccountCardProps) {
  return (
    <Link to={`/accounts/${account.id}`} className={styles.card} data-testid="account-card">
      <span className={styles.badge}>{account.platform}</span>
      <h3 className={styles.name}>{account.name}</h3>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Followers</span>
          <span className={styles.statValue}>{latestSnapshot ? latestSnapshot.followersCount : '—'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>ER</span>
          <span className={styles.statValue}>
            {latestSnapshot?.avgEr != null ? `${latestSnapshot.avgEr.toFixed(1)}%` : '—'}
          </span>
        </div>
      </div>
    </Link>
  );
}
