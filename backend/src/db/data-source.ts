import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Account } from './entities/account.entity';
import { AccountCredential } from './entities/account-credential.entity';
import { AccountSnapshot } from './entities/account-snapshot.entity';
import { InstagramOauthState } from './entities/instagram-oauth-state.entity';
import { Post } from './entities/post.entity';
import { SyncJob } from './entities/sync-job.entity';
import { HistoryLoad } from './entities/history-load.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Account, AccountCredential, AccountSnapshot, InstagramOauthState, Post, SyncJob, HistoryLoad],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
