import { type ReactNode } from 'react';
import styles from './AuthShell.module.css';

interface AuthShellProps {
  children: ReactNode;
}

/**
 * Preserves the pre-Task-19 centered/narrow/bordered box presentation
 * (previously provided by global `#root` rules in index.css) for
 * unauthenticated routes like `/login`, now that `#root` itself has
 * been widened into a full app shell for the authenticated dashboard
 * routes. LoginPage.tsx stays unstyled/untouched; this wrapper is the
 * only thing providing its visual presentation.
 */
export function AuthShell({ children }: AuthShellProps) {
  return <div className={styles.shell}>{children}</div>;
}
