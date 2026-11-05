import { MigrationInterface, QueryRunner } from 'typeorm';

/** «Удалить проект» hides the project so its accounts' statistics survive. */
export class AddProfileIsActive1790100000000 implements MigrationInterface {
  name = 'AddProfileIsActive1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" ADD "isActive" boolean NOT NULL DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "isActive"`);
  }
}
