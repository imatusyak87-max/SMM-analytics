import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { CompetitorRunService } from './competitor-run.service';
import { CompetitorRunStatus, CompetitorRunTrigger } from '../db/entities/competitor-run.entity';

function makeService(overrides: { runs?: any; queue?: any; enabled?: boolean } = {}) {
  const runsRepo = overrides.runs ?? {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((x) => x),
    save: jest.fn().mockImplementation((x) => Promise.resolve({ id: 'run-1', ...x })),
  };
  const queue = overrides.queue ?? { add: jest.fn() };
  const service = new CompetitorRunService(runsRepo, queue, {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    enabled: overrides.enabled ?? true,
  });
  return { service, runsRepo, queue };
}

describe('CompetitorRunService', () => {
  it('createManual saves a pending run and enqueues it', async () => {
    const { service, runsRepo, queue } = makeService();

    const run = await service.createManual('acc-1');

    expect(runsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        trigger: CompetitorRunTrigger.MANUAL,
        status: CompetitorRunStatus.PENDING,
        llmProvider: 'gemini',
        llmModel: 'gemini-2.5-flash',
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'find-competitors',
      { runId: 'run-1', accountId: 'acc-1' },
      expect.objectContaining({ attempts: 2, backoff: { type: 'exponential', delay: 60000 } }),
    );
    expect(run.id).toBe('run-1');
  });

  it('refuses a second run while one is pending or running', async () => {
    const { service } = makeService({
      runs: {
        findOne: jest.fn().mockResolvedValue({ id: 'run-0', status: CompetitorRunStatus.RUNNING }),
        count: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      },
    });

    await expect(service.createManual('acc-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to run when no provider key is configured', async () => {
    const { service } = makeService({ enabled: false });

    await expect(service.createManual('acc-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('createForNewAccount enqueues for a fresh account', async () => {
    const { service, runsRepo, queue } = makeService();

    const run = await service.createForNewAccount('acc-1');

    expect(runsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        trigger: CompetitorRunTrigger.ACCOUNT_ADDED,
        status: CompetitorRunStatus.PENDING,
        llmProvider: 'gemini',
        llmModel: 'gemini-2.5-flash',
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'find-competitors',
      { runId: 'run-1', accountId: 'acc-1' },
      expect.objectContaining({ attempts: 2, backoff: { type: 'exponential', delay: 60000 } }),
    );
    expect(run.id).toBe('run-1');
  });

  it('createForNewAccount does not enqueue when the account already has a run', async () => {
    const { service, queue } = makeService({
      runs: {
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn((x) => x),
        save: jest.fn(),
      },
    });

    const result = await service.createForNewAccount('acc-1');

    expect(result).toBeNull();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('createForNewAccount stays silent when the feature is disabled', async () => {
    const { service, queue } = makeService({ enabled: false });

    await expect(service.createForNewAccount('acc-1')).resolves.toBeNull();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
