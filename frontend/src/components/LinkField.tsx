import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PlatformIcon } from './PlatformIcon';
import { formatCount } from '../format';
import styles from './AddProjectModal.module.css';

export const NETWORKS = [
  { platform: 'instagram', name: 'Instagram', example: 'https://instagram.com/brand', available: true },
  { platform: 'telegram', name: 'Telegram', example: 'https://t.me/channel', available: true },
  { platform: 'vk', name: 'ВКонтакте', example: 'https://vk.com/brand', available: false },
  { platform: 'youtube', name: 'YouTube', example: 'https://youtube.com/@brand', available: false },
] as const;

export type LinkPlatform = 'instagram' | 'telegram';

interface AccountPreview {
  platform: string;
  name: string;
  followersCount: number;
  avatarDataUri: string | null;
  alreadyAdded: boolean;
  previouslyAdded: boolean;
}

type FacebookPrompt = 'connect' | 'reconnect';
// Codes the backend sends when an Instagram lookup needs the Facebook login first.
const FACEBOOK_PROMPTS: Record<string, FacebookPrompt> = {
  instagram_discovery_not_connected: 'connect',
  instagram_discovery_reconnect: 'reconnect',
};

interface LinkFieldProps {
  id: string;
  platform: LinkPlatform;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

/** One network's link input: checks the link as the user types and shows what it found. */
export function LinkField({ id, platform, value, onChange, autoFocus }: LinkFieldProps) {
  const network = NETWORKS.find((n) => n.platform === platform)!;
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facebookPrompt, setFacebookPrompt] = useState<FacebookPrompt | null>(null);
  const [resolving, setResolving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    setPreview(null);
    setError(null);
    setFacebookPrompt(null);
    if (trimmed === '') {
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    const timer = setTimeout(() => {
      apiClient
        .post('/accounts/preview', { link: trimmed, platform })
        .then((res) => {
          if (cancelled) return;
          if (res.data.platform !== platform) setError(`Это ссылка не на ${network.name}`);
          else setPreview(res.data);
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
  }, [value, platform, network.name]);

  async function connectFacebook() {
    setConnecting(true);
    try {
      const { data } = await apiClient.get('/instagram/discovery/connect');
      // Full-page navigation: the login is outside the SPA; the callback returns to /projects?add=project.
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Не удалось начать подключение');
      setConnecting(false);
    }
  }

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{network.name}</label>
      <input id={id} className={styles.input} placeholder={network.example} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} />
      <p className={styles.example}>Например: {network.example}</p>
      {resolving && <p className={styles.resolving}>Проверяем…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {facebookPrompt && (
        <div className={styles.facebookPrompt}>
          <p className={styles.helperText}>
            {facebookPrompt === 'connect'
              ? 'Чтобы добавлять аккаунты Instagram по ссылке, один раз подключите Facebook — страницу, к которой привязан ваш профессиональный аккаунт Instagram.'
              : 'Доступ к Facebook истёк — переподключите его, чтобы добавлять аккаунты Instagram по ссылке.'}
          </p>
          <button type="button" className={styles.connectButton} onClick={connectFacebook} disabled={connecting}>
            {connecting ? 'Переходим…' : facebookPrompt === 'connect' ? 'Подключить Facebook' : 'Переподключить Facebook'}
          </button>
        </div>
      )}
      {preview && (
        <div className={styles.preview}>
          {preview.avatarDataUri ? (
            <img className={styles.avatar} src={preview.avatarDataUri} alt="" />
          ) : (
            <div className={styles.avatarFallback} aria-hidden="true" />
          )}
          <div className={styles.previewText}>
            <div className={styles.previewName}>
              <PlatformIcon platform={preview.platform} />
              {preview.name}
            </div>
            <div className={styles.previewFollowers}>
              <span className={styles.previewCount}>{formatCount(preview.followersCount)}</span> подписчиков
            </div>
            {preview.alreadyAdded && <p className={styles.duplicate}>Этот аккаунт уже добавлен</p>}
            {preview.previouslyAdded && <p className={styles.hint}>Аккаунт добавлялся раньше — собранная статистика вернётся</p>}
          </div>
        </div>
      )}
    </div>
  );
}
