import { Link } from 'react-router-dom';
import styles from './HomePage.module.css';

export function HomePage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Единый центр отчетности FD Agency</h1>
      <div className={styles.actions}>
        <Link to="/projects" className={styles.primary}>Все проекты</Link>
        <Link to="/guide" className={styles.secondary}>Как пользоваться</Link>
      </div>
    </div>
  );
}
