import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookGuard } from './telegram-webhook.guard';
import { AccountPlatform, AccountType } from '../../db/entities/account.entity';

const account = {
  id: 'acc-1',
  externalId: '@testchannel',
  platform: AccountPlatform.TELEGRAM,
  type: AccountType.OWN,
};

function build(found: unknown = account) {
  const accountsRepo = { findOneBy: jest.fn().mockResolvedValue(found) } as any;
  const postsRepo = { upsert: jest.fn() } as any;
  return { controller: new TelegramWebhookController(accountsRepo, postsRepo), postsRepo, accountsRepo };
}

describe('TelegramWebhookController', () => {
  it('is protected by the webhook secret guard', () => {
    const guards = new Reflector().get(GUARDS_METADATA, TelegramWebhookController) ?? [];

    expect(guards).toContain(TelegramWebhookGuard);
  });

  it('upserts a post derived from a channel_post update', async () => {
    const { controller, postsRepo } = build();

    await controller.handleUpdate('acc-1', {
      channel_post: {
        message_id: 42,
        date: 1755000000,
        text: 'Hello world',
        chat: { id: 100, username: 'testchannel' },
      },
    });

    expect(postsRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', externalPostId: '42', caption: 'Hello world' }),
      ['accountId', 'externalPostId'],
    );
  });

  it('does nothing when the update has no channel_post', async () => {
    const { controller, postsRepo } = build();

    await controller.handleUpdate('acc-1', { message: { message_id: 1 } });

    expect(postsRepo.upsert).not.toHaveBeenCalled();
  });

  it('ignores an update whose chat is a different channel than the account', async () => {
    const { controller, postsRepo } = build();

    await controller.handleUpdate('acc-1', {
      channel_post: {
        message_id: 42,
        date: 1755000000,
        text: 'Injected',
        chat: { id: 999, username: 'someoneelse' },
      },
    });

    expect(postsRepo.upsert).not.toHaveBeenCalled();
  });

  it('ignores an update carrying no chat, which cannot be attributed to the account', async () => {
    const { controller, postsRepo } = build();

    await controller.handleUpdate('acc-1', {
      channel_post: { message_id: 42, date: 1755000000, text: 'Unattributable' },
    });

    expect(postsRepo.upsert).not.toHaveBeenCalled();
  });

  it('accepts a chat identified by numeric id for an account stored by id', async () => {
    const { controller, postsRepo } = build({ ...account, externalId: '-1001234567890' });

    await controller.handleUpdate('acc-1', {
      channel_post: {
        message_id: 7,
        date: 1755000000,
        text: 'By id',
        chat: { id: -1001234567890 },
      },
    });

    expect(postsRepo.upsert).toHaveBeenCalled();
  });

  it('does nothing when the account does not exist', async () => {
    const { controller, postsRepo } = build(null);

    await controller.handleUpdate('missing', {
      channel_post: { message_id: 1, date: 1755000000, chat: { username: 'testchannel' } },
    });

    expect(postsRepo.upsert).not.toHaveBeenCalled();
  });
});
