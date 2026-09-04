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

export interface ParsedAccountLink {
  platform: AccountPlatform;
  externalId: string;
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

  const segment = url.pathname.split('/').filter(Boolean).pop();
  if (!segment) return null;

  return { platform, externalId: `@${segment.replace(/^@/, '')}` };
}
