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
    getPostsPage: jest.fn().mockResolvedValue({ total: 0, items: [] }),
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

  it('applies the defaults — views, page 1, 10 per page — when the posts query omits them', async () => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/posts')
      .query({ from: '2026-08-01', to: '2026-08-13' })
      .expect(200);

    expect(statsService.getPostsPage).toHaveBeenCalledWith('acc-1', {
      from: '2026-08-01',
      to: '2026-08-13',
      type: undefined,
      sort: 'views',
      page: 1,
      size: 10,
    });
  });

  it('passes a chosen sort, page, size and type through, with page and size as numbers', async () => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/posts')
      .query({ from: '2026-08-01', to: '2026-08-13', sort: 'er', page: '3', size: '25', type: 'video' })
      .expect(200);

    expect(statsService.getPostsPage).toHaveBeenCalledWith('acc-1', {
      from: '2026-08-01',
      to: '2026-08-13',
      type: 'video',
      sort: 'er',
      page: 3,
      size: 25,
    });
  });

  it.each([
    ['a page size that is not one of the options', { size: '7' }],
    ['a page size above the largest option', { size: '500' }],
    ['an unknown sort', { sort: 'foo' }],
    ['page 0', { page: '0' }],
  ])('rejects %s as a 400', async (_label, extra) => {
    await request(app.getHttpServer())
      .get('/accounts/acc-1/posts')
      .query({ from: '2026-08-01', to: '2026-08-13', ...extra })
      .expect(400);

    expect(statsService.getPostsPage).not.toHaveBeenCalled();
  });
});
