import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum SyncTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

export enum SyncStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('sync_jobs')
export class SyncJob {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'enum', enum: SyncTrigger }) trigger: SyncTrigger;
  @Column({ type: 'enum', enum: SyncStatus, default: SyncStatus.PENDING }) status: SyncStatus;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) startedAt: Date | null;
  @Column({ nullable: true, type: 'timestamptz' }) finishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}
