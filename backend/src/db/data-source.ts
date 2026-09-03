import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Account } from './entities/account.entity';
import { AccountCredential } from './entities/account-credential.entity';
import { AccountSnapshot } from './entities/account-snapshot.entity';
import { Post } from './entities/post.entity';
import { SyncJob } from './entities/sync-job.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Account, AccountCredential, AccountSnapshot, Post, SyncJob],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
