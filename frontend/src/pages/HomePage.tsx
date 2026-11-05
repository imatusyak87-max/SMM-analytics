import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styles from './HomePage.module.css';

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Set by the Instagram login callback when the login could not be tied to an account.
  const [instagramError] = useState(() => searchParams.get('instagramError'));
  useEffect(() => {
    if (searchParams.has('instagramError')) setSearchParams({}, { replace: true });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Единый центр отчетности FD Agency</h1>
      {instagramError && <p className={styles.error} role="alert">{instagramError}</p>}
      <div className={styles.actions}>
        <Link to="/projects" className={styles.primary}>Все проекты</Link>
        <Link to="/guide" className={styles.secondary}>Как пользоваться</Link>
      </div>
    </div>
  );
}
