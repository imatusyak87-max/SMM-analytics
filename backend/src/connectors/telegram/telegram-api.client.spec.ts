import axios from 'axios';
import { TelegramApiClient } from './telegram-api.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramApiClient', () => {
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

  it('throws when the Bot API returns ok: false', async () => {
    mockedAxios.get.mockResolvedValue({ data: { ok: false, description: 'Forbidden: bot is not a member' } });
    const client = new TelegramApiClient('fake-token');

    await expect(client.getChatMemberCount('@testchannel')).rejects.toThrow('Forbidden: bot is not a member');
  });
});
