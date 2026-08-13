import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../db/entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(@InjectRepository(Account) private repo: Repository<Account>) {}

  create(dto: CreateAccountDto) {
    return this.repo.save(this.repo.create({ ...dto, avatarUrl: dto.avatarUrl ?? null, isActive: true }));
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
