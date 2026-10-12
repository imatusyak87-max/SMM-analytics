import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { StatsService } from '../stats/stats.service';
import {
  createProfile,
  deleteProfileIfEmpty,
  requireProfile,
  PROFILE_NOT_FOUND,
} from './profile-store';
import { ProfileSummary, toProfileSummary } from './profile-summary';
import type { MoveAccountDto } from './dto/move-account.dto';

const EMPTY_NAME = 'Название профиля не может быть пустым';
const ACCOUNT_NOT_FOUND = 'Аккаунт не найден';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile) private profilesRepo: Repository<Profile>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    private stats: StatsService,
  ) {}

  async list(): Promise<ProfileSummary[]> {
    const [profiles, items] = await Promise.all([
      this.profilesRepo.find({ order: { createdAt: 'ASC' } }),
      this.stats.getOverview(),
    ]);
    // A profile whose accounts are all deactivated has nothing to show.
    return profiles
      .map((profile) =>
        toProfileSummary(
          profile,
          items.filter((item) => item.account.profileId === profile.id),
        ),
      )
      .filter((summary) => summary.accounts.length > 0);
  }

  async get(id: string): Promise<ProfileSummary> {
    const profile = await this.findOne(id);
    return toProfileSummary(profile, await this.stats.getOverview(id));
  }

  async rename(id: string, name: string): Promise<Profile> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException(EMPTY_NAME);
    const profile = await this.findOne(id);
    profile.name = trimmed;
    return this.profilesRepo.save(profile);
  }

  async moveAccount(
    accountId: string,
    target: MoveAccountDto,
  ): Promise<{ profileId: string }> {
    const hasId = typeof target.profileId === 'string';
    const wantsNew = target.newProfile === true;
    if (hasId === wantsNew)
      throw new BadRequestException('Укажите либо profileId, либо newProfile');

    return this.accountsRepo.manager.transaction(async (em) => {
      const account = await em.findOneBy(Account, { id: accountId });
      if (!account) throw new NotFoundException(ACCOUNT_NOT_FOUND);
      if (hasId && target.profileId === account.profileId)
        return { profileId: account.profileId };

      const destination = hasId
        ? (await requireProfile(em, target.profileId!)).id
        : (await createProfile(em, account.name)).id;
      const left = account.profileId;
      await em.update(Account, { id: accountId }, { profileId: destination });
      await deleteProfileIfEmpty(em, left);
      return { profileId: destination };
    });
  }

  private async findOne(id: string): Promise<Profile> {
    const profile = await this.profilesRepo.findOneBy({ id });
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
  }
}
