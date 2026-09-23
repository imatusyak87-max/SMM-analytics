import { InstagramOauthStateService } from './instagram-oauth-state.service';
import { InstagramAccountKind } from '../../db/entities/instagram-oauth-state.entity';

function makeRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    save: jest.fn((row) => row),
    findOneBy: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  } as any;
}

describe('InstagramOauthStateService', () => {
  it('creates a state row carrying the requested type and returns its id', async () => {
    const repo = makeRepo();
    const service = new InstagramOauthStateService(repo);

    const id = await service.create(InstagramAccountKind.OWN);

    expect(typeof id).toBe('string');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id, type: InstagramAccountKind.OWN }));
  });

  it('consumes a fresh state and returns its type, then deletes it', async () => {
    const createdAt = new Date();
    const repo = makeRepo({
      findOneBy: jest.fn().mockResolvedValue({ id: 'state-1', type: InstagramAccountKind.CLIENT, createdAt }),
    });
    const service = new InstagramOauthStateService(repo);

    const type = await service.consume('state-1');

    expect(type).toBe(InstagramAccountKind.CLIENT);
    expect(repo.delete).toHaveBeenCalledWith({ id: 'state-1' });
  });

  it('returns null for an id that does not exist', async () => {
    const repo = makeRepo({ findOneBy: jest.fn().mockResolvedValue(null) });
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume('missing')).toBeNull();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('returns null and still deletes a state older than 10 minutes', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000);
    const repo = makeRepo({
      findOneBy: jest.fn().mockResolvedValue({ id: 'state-2', type: InstagramAccountKind.OWN, createdAt: old }),
    });
    const service = new InstagramOauthStateService(repo);

    expect(await service.consume('state-2')).toBeNull();
    expect(repo.delete).toHaveBeenCalledWith({ id: 'state-2' });
  });
});
