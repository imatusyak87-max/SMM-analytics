import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { StatsModule } from '../stats/stats.module';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Account]), StatsModule, AccountsModule],
  providers: [ProfilesService],
  controllers: [ProfilesController],
})
export class ProfilesModule {}
