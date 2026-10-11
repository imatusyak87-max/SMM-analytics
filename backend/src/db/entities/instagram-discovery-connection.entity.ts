import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * The app-wide Facebook Login that Business Discovery lookups run through —
 * always a single row (id = 1), because accounts are shared, not per user.
 * igUserId is the user's own Instagram business account: lookups are made as it.
 */
@Entity('instagram_discovery_connection')
export class InstagramDiscoveryConnection {
  @PrimaryColumn('int') id: number;
  @Column({ type: 'text' }) igUserId: string;
  @Column({ type: 'text' }) igUsername: string;
  @Column({ type: 'text' }) encryptedToken: string;
  @Column({ nullable: true, type: 'timestamptz' }) tokenExpiresAt: Date | null;
  /** Set only on an auth failure; cleared by the next successful Facebook login. */
  @Column({ default: false }) needsReconnect: boolean;
  @Column({ type: 'timestamptz' }) connectedAt: Date;
}
