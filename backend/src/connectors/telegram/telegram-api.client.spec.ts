import axios from 'axios';
import { TelegramApiClient } from './telegram-api.client';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

describe('TelegramApiClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getChatMemberCount returns the member count from the Bot API response', async () => {
    mockedGet.mockResolvedValue({ data: { ok: true, result: 1234 } });
    const client = new TelegramApiClient('fake-token');

    const count = await client.getChatMemberCount('@testchannel');

    expect(count).toBe(1234);
    expect(mockedGet).toHaveBeenCalledWith(
      'https://api.telegram.org/botfake-token/getChatMemberCount',
      { params: { chat_id: '@testchannel' } },
    );
  });

  it('returns the channel description alongside the title', async () => {
    mockedGet.mockResolvedValue({
      data: {
        ok: true,
        result: { type: 'channel', title: 'Канал', description: 'Про маркетинг', photo: { big_file_id: 'f1' } },
      },
    } as any);

    const result = await new TelegramApiClient('token').getChat('@channel');

    expect(result).toEqual({ type: 'channel', title: 'Канал', description: 'Про маркетинг', photoUrl: 'f1' });
  });

  it('returns null when the channel has no description', async () => {
    mockedGet.mockResolvedValue({ data: { ok: true, result: { type: 'channel', title: 'Канал' } } } as any);

    const result = await new TelegramApiClient('token').getChat('@channel');

    expect(result).toEqual({ type: 'channel', title: 'Канал', description: null, photoUrl: null });
  });

  it('downloadFile resolves the file path then fetches the bytes', async () => {
    mockedGet
      .mockResolvedValueOnce({ data: { ok: true, result: { file_path: 'photos/file_1.jpg' } } })
      .mockResolvedValueOnce({ data: Buffer.from('image-bytes'), headers: { 'content-type': 'image/jpeg' } });
    const client = new TelegramApiClient('fake-token');

    const file = await client.downloadFile('abc');

    expect(mockedGet).toHaveBeenNthCalledWith(1, 'https://api.telegram.org/botfake-token/getFile', {
      params: { file_id: 'abc' },
    });
    expect(mockedGet).toHaveBeenNthCalledWith(
      2,
      'https://api.telegram.org/file/botfake-token/photos/file_1.jpg',
      { responseType: 'arraybuffer' },
    );
    expect(file.contentType).toBe('image/jpeg');
    expect(Buffer.from(file.data).toString()).toBe('image-bytes');
  });

  it('throws when the Bot API returns ok: false', async () => {
    mockedGet.mockResolvedValue({ data: { ok: false, description: 'Forbidden: bot is not a member' } });
    const client = new TelegramApiClient('fake-token');

    await expect(client.getChatMemberCount('@testchannel')).rejects.toThrow('Forbidden: bot is not a member');
  });
});
