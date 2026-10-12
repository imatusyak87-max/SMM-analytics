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
