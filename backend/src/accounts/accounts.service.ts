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
import { Profile } from '../db/entities/profile.entity';
import { Post } from '../db/entities/post.entity';
import { SyncJob } from '../db/entities/sync-job.entity';
import { CompetitorRun } from '../db/entities/competitor-run.entity';
import { CompetitorSuggestion } from '../db/entities/competitor-suggestion.entity';
import { CompetitorRejection } from '../db/entities/competitor-rejection.entity';
import { HistoryLoad } from '../db/entities/history-load.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { AccountInfo, AccountStats, AvatarImage, SocialConnector } from '../connectors/connector.interface';
import { createProfile, requireProfile, PROFILE_NOT_FOUND } from '../profiles/profile-store';
import { isNetworkError } from '../connectors/history-pause.error';
import { SyncJobService } from '../sync/sync-job.service';
import { PLATFORM_NAMES } from './platform-names';
import { CreateAccountDto } from './dto/create-account.dto';
import { ParsedAccountLink, isInstagramLink, parseAccountLink } from './parse-account-link';
import {
  InstagramDiscoveryUnavailableError,
  InstagramProfileNotFoundError,
} from '../connectors/instagram/instagram-discovery.errors';

const ALREADY_ADDED = 'Этот аккаунт уже добавлен';
const INSTAGRAM_NOT_A_PROFILE = 'Вставьте ссылку на профиль Instagram, а не на пост';
const CHANNEL_NOT_FOUND = 'Канал не найден';
const RETRY = 'Не удалось проверить, попробуйте ещё раз';
const CANNOT_VERIFY = 'Не удалось проверить аккаунт';
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

  async createFromLink(link: string, profileId?: string, expected?: AccountPlatform) {
    const parsed = this.parseLink(link);
    // Checked before the connector lookup so a VK link in the Telegram field says "wrong field", not "unsupported".
    if (expected && parsed.platform !== expected) {
      throw new BadRequestException(`Это ссылка не на ${PLATFORM_NAMES[expected]}`);
    }
    const connector = this.connectorFor(parsed);

    const existing = await this.findExisting(parsed);
    if (existing) throw new ConflictException(await this.alreadyAddedMessage(existing));

    if (profileId) {
      // Checked before the platform call so a stale choice fails fast and cheaply.
      await requireProfile(this.repo.manager, profileId);
      // One account per network per project; legacy projects may still hold two.
      if (await this.repo.findOneBy({ profileId, platform: parsed.platform })) {
        throw new ConflictException(`В проекте уже есть ${PLATFORM_NAMES[parsed.platform]}`);
      }
    }

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

  private async alreadyAddedMessage(account: Account): Promise<string> {
    const project = await this.repo.manager.findOneBy(Profile, { id: account.profileId });
    return project ? `Этот аккаунт уже в проекте «${project.name}»` : ALREADY_ADDED;
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
    const parsed = this.parseLink(link);
    return { parsed, connector: this.connectorFor(parsed) };
  }

  private parseLink(link: string): ParsedAccountLink {
    const parsed = parseAccountLink(link);
    if (!parsed) {
      if (isInstagramLink(link)) throw new BadRequestException(INSTAGRAM_NOT_A_PROFILE);
      throw new BadRequestException('Не удалось распознать ссылку. Вставьте ссылку на аккаунт, например https://t.me/channel');
    }
    return parsed;
  }

  private connectorFor(parsed: ParsedAccountLink): SocialConnector {
    try {
      return this.registry.get(parsed.platform);
    } catch {
      throw new BadRequestException(`${PLATFORM_NAMES[parsed.platform]} пока не поддерживается`);
    }
  }

  private unresolvable(platform: string, externalId: string, error: Error): BadRequestException {
    if (error instanceof InstagramDiscoveryUnavailableError) {
      const code = error.reason === 'not_connected' ? 'instagram_discovery_not_connected' : 'instagram_discovery_reconnect';
      return new BadRequestException({ message: error.message, code });
    }
    if (error instanceof InstagramProfileNotFoundError) return new BadRequestException(error.message);
    this.logger.warn(`Could not resolve ${platform} account ${externalId}: ${error.message}`);
    // Provider text is never shown: it is English, and can carry URLs.
    const e = error as { response?: { status?: number; data?: { description?: string } } };
    const status = e.response?.status;
    const description = e.response?.data?.description ?? error.message;
    if (/chat not found/i.test(description)) return new BadRequestException(CHANNEL_NOT_FOUND);
    if (isNetworkError(error) || status === 429 || (status !== undefined && status >= 500)) {
      return new BadRequestException(RETRY);
    }
    return new BadRequestException(CANNOT_VERIFY);
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
    await this.findOne(id);
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
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);
    await this.repo.update(id, { isActive: false });
  }
}
