import { Body, Controller, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../../db/entities/account.entity';
import { Post as PostEntity } from '../../db/entities/post.entity';
import { mapTelegramMessageToPost } from './telegram-post-mapper';

@Controller('webhooks/telegram')
export class TelegramWebhookController {
  constructor(
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    @InjectRepository(PostEntity) private postsRepo: Repository<PostEntity>,
  ) {}

  @Post(':accountId')
  async handleUpdate(@Param('accountId') accountId: string, @Body() update: { channel_post?: any }) {
    if (!update.channel_post) return;

    const account = await this.accountsRepo.findOneBy({ id: accountId });
    if (!account) return;

    const mapped = mapTelegramMessageToPost(update.channel_post, account.externalId);
    await this.postsRepo.upsert(
      { accountId, ...mapped, lastSyncedAt: new Date() },
      ['accountId', 'externalPostId'],
    );
  }
}
