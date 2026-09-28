import { MigrationInterface, QueryRunner } from 'typeorm';

/** Progress of «Загрузить все посты», one row per account. */
export class AddHistoryLoads1789600000000 implements MigrationInterface {
  name = 'AddHistoryLoads1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "history_loads_status_enum" AS ENUM('queued', 'running', 'paused', 'done', 'failed')`,
    );
    await queryRunner.query(`CREATE TYPE "history_loads_phase_enum" AS ENUM('posts', 'insights')`);
    await queryRunner.query(
      `CREATE TYPE "history_loads_pausereason_enum" AS ENUM('instagram_rate_limit', 'telegram_rate_limit', 'network')`,
    );
    await queryRunner.query(`
      CREATE TABLE "history_loads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "accountId" uuid NOT NULL,
        "status" "history_loads_status_enum" NOT NULL,
        "phase" "history_loads_phase_enum" NOT NULL DEFAULT 'posts',
        "cursor" text,
        "postsLoaded" integer NOT NULL DEFAULT 0,
        "oldestPostAt" TIMESTAMP WITH TIME ZONE,
        "insightsDone" integer NOT NULL DEFAULT 0,
        "insightsTotal" integer NOT NULL DEFAULT 0,
        "pausedUntil" TIMESTAMP WITH TIME ZONE,
        "pauseReason" "history_loads_pausereason_enum",
        "errorMessage" text,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_history_loads" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_history_loads_account" UNIQUE ("accountId")
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "history_loads"`);
    await queryRunner.query(`DROP TYPE "history_loads_pausereason_enum"`);
    await queryRunner.query(`DROP TYPE "history_loads_phase_enum"`);
    await queryRunner.query(`DROP TYPE "history_loads_status_enum"`);
  }
}
