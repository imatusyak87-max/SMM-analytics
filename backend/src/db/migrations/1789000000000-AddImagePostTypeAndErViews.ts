import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the post type used for photo posts, and the second ER figure.
 *
 * Telegram posts are typed by their media: a photo post is IMAGE whether it
 * carries one photo or an album. `er` keeps its meaning (engagement against
 * followers); `erViews` is engagement against actual reach, which is the more
 * meaningful figure on Telegram, where a post reaches a fraction of subscribers.
 *
 * ADD VALUE cannot run inside a transaction block in older Postgres, so it is
 * issued before the column change and never bundled with data migration.
 */
export class AddImagePostTypeAndErViews1789000000000 implements MigrationInterface {
  name = 'AddImagePostTypeAndErViews1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "posts_type_enum" ADD VALUE IF NOT EXISTS 'image'`);
    await queryRunner.query(`ALTER TABLE "posts" ADD COLUMN "erViews" double precision`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "posts" DROP COLUMN "erViews"`);
    // Postgres cannot drop a value from an enum type; 'image' is left in place.
  }
}
