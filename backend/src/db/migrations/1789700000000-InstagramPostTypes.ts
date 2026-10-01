import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Instagram posts are now «Пост», «Рилс» or «Каруселька»: single photos and
 * ordinary feed videos, stored until now as image/video, become plain posts.
 */
export class InstagramPostTypes1789700000000 implements MigrationInterface {
  name = 'InstagramPostTypes1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "posts" p SET "type" = 'post'
      FROM "accounts" a
      WHERE a."id" = p."accountId" AND a."platform" = 'instagram' AND p."type" IN ('image', 'video')`);
  }

  public async down(): Promise<void> {
    // Which of these posts were photos and which videos is not recorded; the
    // next sync or history load would have to re-derive it. Nothing to undo here.
  }
}
