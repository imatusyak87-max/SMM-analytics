import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tables behind competitor discovery: one row per search, plus its verified suggestions. */
export class AddCompetitorTables1789300000000 implements MigrationInterface {
  name = 'AddCompetitorTables1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "competitor_runs_trigger_enum" AS ENUM('account_added', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TYPE "competitor_runs_status_enum" AS ENUM('pending', 'running', 'success', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "competitor_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountId" uuid NOT NULL,
        "trigger" "competitor_runs_trigger_enum" NOT NULL,
        "status" "competitor_runs_status_enum" NOT NULL DEFAULT 'pending',
        "niche" text,
        "llmProvider" character varying(32) NOT NULL,
        "llmModel" character varying(64) NOT NULL,
        "inputTokens" integer,
        "outputTokens" integer,
        "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "candidatesProposed" integer NOT NULL DEFAULT 0,
        "candidatesVerified" integer NOT NULL DEFAULT 0,
        "errorMessage" text,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitor_runs" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_competitor_runs_account" ON "competitor_runs" ("accountId", "createdAt")`,
    );
    await queryRunner.query(`
      CREATE TABLE "competitor_suggestions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "accountId" uuid NOT NULL,
        "externalId" character varying(64) NOT NULL,
        "name" character varying(256) NOT NULL,
        "followersCount" integer NOT NULL,
        "reason" text NOT NULL,
        "fit" smallint NOT NULL,
        "score" double precision NOT NULL,
        "rank" smallint NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitor_suggestions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_competitor_suggestions_run_handle" UNIQUE ("runId", "externalId"),
        CONSTRAINT "FK_competitor_suggestions_run" FOREIGN KEY ("runId")
          REFERENCES "competitor_runs"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_competitor_suggestions_account" ON "competitor_suggestions" ("accountId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "competitor_suggestions"`);
    await queryRunner.query(`DROP TABLE "competitor_runs"`);
    await queryRunner.query(`DROP TYPE "competitor_runs_status_enum"`);
    await queryRunner.query(`DROP TYPE "competitor_runs_trigger_enum"`);
  }
}
