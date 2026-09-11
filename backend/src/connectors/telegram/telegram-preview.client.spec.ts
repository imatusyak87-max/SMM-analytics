import axios from 'axios';
import { TelegramPreviewClient } from './telegram-preview.client';

jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

describe('TelegramPreviewClient', () => {
  beforeEach(() => mockedGet.mockReset());

  it('fetches the channel preview page', async () => {
    mockedGet.mockResolvedValue({ data: '<html>page</html>' });

    const html = await new TelegramPreviewClient().fetchPage('testchannel');

    expect(html).toBe('<html>page</html>');
    expect(mockedGet).toHaveBeenCalledWith(
      'https://t.me/s/testchannel',
      expect.anything(),
    );
  });

  it('strips a leading @ from the handle', async () => {
    mockedGet.mockResolvedValue({ data: '' });
    await new TelegramPreviewClient().fetchPage('@testchannel');
    expect(mockedGet).toHaveBeenCalledWith(
      'https://t.me/s/testchannel',
      expect.anything(),
    );
  });

  it('asks for older posts with the before parameter', async () => {
    mockedGet.mockResolvedValue({ data: '' });
    await new TelegramPreviewClient().fetchPage('testchannel', '101');
    expect(mockedGet).toHaveBeenCalledWith(
      'https://t.me/s/testchannel?before=101',
      expect.anything(),
    );
  });
});
