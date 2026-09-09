import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the constraint that stops the same account being added twice.
 *
 * Handles are case-insensitive on the platforms this app supports, and
 * parseAccountLink now lowercases them, so existing rows are normalised first —
 * otherwise "@Channel" and "@channel" would survive as separate accounts that the
 * constraint could not see as duplicates.
 *
 * If the table still holds genuine duplicates the ADD CONSTRAINT fails and the
 * whole migration rolls back, leaving the schema untouched. Resolve them with:
 *   SELECT platform, lower("externalId"), count(*), array_agg(id)
 *   FROM accounts GROUP BY 1, 2 HAVING count(*) > 1;
 */
export class UniqueAccountPlatformExternalId1788951100000 implements MigrationInterface {
  name = 'UniqueAccountPlatformExternalId1788951100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "accounts" SET "externalId" = lower("externalId") WHERE "externalId" <> lower("externalId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "UQ_accounts_platform_externalId" UNIQUE ("platform", "externalId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "accounts" DROP CONSTRAINT "UQ_accounts_platform_externalId"`,
    );
  }
}
