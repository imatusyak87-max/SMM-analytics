import { MigrationInterface, QueryRunner } from 'typeorm';

/** Competitor lookups: the single Facebook connection, and its OAuth state kind. */
export class AddInstagramDiscovery1789800000000 implements MigrationInterface {
  name = 'AddInstagramDiscovery1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Allowed inside the migration transaction on Postgres 12+, as long as the
    // new value is not used in the same transaction — it is not.
    await queryRunner.query(`ALTER TYPE "instagram_oauth_states_type_enum" ADD VALUE IF NOT EXISTS 'discovery'`);
    await queryRunner.query(`
      CREATE TABLE "instagram_discovery_connection" (
        "id" integer NOT NULL,
        "igUserId" text NOT NULL,
        "igUsername" text NOT NULL,
        "encryptedToken" text NOT NULL,
        "tokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "needsReconnect" boolean NOT NULL DEFAULT false,
        "connectedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_instagram_discovery_connection" PRIMARY KEY ("id")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "instagram_discovery_connection"`);
    // Postgres cannot drop an enum value; an unused 'discovery' is harmless.
  }
}
