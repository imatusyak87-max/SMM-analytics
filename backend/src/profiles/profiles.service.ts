import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountPlatform } from '../db/entities/account.entity';
import { Profile } from '../db/entities/profile.entity';
import { AccountsService } from '../accounts/accounts.service';
import { StatsService } from '../stats/stats.service';
import {
  createProfile,
  requireProfile,
  PROFILE_NOT_FOUND,
} from './profile-store';
import { ProfileSummary, toProfileSummary } from './profile-summary';
import type { MoveAccountDto } from './dto/move-account.dto';
import type { CreateProjectDto } from './dto/create-project.dto';

const EMPTY_NAME = 'Название проекта не может быть пустым';
const ACCOUNT_NOT_FOUND = 'Аккаунт не найден';
const RETRY = 'Не удалось проверить, попробуйте ещё раз';
// The networks the form can add today, in display order.
const LINK_PLATFORMS = [AccountPlatform.INSTAGRAM, AccountPlatform.TELEGRAM] as const;

export interface CreatedProject {
  profile: Profile;
  added: Account[];
  failed: Array<{ platform: AccountPlatform; message: string }>;
}

function failureMessage(error: unknown): string {
  if (!(error instanceof HttpException)) return RETRY;
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: string | string[] }).message;
  return Array.isArray(message) ? message.join(', ') : (message ?? RETRY);
}

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    @InjectRepository(Profile) private profilesRepo: Repository<Profile>,
    @InjectRepository(Account) private accountsRepo: Repository<Account>,
    private stats: StatsService,
    private accounts: AccountsService,
  ) {}

  async list(): Promise<ProfileSummary[]> {
    const [profiles, items] = await Promise.all([
      this.profilesRepo.find({ order: { createdAt: 'ASC' } }),
      this.stats.getOverview(),
    ]);
    // Empty projects are listed too: a project lives until it is deleted.
    return profiles.map((profile) =>
      toProfileSummary(
        profile,
        items.filter((item) => item.account.profileId === profile.id),
      ),
    );
  }

  /** Creates the project, then adds each link it can; a link that fails never undoes the project. */
  async create(dto: CreateProjectDto): Promise<CreatedProject> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException(EMPTY_NAME);
    const profile = await this.profilesRepo.save({ name });

    const added: Account[] = [];
    const failed: CreatedProject['failed'] = [];
    for (const platform of LINK_PLATFORMS) {
      const link = dto.links?.[platform]?.trim();
      if (!link) continue;
      try {
        added.push(await this.accounts.createFromLink(link, profile.id, platform));
      } catch (error) {
        if (!(error instanceof HttpException))
          this.logger.warn(`Could not add ${platform} ${link}: ${(error as Error).message}`);
        failed.push({ platform, message: failureMessage(error) });
      }
    }
    return { profile, added, failed };
  }

  async addAccount(id: string, link: string, platform?: AccountPlatform): Promise<Account> {
    await this.findOne(id);
    return this.accounts.createFromLink(link, id, platform);
  }

  /** Deletes the project and, through the normal account delete, all its data. */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const accounts = await this.accountsRepo.find({ where: { profileId: id } });
    for (const account of accounts) await this.accounts.remove(account.id);
    await this.profilesRepo.delete({ id });
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
      await em.update(Account, { id: accountId }, { profileId: destination });
      return { profileId: destination };
    });
  }

  private async findOne(id: string): Promise<Profile> {
    const profile = await this.profilesRepo.findOneBy({ id });
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
  }
}
