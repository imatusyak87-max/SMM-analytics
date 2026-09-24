import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { AccountCredential } from '../db/entities/account-credential.entity';
import { ConnectorsModule } from '../connectors/connectors.module';
import { InstagramModule } from '../connectors/instagram/instagram.module';
import { InstagramOauthController } from '../connectors/instagram/instagram-oauth.controller';
import { SyncModule } from '../sync/sync.module';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountCredential]), ConnectorsModule, InstagramModule, SyncModule],
  providers: [AccountsService],
  // InstagramOauthController is Instagram code, hosted here for SyncJobService.
  controllers: [AccountsController, InstagramOauthController],
  exports: [AccountsService],
})
export class AccountsModule {}
