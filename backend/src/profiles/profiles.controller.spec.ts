import { ProfilesController } from './profiles.controller';

describe('ProfilesController', () => {
  function build() {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({}),
      rename: jest.fn().mockResolvedValue({}),
      moveAccount: jest.fn().mockResolvedValue({ profileId: 'p1' }),
    } as any;
    return { controller: new ProfilesController(service), service };
  }

  it('creates a project from a name and links', async () => {
    const service = { create: jest.fn().mockResolvedValue({ profile: { id: 'p1' }, added: [], failed: [] }) } as any;
    const dto = { name: 'Pheromone', links: { telegram: 'https://t.me/abcde' } };
    await new ProfilesController(service).create(dto as any);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('adds an account to a project', async () => {
    const service = { addAccount: jest.fn().mockResolvedValue({ id: 'a1' }) } as any;
    await new ProfilesController(service).addAccount('p1', { link: 'https://t.me/abcde' } as any);
    expect(service.addAccount).toHaveBeenCalledWith('p1', 'https://t.me/abcde');
  });

  it('deletes a project', async () => {
    const service = { remove: jest.fn().mockResolvedValue(undefined) } as any;
    await new ProfilesController(service).remove('p1');
    expect(service.remove).toHaveBeenCalledWith('p1');
  });

  it('lists profiles', async () => {
    const { controller, service } = build();
    await controller.list();
    expect(service.list).toHaveBeenCalled();
  });

  it('gets one profile', async () => {
    const { controller, service } = build();
    await controller.get('p1');
    expect(service.get).toHaveBeenCalledWith('p1');
  });

  it('renames a profile', async () => {
    const { controller, service } = build();
    await controller.rename('p1', { name: 'New' });
    expect(service.rename).toHaveBeenCalledWith('p1', 'New');
  });

  it('moves an account', async () => {
    const { controller, service } = build();
    const result = await controller.moveAccount('a1', { newProfile: true });
    expect(service.moveAccount).toHaveBeenCalledWith('a1', {
      newProfile: true,
    });
    expect(result).toEqual({ profileId: 'p1' });
  });
});
