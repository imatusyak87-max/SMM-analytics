import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum CompetitorRunTrigger {
  ACCOUNT_ADDED = 'account_added',
  MANUAL = 'manual',
}

export enum CompetitorRunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('competitor_runs')
export class CompetitorRun {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'enum', enum: CompetitorRunTrigger }) trigger: CompetitorRunTrigger;
  @Column({ type: 'enum', enum: CompetitorRunStatus, default: CompetitorRunStatus.PENDING })
  status: CompetitorRunStatus;
  @Column({ nullable: true, type: 'text' }) niche: string | null;
  @Column({ type: 'varchar', length: 32 }) llmProvider: string;
  @Column({ type: 'varchar', length: 64 }) llmModel: string;
  @Column({ nullable: true, type: 'int' }) inputTokens: number | null;
  @Column({ nullable: true, type: 'int' }) outputTokens: number | null;
  /** Always 0 on the Gemini free tier; present so a Claude switch shows spend without a migration. */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 }) costUsd: string;
  @Column({ type: 'int', default: 0 }) candidatesProposed: number;
  @Column({ type: 'int', default: 0 }) candidatesVerified: number;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) startedAt: Date | null;
  @Column({ nullable: true, type: 'timestamptz' }) finishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}
