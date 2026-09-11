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
    return this.get(
      `https://t.me/s/${handle}${before ? `?before=${before}` : ''}`,
    );
  }

  /**
   * One post's embed page. It stays available when a channel disables its web
   * preview, which makes t.me/s/ redirect to a page with no posts.
   */
  async fetchEmbed(channel: string, postId: string): Promise<string> {
    const handle = channel.replace(/^@/, '');
    return this.get(`https://t.me/${handle}/${postId}?embed=1`);
  }

  private async get(url: string): Promise<string> {
    const { data } = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; smm-dashboard/1.0)' },
    });
    return data as string;
  }
}
