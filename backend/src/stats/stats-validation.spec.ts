import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * These go through the real ValidationPipe: the bug was that the controller took
 * raw query strings, so bad input reached the service and became a 500 instead of
 * a 400. Asserting on a stubbed service alone would not prove the pipe rejects.
 */
describe('Stats query validation', () => {
  let app: INestApplication;
  const statsService = {
    getOverview: jest.fn().mockResolvedValue([]),
    getAccountDetail: jest.fn().mockResolvedValue({}),
    getTopPosts: jest.fn().mockResolvedValue([]),
    compare: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StatsController],
      providers: [{ provide: StatsService, useValue: statsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('rejects a compare request with no accountIds as a 400, not a 500', async () => {
    await request(app.getHttpServer())
      .get('/stats/compare')
      .query({ from: '2026-08-01', to: '2026-08-13' })
      .expect(400);

    expect(statsService.compare).not.toHaveBeenCalled();
  });

  it('still splits comma-separated accountIds on a valid compare request', async () => {
    await request(app.getHttpServer())
      .get('/stats/compare')
      .query({ accountIds: 'acc-1,acc-2', from: '2026-08-01', to: '2026-08-13' })
      .expect(200);

    expect(statsService.compare).toHaveBeenCalledWith(['acc-1', 'acc-2'], {
      from: '2026-08-01',
      to: '2026-08-13',
    });
  });

  it('rejects a detail request with a missing date range', async () => {
    await request(app.getHttpServer()).get('/accounts/acc-1/detail').expect(400);

    expect(statsService.getAccountDetail).not.toHaveBeenCalled();
  });

  it('rejects a detail request whose date is not a date', async () => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/detail')
      .query({ from: 'not-a-date', to: '2026-08-13' })
      .expect(400);
  });

  it('rejects a non-numeric top-posts limit instead of silently returning nothing', async () => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/top-posts')
      .query({ from: '2026-08-01', to: '2026-08-13', limit: 'abc' })
      .expect(400);
  });

  it('defaults the top-posts limit to 10 when it is not given', async () => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/top-posts')
      .query({ from: '2026-08-01', to: '2026-08-13' })
      .expect(200);

    expect(statsService.getTopPosts).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ from: '2026-08-01', to: '2026-08-13' }),
      10,
    );
  });
});
