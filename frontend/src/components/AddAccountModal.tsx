import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import styles from './AddAccountModal.module.css';

interface AddAccountModalProps {
  onClose: () => void;
  onCreated: () => void;
}

interface AccountPreview {
  platform: string;
  externalId: string;
  name: string;
  followersCount: number;
  avatarDataUri: string | null;
  alreadyAdded: boolean;
}

type Platform = 'telegram' | 'instagram';
type InstagramKind = 'own' | 'client';

export function AddAccountModal({ onClose, onCreated }: AddAccountModalProps) {
  const [platform, setPlatform] = useState<Platform>('telegram');

  // --- Telegram tab state (unchanged behaviour from before this task) ---
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (platform !== 'telegram') return;
    const trimmed = link.trim();
    setPreview(null);
    setError(null);
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
          if (!cancelled) setError(err.response?.data?.message ?? 'Не удалось найти аккаунт');
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link, platform]);

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

  // --- Instagram tab state ---
  const [instagramKind, setInstagramKind] = useState<InstagramKind>('own');
  const [connecting, setConnecting] = useState(false);
  const [instagramError, setInstagramError] = useState<string | null>(null);

  async function handleConnectInstagram() {
    setConnecting(true);
    setInstagramError(null);
    try {
      const { data } = await apiClient.get('/accounts/instagram/connect', { params: { type: instagramKind } });
      // Full-page navigation, not an in-app route: Instagram's own login screen
      // is outside the SPA, and the callback lands back on /accounts/:id once done.
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setInstagramError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setConnecting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-label="Добавьте аккаунт" onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Добавьте аккаунт</h2>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={platform === 'telegram'}
            className={platform === 'telegram' ? styles.tabActive : styles.tab}
            onClick={() => setPlatform('telegram')}
          >
            Telegram
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={platform === 'instagram'}
            className={platform === 'instagram' ? styles.tabActive : styles.tab}
            onClick={() => setPlatform('instagram')}
          >
            Instagram
          </button>
        </div>

        {platform === 'telegram' ? (
          <>
            <p className={styles.helperText}>Вставьте ссылку на публичный канал конкурента.</p>

            <label className={styles.label} htmlFor="account-link">
              Ссылка на аккаунт
            </label>
            <input
              id="account-link"
              className={styles.input}
              placeholder="https://t.me/channelname"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />

            {resolving && <p className={styles.resolving}>Проверяем…</p>}

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
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
                  {preview.alreadyAdded && (
                    <p className={styles.duplicate}>Этот аккаунт уже добавлен</p>
                  )}
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

            <label className={styles.radioRow}>
              <input
                type="radio"
                name="instagram-kind"
                checked={instagramKind === 'own'}
                onChange={() => setInstagramKind('own')}
                aria-label="Свой аккаунт"
              />
              Свой аккаунт
            </label>
            <label className={styles.radioRow}>
              <input
                type="radio"
                name="instagram-kind"
                checked={instagramKind === 'client'}
                onChange={() => setInstagramKind('client')}
                aria-label="Аккаунт клиента"
              />
              Аккаунт клиента
            </label>

            {instagramError && (
              <p className={styles.error} role="alert">
                {instagramError}
              </p>
            )}

            <button type="button" className={styles.connectButton} onClick={handleConnectInstagram} disabled={connecting}>
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
