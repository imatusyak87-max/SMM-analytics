import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountType } from '../db/entities/account.entity';
import { ConnectorRegistry } from '../connectors/connector-registry.service';
import { AccountInfo, SocialConnector } from '../connectors/connector.interface';
import { CreateAccountDto } from './dto/create-account.dto';
import { parseAccountLink } from './parse-account-link';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account) private repo: Repository<Account>,
    private registry: ConnectorRegistry,
  ) {}

  create(dto: CreateAccountDto) {
    return this.repo.save(this.repo.create({ ...dto, avatarUrl: dto.avatarUrl ?? null, isActive: true }));
  }

  async createFromLink(link: string) {
    const parsed = parseAccountLink(link);
    if (!parsed) {
      throw new BadRequestException(
        'Unsupported link. Paste a Telegram, Instagram, VK, YouTube or LinkedIn account URL.',
      );
    }

    let connector: SocialConnector;
    try {
      connector = this.registry.get(parsed.platform);
    } catch {
      throw new BadRequestException(`${parsed.platform} is not supported yet.`);
    }

    let info: AccountInfo;
    try {
      info = await connector.getAccountInfo(parsed as Account);
    } catch {
      throw new BadRequestException(
        "Couldn't find that account — check the link.",
      );
    }

    return this.repo.save(
      this.repo.create({
        platform: parsed.platform,
        externalId: parsed.externalId,
        name: info.name,
        avatarUrl: info.avatarUrl,
        type: AccountType.PUBLIC_NO_ACCESS,
        isActive: true,
      }),
    );
  }

  findAll() {
    return this.repo.find({ where: { isActive: true } });
  }

  async findOne(id: string) {
    const account = await this.repo.findOneBy({ id });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  async deactivate(id: string) {
    await this.findOne(id);
    await this.repo.update(id, { isActive: false });
  }
}
