import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

/**
 * A suggestion the user marked «Не конкурент» for one of their channels. It is
 * per channel on purpose: the same handle can be a real competitor of another.
 */
@Entity('competitor_rejections')
@Unique(['accountId', 'externalId'])
export class CompetitorRejection {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  /** Lowercased handle WITHOUT '@', the same form competitor_suggestions stores. */
  @Column({ type: 'varchar', length: 64 }) externalId: string;
  @CreateDateColumn() createdAt: Date;
}
