import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import styles from './AddAccountModal.module.css';

interface AddAccountModalProps {
  onClose: () => void;
  onCreated: () => void;
  /** An error carried back in the URL from the Facebook login redirect. */
  initialError?: string | null;
}

interface AccountPreview {
  platform: string;
  externalId: string;
  name: string;
  followersCount: number;
  avatarDataUri: string | null;
  alreadyAdded: boolean;
}

type Tab = 'competitor' | 'own';
type FacebookPrompt = 'connect' | 'reconnect';

// Codes the backend sends when an Instagram competitor needs the Facebook login first.
const FACEBOOK_PROMPTS: Record<string, FacebookPrompt> = {
  instagram_discovery_not_connected: 'connect',
  instagram_discovery_reconnect: 'reconnect',
};

export function AddAccountModal({ onClose, onCreated, initialError = null }: AddAccountModalProps) {
  const [tab, setTab] = useState<Tab>('competitor');

  // --- Competitor tab: one link field for every network the backend can read ---
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialError);
  const [facebookPrompt, setFacebookPrompt] = useState<FacebookPrompt | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (tab !== 'competitor') return;
    const trimmed = link.trim();
    setPreview(null);
    setError(null);
    setFacebookPrompt(null);
    if (trimmed === '') return;

    let cancelled = false;
    setResolving(true);
    const timer = setTimeout(() => {
      apiClient
        .post('/accounts/preview', { link: trimmed })
        .then((res) => {
          if (!cancelled) setPreview(res.data);
        })
        .catch((err) => {
          if (cancelled) return;
          const prompt = FACEBOOK_PROMPTS[err.response?.data?.code];
          if (prompt) setFacebookPrompt(prompt);
          else setError(err.response?.data?.message ?? 'Не удалось найти аккаунт');
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link, tab]);

  async function handleAdd() {
    setAdding(true);
    setError(null);
    try {
      await apiClient.post('/accounts/from-link', { link: link.trim() });
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось добавить аккаунт');
    } finally {
      setAdding(false);
    }
  }

  // --- Redirect-based logins (Facebook for competitors, Instagram for own accounts) ---
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function startLogin(request: () => Promise<{ data: { redirectUrl: string } }>) {
    setConnecting(true);
    setConnectError(null);
    try {
      const { data } = await request();
      // Full-page navigation: the login screen is outside the SPA, and the
      // callback brings the browser back into the app once done.
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setConnectError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setConnecting(false);
    }
  }

  const connectFacebook = () => startLogin(() => apiClient.get('/instagram/discovery/connect'));
  // Always 'own' until the own/client split is used somewhere in the app.
  const connectInstagram = () => startLogin(() => apiClient.get('/accounts/instagram/connect', { params: { type: 'own' } }));

  const shownError = error ?? connectError ?? notice;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавьте аккаунт" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавьте аккаунт</h2>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'competitor'}
            className={tab === 'competitor' ? styles.tabActive : styles.tab}
            onClick={() => setTab('competitor')}
          >
            Аккаунт конкурента
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'own'}
            className={tab === 'own' ? styles.tabActive : styles.tab}
            onClick={() => setTab('own')}
          >
            Свой аккаунт
          </button>
        </div>

        {tab === 'competitor' ? (
          <>
            <p className={styles.helperText}>Вставьте ссылку на Telegram-канал или Instagram-аккаунт.</p>

            <label className={styles.label} htmlFor="account-link">
              Ссылка на аккаунт
            </label>
            <input
              id="account-link"
              className={styles.input}
              placeholder="https://t.me/channel или https://instagram.com/brand"
              value={link}
              onChange={(e) => {
                setNotice(null);
                setLink(e.target.value);
              }}
            />

            {resolving && <p className={styles.resolving}>Проверяем…</p>}

            {shownError && (
              <p className={styles.error} role="alert">
                {shownError}
              </p>
            )}

            {facebookPrompt && (
              <div className={styles.facebookPrompt}>
                <p className={styles.helperText}>
                  {facebookPrompt === 'connect'
                    ? 'Чтобы добавлять конкурентов из Instagram, один раз подключите Facebook — страницу, к которой привязан ваш профессиональный аккаунт Instagram.'
                    : 'Доступ к Facebook истёк — переподключите его, чтобы добавлять конкурентов из Instagram.'}
                </p>
                <button type="button" className={styles.connectButton} onClick={connectFacebook} disabled={connecting}>
                  {connecting ? 'Переходим…' : facebookPrompt === 'connect' ? 'Подключить Facebook' : 'Переподключить Facebook'}
                </button>
              </div>
            )}

            {preview && (
              <div className={styles.preview}>
                {preview.avatarDataUri ? (
                  <img className={styles.avatar} src={preview.avatarDataUri} alt={preview.name} />
                ) : (
                  <div className={styles.avatarFallback} aria-hidden="true" />
                )}
                <div className={styles.previewText}>
                  <div className={styles.previewName}>
                    <PlatformIcon platform={preview.platform} />
                    {preview.name}
                  </div>
                  <div className={styles.previewFollowers}>
                    <span className={styles.previewCount}>{preview.followersCount}</span> подписчиков
                  </div>
                  {preview.alreadyAdded && <p className={styles.duplicate}>Этот аккаунт уже добавлен</p>}
                </div>
                <button
                  type="button"
                  className={styles.submit}
                  onClick={handleAdd}
                  disabled={adding || preview.alreadyAdded}
                >
                  Добавить
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className={styles.helperText}>
              Потребуется войти в Instagram владельцу аккаунта. Мы не увидим и не сохраним его пароль.
            </p>

            {connectError && (
              <p className={styles.error} role="alert">
                {connectError}
              </p>
            )}

            <button type="button" className={styles.connectButton} onClick={connectInstagram} disabled={connecting}>
              {connecting ? 'Переходим…' : 'Подключить'}
            </button>
          </>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
