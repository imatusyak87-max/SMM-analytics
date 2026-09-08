import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';

describe('AuthService.validateUser', () => {
  it('returns the user when password matches', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const usersRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        id: '1',
        email: 'a@b.com',
        passwordHash,
        name: 'A',
      }),
    } as any;
    const jwtService = { sign: jest.fn() } as any;
    const service = new AuthService(usersRepo, jwtService);

    const result = await service.validateUser('a@b.com', 'correct-horse');
    expect(result?.email).toBe('a@b.com');
  });

  it('returns null when password does not match', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    const usersRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        id: '1',
        email: 'a@b.com',
        passwordHash,
        name: 'A',
      }),
    } as any;
    const jwtService = { sign: jest.fn() } as any;
    const service = new AuthService(usersRepo, jwtService);

    const result = await service.validateUser('a@b.com', 'wrong');
    expect(result).toBeNull();
  });
});
