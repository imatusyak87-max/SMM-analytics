import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('account_credentials')
export class AccountCredential {
  @PrimaryColumn('uuid') accountId: string;
  @Column({ type: 'text' }) encryptedToken: string;
  @Column({ nullable: true, type: 'timestamptz' }) tokenExpiresAt: Date | null;
  @Column({ nullable: true, type: 'text' }) refreshToken: string | null;
}
