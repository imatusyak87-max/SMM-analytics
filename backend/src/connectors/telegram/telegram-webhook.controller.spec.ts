import { TelegramWebhookController } from './telegram-webhook.controller';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

describe('TelegramWebhookController', () => {
  it('upserts a post derived from a channel_post update', async () => {
    const account = { id: 'acc-1', externalId: '@testchannel', platform: AccountPlatform.TELEGRAM, type: AccountType.OWN };
    const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(account) } as any;
    const postsRepo = { upsert: jest.fn() } as any;
    const controller = new TelegramWebhookController(accountsRepo, postsRepo);

    await controller.handleUpdate('acc-1', {
      channel_post: { message_id: 42, date: 1755000000, text: 'Hello world' },
    });

    expect(postsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', externalPostId: '42', caption: 'Hello world' }),
      ['accountId', 'externalPostId'],
    );
  });

  it('does nothing when the update has no channel_post', async () => {
    const accountsRepo = { findOneBy: jest.fn() } as any;
    const postsRepo = { upsert: jest.fn() } as any;
    const controller = new TelegramWebhookController(accountsRepo, postsRepo);

    await controller.handleUpdate('acc-1', { message: { message_id: 1 } });

    expect(postsRepo.upsert).not.toHaveBeenCalled();
  });
});
