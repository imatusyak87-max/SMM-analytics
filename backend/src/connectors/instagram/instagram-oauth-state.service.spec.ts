import { LessThan } from 'typeorm';
import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';

const STATE_ID = '3f2b9c1e-8a4d-4f6b-9e2a-1c5d7e9f0a1b';

/**
 * consume() runs one `DELETE ... WHERE id = :id RETURNING type, createdAt`
 * through the query builder; `returned` is the rows that statement yields.
 */
function makeRepo(returned: Array<Record<string, unknown>> = []) {
  const qb: Record<string, jest.Mock> = {};
  qb.delete = jest.fn(() => qb);
  qb.from = jest.fn(() => qb);
  qb.where = jest.fn(() => qb);
  qb.returning = jest.fn(() => qb);
  qb.execute = jest.fn().mockResolvedValue({ raw: returned, affected: returned.length });
  const repo = {
    save: jest.fn((row) => row),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => qb),
  } as any;
  return { repo, qb };
}

describe('InstagramOauthStateService', () => {
  it('creates a state row carrying the requested type and returns its id', async () => {
    const { repo } = makeRepo();
    const service = new InstagramOauthStateService(repo);

    const id = await service.create(InstagramAccountKind.OWN);

    expect(typeof id).toBe('string');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id, type: InstagramAccountKind.OWN }));
  });

  it('consumes a fresh state atomically (delete-returning) and returns its type', async () => {
    const { repo, qb } = makeRepo([{ type: InstagramAccountKind.CLIENT, createdAt: new Date() }]);
    const service = new InstagramOauthStateService(repo);

    const type = await service.consume(STATE_ID);

    expect(type).toBe(InstagramAccountKind.CLIENT);
    expect(qb.delete).toHaveBeenCalled();
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: STATE_ID });
    expect(qb.returning).toHaveBeenCalled();
    // No separate read-then-delete: two parallel callbacks can't both see the row.
    expect(repo.findOneBy).not.toHaveBeenCalled();
  });

  it('returns null for an id that does not exist (nothing deleted)', async () => {
    const { repo } = makeRepo([]);
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume(STATE_ID)).toBeNull();
  });

  it('returns null for a state older than 10 minutes (the row is still gone)', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000);
    const { repo, qb } = makeRepo([{ type: InstagramAccountKind.OWN, createdAt: old }]);
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume(STATE_ID)).toBeNull();
    expect(qb.execute).toHaveBeenCalled();
  });

  it('returns null without touching the database when the state is missing', async () => {
    const { repo } = makeRepo([{ type: InstagramAccountKind.OWN, createdAt: new Date() }]);
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume(undefined as any)).toBeNull();
    expect(await service.consume('')).toBeNull();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    expect(repo.findOneBy).not.toHaveBeenCalled();
  });

  it('returns null without touching the database when the state is not a UUID', async () => {
    const { repo } = makeRepo([{ type: InstagramAccountKind.OWN, createdAt: new Date() }]);
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume('not-a-uuid')).toBeNull();
    expect(await service.consume(['a', 'b'] as any)).toBeNull();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    expect(repo.findOneBy).not.toHaveBeenCalled();
  });

  it('purges abandoned states older than the 10-minute TTL', async () => {
    const { repo } = makeRepo();
    const service = new InstagramOauthStateService(repo);
    const before = Date.now();

    await service.purgeExpired();

    expect(repo.delete).toHaveBeenCalledWith({ createdAt: expect.any(LessThan(new Date()).constructor) });
    const cutoff: Date = repo.delete.mock.calls[0][0].createdAt.value;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - 10 * 60 * 1000 + 1000);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 10 * 60 * 1000 - 1000);
  });
});
