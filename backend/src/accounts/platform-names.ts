import { AccountPlatform } from '../db/entities/account.entity';

/** How each network is named in Russian UI text. */
export const PLATFORM_NAMES: Record<AccountPlatform, string> = {
  [AccountPlatform.INSTAGRAM]: 'Instagram',
  [AccountPlatform.TELEGRAM]: 'Telegram',
  [AccountPlatform.VK]: 'ВКонтакте',
  [AccountPlatform.YOUTUBE]: 'YouTube',
  [AccountPlatform.LINKEDIN]: 'LinkedIn',
};
