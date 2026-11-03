import { MigrationInterface, QueryRunner } from 'typeorm';

/** An Instagram login can now target one existing account (upgrade to full access, or reconnect). */
export class AddOauthStateAccount1790000000000 implements MigrationInterface {
  name = 'AddOauthStateAccount1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instagram_oauth_states" ADD "accountId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instagram_oauth_states" DROP COLUMN "accountId"`);
  }
}
