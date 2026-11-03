import { type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import styles from './Layout.module.css';

interface LayoutProps {
  children: ReactNode;
}

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink;
}

export function Layout({ children }: LayoutProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>FD Agency</Link>
        <nav className={styles.nav}>
          <NavLink to="/projects" className={navLinkClassName}>Все проекты</NavLink>
          <NavLink to="/guide" className={navLinkClassName}>Как пользоваться</NavLink>
        </nav>
        <button type="button" className={styles.logout} onClick={handleLogout}>Выйти</button>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
