import { Link } from 'react-router-dom';
import { formatCount } from '../format';
import { profileHref, type ProfileSummary } from '../profiles';
import { PlatformIcon } from './PlatformIcon';
import { useAvatar } from './useAvatar';
import styles from './ProfileCard.module.css';

export function ProfileCard({ profile }: { profile: ProfileSummary }) {
  // The biggest account stands for the brand.
  const lead = profile.accounts[0].account;
  const avatarSrc = useAvatar(lead.id, lead.avatarUrl !== null);

  return (
    <Link to={profileHref(profile)} className={styles.card} data-testid="profile-card">
      <div className={styles.identity}>
        {avatarSrc ? (
          <img className={styles.avatar} src={avatarSrc} alt={profile.name} />
        ) : (
          <div className={styles.avatarFallback} aria-hidden="true" />
        )}
        <div className={styles.identityText}>
          <span className={styles.networks}>
            {profile.accounts.map(({ account }) => (
              <PlatformIcon key={account.id} platform={account.platform} />
            ))}
          </span>
          <h3 className={styles.name}>{profile.name}</h3>
        </div>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Подписчики</span>
        <span className={styles.statValue}>{formatCount(profile.totalFollowers)}</span>
      </div>
    </Link>
  );
}
