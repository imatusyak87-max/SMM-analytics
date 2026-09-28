import { HistoryProcessor } from './history.processor';

describe('HistoryProcessor', () => {
  it('queues the next slice with the delay the runner asks for', async () => {
    const runner = { runSlice: jest.fn().mockResolvedValue(300_000) };
    const loads = { enqueue: jest.fn() };
    const processor = new HistoryProcessor(runner as any, loads as any);

    await processor.process({ data: { accountId: 'acc-1' } } as any);

    expect(runner.runSlice).toHaveBeenCalledWith('acc-1');
    expect(loads.enqueue).toHaveBeenCalledWith('acc-1', 300_000);
  });

  it('stops when the runner says there is nothing more to do', async () => {
    const runner = { runSlice: jest.fn().mockResolvedValue(null) };
    const loads = { enqueue: jest.fn() };

    await new HistoryProcessor(runner as any, loads as any).process({ data: { accountId: 'acc-1' } } as any);

    expect(loads.enqueue).not.toHaveBeenCalled();
  });
});
