import { SyncController } from './sync.controller';

describe('SyncController', () => {
  it('triggerManualSync delegates to SyncJobService.createManual', async () => {
    const job = { id: 'job-1' };
    const syncJobService = { createManual: jest.fn().mockResolvedValue(job), findById: jest.fn() } as any;
    const controller = new SyncController(syncJobService);

    const result = await controller.triggerManualSync('acc-1');

    expect(syncJobService.createManual).toHaveBeenCalledWith('acc-1');
    expect(result).toBe(job);
  });

  it('getStatus delegates to SyncJobService.findById', async () => {
    const job = { id: 'job-1', status: 'running' };
    const syncJobService = { createManual: jest.fn(), findById: jest.fn().mockResolvedValue(job) } as any;
    const controller = new SyncController(syncJobService);

    const result = await controller.getStatus('job-1');

    expect(syncJobService.findById).toHaveBeenCalledWith('job-1');
    expect(result).toBe(job);
  });
});
