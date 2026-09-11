import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the post type for Telegram's round video messages («кружочки»), which
 * were stored as plain text posts before.
 *
 * ADD VALUE is the only statement, so the new value is never used in the
 * transaction that added it — which Postgres does not allow, on any version.
 */
export class AddRoundVideoPostType1789100000000 implements MigrationInterface {
  name = 'AddRoundVideoPostType1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "posts_type_enum" ADD VALUE IF NOT EXISTS 'round_video'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a value from an enum type; 'round_video' is left in place.
  }
}
