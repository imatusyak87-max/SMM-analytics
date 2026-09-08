import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../../db/entities/account.entity';
import { Post as PostEntity } from '../../db/entities/post.entity';
import { mapTelegramMessageToPost } from './telegram-post-mapper';
import { TelegramWebhookGuard } from './telegram-webhook.guard';

interface TelegramChat {
  id?: number;
  username?: string;
}

/** Accounts are stored either as @username or as a numeric chat id; an update must match one. */
function chatBelongsToAccount(chat: TelegramChat | undefined, externalId: string): boolean {
  if (!chat) return false;

  const expected = externalId.replace(/^@/, '').toLowerCase();
  if (chat.username && chat.username.toLowerCase() === expected) return true;
  return chat.id !== undefined && String(chat.id) === expected;
}

@UseGuards(TelegramWebhookGuard)
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(PostEntity) private postsRepo: Repository<PostEntity>,
  ) {}

  @Post(':accountId')
  async handleUpdate(
    @Param('accountId') accountId: string,
    @Body() update: { channel_post?: any },
  ) {
    if (!update.channel_post) return;

    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) return;

    // The shared secret proves the sender is Telegram, not that this update belongs
    // to this account — a valid update for one channel must not be written to another.
    if (!chatBelongsToAccount(update.channel_post.chat, account.externalId)) return;

    const mapped = mapTelegramMessageToPost(update.channel_post, account.externalId);
    await this.postsRepo.upsert(
      { accountId, ...mapped, lastSyncedAt: new Date() },
      ['accountId', 'externalPostId'],
    );
  }
}
