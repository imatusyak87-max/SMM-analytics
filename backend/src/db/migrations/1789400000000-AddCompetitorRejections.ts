import { MigrationInterface, QueryRunner } from 'typeorm';

/** Channels the user marked «Не конкурент», per analysed account. */
export class AddCompetitorRejections1789400000000 implements MigrationInterface {
  name = 'AddCompetitorRejections1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "competitor_rejections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountId" uuid NOT NULL,
        "externalId" character varying(64) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitor_rejections" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_competitor_rejections_account_handle" UNIQUE ("accountId", "externalId")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "competitor_rejections"`);
  }
}
