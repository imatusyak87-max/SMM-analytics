import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('account_credentials')
export class AccountCredential {
  @PrimaryColumn('uuid') accountId: string;
  @Column({ type: 'text' }) encryptedToken: string;
  @Column({ nullable: true, type: 'timestamptz' }) tokenExpiresAt: Date | null;
  @Column({ nullable: true, type: 'text' }) refreshToken: string | null;
  /**
   * Set only on an auth-specific failure (invalid/expired/revoked token),
   * never on a rate limit or network error. Cleared the moment the
   * account reconnects or a scheduled refresh succeeds.
   */
  @Column({ default: false }) needsReconnect: boolean;
}
