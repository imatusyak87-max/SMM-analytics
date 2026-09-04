import axios from 'axios';

export class TelegramApiClient {
  private baseUrl: string;

  constructor(private botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  private async call<T>(method: string, params: Record<string, string>): Promise<T> {
    const { data } = await axios.get(`${this.baseUrl}/${method}`, { params });
    if (!data.ok) throw new Error(data.description ?? `Telegram API call to ${method} failed`);
    return data.result as T;
  }

  async downloadFile(fileId: string): Promise<{ data: Buffer; contentType: string }> {
    const { file_path } = await this.call<{ file_path: string }>('getFile', { file_id: fileId });
    const response = await axios.get(`https://api.telegram.org/file/bot${this.botToken}/${file_path}`, {
      responseType: 'arraybuffer',
    });
    return {
      data: Buffer.from(response.data as ArrayBuffer),
      contentType: (response.headers?.['content-type'] as string) ?? 'image/jpeg',
    };
  }

  async getChatMemberCount(chatId: string): Promise<number> {
    return this.call<number>('getChatMemberCount', { chat_id: chatId });
  }

  async getChat(chatId: string): Promise<{ title: string; photoUrl: string | null }> {
    const result = await this.call<{ title: string; photo?: { big_file_id: string } }>('getChat', {
      chat_id: chatId,
    });
    return { title: result.title, photoUrl: result.photo ? result.photo.big_file_id : null };
  }
}
