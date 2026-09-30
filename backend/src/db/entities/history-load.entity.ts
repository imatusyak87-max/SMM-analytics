import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

export enum HistoryLoadStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  PAUSED = 'paused',
  DONE = 'done',
  FAILED = 'failed',
}

export enum HistoryLoadPhase {
  POSTS = 'posts',
  /** Instagram only: reach/shares for posts older than the nightly window. */
  INSIGHTS = 'insights',
}

export enum HistoryPauseReason {
  INSTAGRAM_RATE_LIMIT = 'instagram_rate_limit',
  TELEGRAM_RATE_LIMIT = 'telegram_rate_limit',
  NETWORK = 'network',
}

/**
 * Progress of an account's full-history load. One row per account, reused
 * each time the user presses «Загрузить все посты».
 */
@Entity('history_loads')
@Unique('UQ_history_loads_account', ['accountId'])
export class HistoryLoad {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column({ type: 'enum', enum: HistoryLoadStatus }) status: HistoryLoadStatus;
  @Column({ type: 'enum', enum: HistoryLoadPhase, default: HistoryLoadPhase.POSTS }) phase: HistoryLoadPhase;
  /** Where the current phase stopped; the format belongs to whoever reads it (connector or post store). */
  @Column({ nullable: true, type: 'text' }) cursor: string | null;
  @Column({ type: 'int', default: 0 }) postsLoaded: number;
  @Column({ nullable: true, type: 'timestamptz' }) oldestPostAt: Date | null;
  @Column({ type: 'int', default: 0 }) insightsDone: number;
  @Column({ type: 'int', default: 0 }) insightsTotal: number;
  @Column({ nullable: true, type: 'timestamptz' }) pausedUntil: Date | null;
  @Column({ nullable: true, type: 'enum', enum: HistoryPauseReason }) pauseReason: HistoryPauseReason | null;
  @Column({ nullable: true, type: 'text' }) errorMessage: string | null;
  @Column({ nullable: true, type: 'timestamptz' }) startedAt: Date | null;
  @Column({ nullable: true, type: 'timestamptz' }) finishedAt: Date | null;
}
