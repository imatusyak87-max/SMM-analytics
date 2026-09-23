import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum InstagramAccountKind {
  OWN = 'own',
  CLIENT = 'client',
}

/**
 * A one-time correlator for one in-flight Instagram login. Stored in
 * Postgres, not Redis: Redis has no persistent volume in this deployment
 * (see competitor_runs' stale-run handling), and losing an in-flight
 * login on a restart is an acceptable, low-stakes failure the user just
 * retries — but it should not depend on Redis staying up for correctness
 * either way. The row is consumed (read + deleted) exactly once, by the
 * OAuth callback.
 */
@Entity('instagram_oauth_states')
export class InstagramOauthState {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'enum', enum: InstagramAccountKind }) type: InstagramAccountKind;
  @CreateDateColumn() createdAt: Date;
}
