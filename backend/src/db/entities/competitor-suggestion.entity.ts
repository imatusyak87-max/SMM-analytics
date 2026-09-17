import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('competitor_suggestions')
@Unique(['runId', 'externalId'])
@Index(['accountId'])
export class CompetitorSuggestion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') runId: string;
  @Column('uuid') accountId: string;
  /** Lowercased handle without '@', matching Account.externalId. */
  @Column({ type: 'varchar', length: 64 }) externalId: string;
  @Column({ type: 'varchar', length: 256 }) name: string;
  @Column({ type: 'int' }) followersCount: number;
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'smallint' }) fit: number;
  @Column({ type: 'float' }) score: number;
  @Column({ type: 'smallint' }) rank: number;
  @CreateDateColumn() createdAt: Date;
}
