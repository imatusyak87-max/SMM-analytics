import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
        <span className={styles.brand}>SMM Analytics</span>
        <nav className={styles.nav}>
          <NavLink to="/" end className={navLinkClassName}>
            Overview
          </NavLink>
          <NavLink to="/compare" className={navLinkClassName}>
            Compare
          </NavLink>
        </nav>
        <button type="button" className={styles.logout} onClick={handleLogout}>
          Log out
        </button>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
