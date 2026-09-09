import axios from 'axios';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Reads Telegram's public channel preview. This is the only source that exposes
 * view counts and reactions — the Bot API exposes neither — and it needs no
 * credentials, which is what makes competitor channels readable at all.
 */
export class TelegramPreviewClient {
  async fetchPage(channel: string, before?: string): Promise<string> {
    const handle = channel.replace(/^@/, '');
    const url = `https://t.me/s/${handle}${before ? `?before=${before}` : ''}`;

    const { data } = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; smm-dashboard/1.0)' },
    });
    return data as string;
  }
}
