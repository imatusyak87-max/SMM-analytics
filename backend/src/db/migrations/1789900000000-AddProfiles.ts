import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profiles group a brand's accounts across networks. Each existing account gets
 * a profile of its own, reusing the account's id and name so the backfill
 * needs no mapping table; the user merges them afterwards.
 */
export class AddProfiles1789900000000 implements MigrationInterface {
  name = 'AddProfiles1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_profiles" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`ALTER TABLE "accounts" ADD "profileId" uuid`);
    await queryRunner.query(
      `INSERT INTO "profiles" ("id", "name", "createdAt") SELECT "id", "name", "createdAt" FROM "accounts"`,
    );
    await queryRunner.query(`UPDATE "accounts" SET "profileId" = "id"`);
    await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "profileId" SET NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_accounts_profileId" ON "accounts" ("profileId")`);
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "FK_accounts_profile" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_accounts_profile"`);
    await queryRunner.query(`DROP INDEX "IDX_accounts_profileId"`);
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN "profileId"`);
    await queryRunner.query(`DROP TABLE "profiles"`);
  }
}
