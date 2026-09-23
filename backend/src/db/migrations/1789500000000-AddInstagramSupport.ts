import { MigrationInterface, QueryRunner } from 'typeorm';

/** Instagram OAuth support: a reconnect flag on credentials, and a table for in-flight logins. */
export class AddInstagramSupport1789500000000 implements MigrationInterface {
  name = 'AddInstagramSupport1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "account_credentials" ADD "needsReconnect" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE TYPE "instagram_oauth_states_type_enum" AS ENUM('own', 'client')`,
    );
    await queryRunner.query(`
      CREATE TABLE "instagram_oauth_states" (
        "id" uuid NOT NULL,
        "type" "instagram_oauth_states_type_enum" NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_instagram_oauth_states" PRIMARY KEY ("id")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "instagram_oauth_states"`);
    await queryRunner.query(`DROP TYPE "instagram_oauth_states_type_enum"`);
    await queryRunner.query(`ALTER TABLE "account_credentials" DROP COLUMN "needsReconnect"`);
  }
}
