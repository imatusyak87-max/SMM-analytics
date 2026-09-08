import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum AccountPlatform {
  TELEGRAM = 'telegram',
  INSTAGRAM = 'instagram',
  VK = 'vk',
  YOUTUBE = 'youtube',
  LINKEDIN = 'linkedin',
}

export enum AccountType {
  OWN = 'own',
  CLIENT = 'client',
  PUBLIC_NO_ACCESS = 'public_no_access',
}

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'enum', enum: AccountPlatform }) platform: AccountPlatform;
  @Column() externalId: string;
  @Column() name: string;
  @Column({ nullable: true, type: 'text' }) avatarUrl: string | null;
  @Column({ type: 'enum', enum: AccountType }) type: AccountType;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}
