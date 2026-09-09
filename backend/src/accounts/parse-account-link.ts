import { AccountPlatform } from '../db/entities/account.entity';

const PLATFORM_BY_HOST: Record<string, AccountPlatform> = {
  't.me': AccountPlatform.TELEGRAM,
  'telegram.me': AccountPlatform.TELEGRAM,
  'instagram.com': AccountPlatform.INSTAGRAM,
  'vk.com': AccountPlatform.VK,
  'youtube.com': AccountPlatform.YOUTUBE,
  'youtu.be': AccountPlatform.YOUTUBE,
  'linkedin.com': AccountPlatform.LINKEDIN,
};

// What Telegram itself accepts as a public username.
const TELEGRAM_USERNAME = /^[a-z0-9_]{5,32}$/i;

// t.me paths that look like a username but address something else — an invite,
// a sticker pack, a proxy. Without this list they would become fake accounts.
const TELEGRAM_RESERVED = new Set([
  'joinchat',
  'addstickers',
  'addemoji',
  'addtheme',
  'addlist',
  'proxy',
  'socks',
  'share',
  'setlanguage',
  'confirmphone',
  'login',
  'contact',
  'invoice',
  'giftcode',
]);

export interface ParsedAccountLink {
  platform: AccountPlatform;
  externalId: string;
}

// t.me links come in more shapes than "domain plus handle": a link to a post carries
// the message number after the channel, and the web preview puts /s/ in front of it.
// The channel is always the first segment, not the last.
function telegramHandle(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const [head] = segments[0] === 's' ? segments.slice(1) : segments;
  if (!head) return null;

  const first = head.replace(/^@/, '');
  if (TELEGRAM_RESERVED.has(first.toLowerCase())) return null;
  return TELEGRAM_USERNAME.test(first) ? first.toLowerCase() : null;
}

export function parseAccountLink(link: string): ParsedAccountLink | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const platform = PLATFORM_BY_HOST[host];
  if (!platform) return null;

  if (platform === AccountPlatform.TELEGRAM) {
    const handle = telegramHandle(url.pathname);
    return handle ? { platform, externalId: `@${handle}` } : null;
  }

  // The other platforms have no connector yet, so their links are rejected a step
  // later as unsupported. Their own URL shapes get parsed when a connector lands.
  const segment = url.pathname.split('/').filter(Boolean).pop();
  if (!segment) return null;

  // Handles are case-insensitive on these platforms, so normalise here: the unique
  // constraint on (platform, externalId) can only catch duplicates that compare equal.
  return {
    platform,
    externalId: `@${segment.replace(/^@/, '').toLowerCase()}`,
  };
}
