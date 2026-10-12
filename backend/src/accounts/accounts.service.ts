import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountPlatform, AccountType } from '../db/entities/account.entity';
import { AccountCredential } from '../db/entities/account-credential.entity';
import { AccountSnapshot } from '../db/entities/account-snapshot.entity';
import { Post } from '../db/entities/post.entity';
import { SyncJob } from '../db/entities/sync-job.entity';
import { CompetitorRun } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { CompetitorRejection } from '../db/entities/competitor-rejection.entity';
import { HistoryLoad } from '../db/entities/history-load.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { AccountInfo, AccountStats, AvatarImage, SocialConnector } from '../connectors/connector.interface';
import { createProfile, deleteProfileIfEmpty, requireProfile, PROFILE_NOT_FOUND } from '../profiles/profile-store';
import { SyncJobService } from '../sync/sync-job.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { ParsedAccountLink, isInstagramLink, parseAccountLink } from './parse-account-link';
import {
  InstagramDiscoveryUnavailableError,
  InstagramProfileNotFoundError,
} from '../connectors/instagram/instagram-discovery.errors';

const ALREADY_ADDED = 'Этот аккаунт уже добавлен';
const INSTAGRAM_NOT_A_PROFILE = 'Вставьте ссылку на профиль Instagram, а не на пост';
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(Account) private repo: Repository<Account>,
    private registry: ConnectorRegistry,
    private syncJobs: SyncJobService,
  ) {}

  async preview(link: string) {
    const { parsed, connector } = this.resolveLink(link);
    const draft = this.draftOf(parsed);

    let info: AccountInfo;
    let stats: AccountStats;
    try {
      [info, stats] = await Promise.all([connector.getAccountInfo(draft), connector.getAccountStats(draft)]);
    } catch (error) {
      throw this.unresolvable(parsed.platform, parsed.externalId, error as Error);
    }

    // The avatar is decorative: a channel that resolved should still be previewable
    // and addable when only its picture fails to download.
    let avatarDataUri: string | null = null;
    if (info.avatarUrl) {
      try {
        const avatar = await connector.getAvatar(info.avatarUrl);
        avatarDataUri = `data:${avatar.contentType};base64,${avatar.data.toString('base64')}`;
      } catch (error) {
        this.logger.warn(
          `Could not download avatar for ${parsed.platform} ${parsed.externalId}: ${(error as Error).message}`,
        );
      }
    }

    return {
      platform: parsed.platform,
      externalId: parsed.externalId,
      name: info.name,
      followersCount: stats.followersCount,
      avatarDataUri,
      // Lets the add dialog say so before the user clicks; the 409 on create is
      // still what enforces it.
      alreadyAdded: (await this.findExisting(parsed)) !== null || (await this.matchesConnectedAccount(parsed.platform, info)),
    };
  }

  async getAvatar(id: string): Promise<AvatarImage> {
    const account = await this.findOne(id);
    if (!account.avatarUrl) throw new NotFoundException(`Account ${id} has no avatar`);
    return this.registry.get(account.platform).getAvatar(account.avatarUrl);
  }

  create(dto: CreateAccountDto) {
    return this.repo.manager.transaction(async (em) => {
      const profile = await createProfile(em, dto.name);
      return em.save(Account, { ...dto, avatarUrl: dto.avatarUrl ?? null, isActive: true, profileId: profile.id });
    });
  }

  async createFromLink(link: string, profileId?: string) {
    const { parsed, connector } = this.resolveLink(link);

    if (await this.findExisting(parsed)) throw new ConflictException(ALREADY_ADDED);

    // Checked before the platform call so a stale choice fails fast and cheaply.
    if (profileId) await requireProfile(this.repo.manager, profileId);

    let info: AccountInfo;
    try {
      info = await connector.getAccountInfo(this.draftOf(parsed));
    } catch (error) {
      throw this.unresolvable(parsed.platform, parsed.externalId, error as Error);
    }

    if (await this.matchesConnectedAccount(parsed.platform, info)) throw new ConflictException(ALREADY_ADDED);

    let account: Account;
    try {
      account = await this.repo.manager.transaction(async (em) => {
        const targetProfileId = profileId ?? (await createProfile(em, info.name)).id;
        return em.save(Account, {
          platform: parsed.platform,
          externalId: parsed.externalId,
          name: info.name,
          avatarUrl: info.avatarUrl,
          type: AccountType.PUBLIC_NO_ACCESS,
          isActive: true,
          profileId: targetProfileId,
        });
      });
    } catch (error) {
      // Two adds can race past the check above; the unique index is what actually
      // stops the second one, and it should read as the same conflict to the user.
      if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(ALREADY_ADDED);
      }
      if ((error as { code?: string }).code === PG_FOREIGN_KEY_VIOLATION) {
        throw new NotFoundException(PROFILE_NOT_FOUND);
      }
      throw error;
    }

    await this.syncJobs.createManual(account.id);
    return account;
  }

  private findExisting(parsed: ParsedAccountLink): Promise<Account | null> {
    return this.repo.findOneBy({ platform: parsed.platform, externalId: parsed.externalId });
  }

  // Every account added by link is a competitor; the connector reads the type
  // to pick its access path (Instagram competitors go through Business Discovery).
  private draftOf(parsed: ParsedAccountLink): Account {
    return { platform: parsed.platform, externalId: parsed.externalId, type: AccountType.PUBLIC_NO_ACCESS } as Account;
  }

  /** An Instagram competitor lookup can reveal the user's own connected account under its numeric id. */
  private async matchesConnectedAccount(platform: AccountPlatform, info: AccountInfo): Promise<boolean> {
    if (!info.platformUserId) return false;
    return (await this.repo.findOneBy({ platform, externalId: info.platformUserId })) !== null;
  }

  private resolveLink(link: string): { parsed: ParsedAccountLink; connector: SocialConnector } {
    const parsed = parseAccountLink(link);
    if (!parsed) {
      if (isInstagramLink(link)) throw new BadRequestException(INSTAGRAM_NOT_A_PROFILE);
      throw new BadRequestException(
        'Unsupported link. Paste a Telegram, Instagram, VK, YouTube or LinkedIn account URL.',
      );
    }

    try {
      return { parsed, connector: this.registry.get(parsed.platform) };
    } catch {
      throw new BadRequestException(`${parsed.platform} is not supported yet.`);
    }
  }

  private unresolvable(platform: string, externalId: string, error: Error): BadRequestException {
    if (error instanceof InstagramDiscoveryUnavailableError) {
      const code = error.reason === 'not_connected' ? 'instagram_discovery_not_connected' : 'instagram_discovery_reconnect';
      return new BadRequestException({ message: error.message, code });
    }
    if (error instanceof InstagramProfileNotFoundError) return new BadRequestException(error.message);
    this.logger.warn(`Could not resolve ${platform} account ${externalId}: ${error.message}`);
    return new BadRequestException(`Couldn't add that account — ${platform} said: ${error.message}`);
  }

  findAll() {
    return this.repo.find({ where: { isActive: true } });
  }

  async findOne(id: string) {
    const account = await this.repo.findOneBy({ id });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  async remove(id: string) {
    const account = await this.findOne(id);
    await this.repo.manager.transaction(async (em) => {
      await em.delete(CompetitorRejection, { accountId: id });
      await em.delete(CompetitorSuggestion, { accountId: id });
      await em.delete(CompetitorRun, { accountId: id });
      await em.delete(Post, { accountId: id });
      await em.delete(AccountSnapshot, { accountId: id });
      await em.delete(SyncJob, { accountId: id });
      await em.delete(AccountCredential, { accountId: id });
      await em.delete(HistoryLoad, { accountId: id });
      await em.delete(Account, { id });
      await deleteProfileIfEmpty(em, account.profileId);
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    await this.repo.update(id, { isActive: false });
  }
}
