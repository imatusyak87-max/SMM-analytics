import axios from 'axios';
import { TelegramApiClient } from './telegram-api.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramApiClient', () => {
  beforeEach(() => mockedAxios.get.mockReset());

  it('getChatMemberCount returns the member count from the Bot API response', async () => {
    mockedAxios.get.mockResolvedValue({ data: { ok: true, result: 1234 } });
    const client = new TelegramApiClient('fake-token');

    const count = await client.getChatMemberCount('@testchannel');

    expect(count).toBe(1234);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.telegram.org/botfake-token/getChatMemberCount',
      { params: { chat_id: '@testchannel' } },
    );
  });

  it('getChat returns title and photo url when present', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { ok: true, result: { title: 'Test Channel', photo: { big_file_id: 'abc' } } },
    });
    const client = new TelegramApiClient('fake-token');

    const chat = await client.getChat('@testchannel');

    expect(chat.title).toBe('Test Channel');
  });

  it('downloadFile resolves the file path then fetches the bytes', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { ok: true, result: { file_path: 'photos/file_1.jpg' } } })
      .mockResolvedValueOnce({ data: Buffer.from('image-bytes'), headers: { 'content-type': 'image/jpeg' } });
    const client = new TelegramApiClient('fake-token');

    const file = await client.downloadFile('abc');

    expect(mockedAxios.get).toHaveBeenNthCalledWith(1, 'https://api.telegram.org/botfake-token/getFile', {
      params: { file_id: 'abc' },
    });
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.telegram.org/file/botfake-token/photos/file_1.jpg',
      { responseType: 'arraybuffer' },
    );
    expect(file.contentType).toBe('image/jpeg');
    expect(Buffer.from(file.data).toString()).toBe('image-bytes');
  });

  it('throws when the Bot API returns ok: false', async () => {
    mockedAxios.get.mockResolvedValue({ data: { ok: false, description: 'Forbidden: bot is not a member' } });
    const client = new TelegramApiClient('fake-token');

    await expect(client.getChatMemberCount('@testchannel')).rejects.toThrow('Forbidden: bot is not a member');
  });
});
