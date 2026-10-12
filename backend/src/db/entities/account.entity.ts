import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Profile } from './profile.entity';

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
// The same channel must not be addable twice. Handles are normalised to lowercase
// in parseAccountLink so that case variants compare equal here.
@Unique(['platform', 'externalId'])
export class Account {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'enum', enum: AccountPlatform }) platform: AccountPlatform;
  @Column() externalId: string;
  @Column() name: string;
  @Column({ nullable: true, type: 'text' }) avatarUrl: string | null;
  @Column({ type: 'enum', enum: AccountType }) type: AccountType;
  @Column({ default: true }) isActive: boolean;
  @Index() @Column('uuid') profileId: string;
  @ManyToOne(() => Profile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'profileId' })
  profile?: Profile;
  @CreateDateColumn() createdAt: Date;
}
