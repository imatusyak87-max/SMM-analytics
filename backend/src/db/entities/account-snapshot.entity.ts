import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

@Entity('account_snapshots')
@Unique(['accountId', 'date'])
export class AccountSnapshot {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'date' }) date: string;
  @Column('int') followersCount: number;
  @Column('int', { nullable: true }) followingCount: number | null;
  @Column('int') postsCount: number;
  @Column('float', { nullable: true }) avgReach: number | null;
  @Column('float', { nullable: true }) avgEr: number | null;
}
