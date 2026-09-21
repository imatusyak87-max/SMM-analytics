import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import styles from './LoginPage.module.css';

function errorMessage(err: unknown): string {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return message ?? 'Неверный логин или пароль';
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      setError(errorMessage(err));
      // Only on failure: a successful login leaves this page for good, and
      // setting state on the way out would be a no-op at best.
      setPending(false);
    }
  }

  return (
    <div className={styles.page}>
      <span className={styles.brand}>SMM Analytics</span>

      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.heading}>Вход</h1>

        <label className={styles.label} htmlFor="email">
          Логин
        </label>
        <input
          id="email"
          className={styles.input}
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className={styles.label} htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Входим…' : 'Войти'}
        </button>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
