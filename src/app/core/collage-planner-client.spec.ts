import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollagePlannerClient } from './collage-planner-client';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; });
describe('collage worker lifecycle', () => {
  it('correlates responses, rejects parallel jobs, terminates on timeout and can recover', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
    const client = new CollagePlannerClient();
    const first = client.run({ kind: 'refine', scenes: [], fit: 'contain' });
    await expect(client.run({ kind: 'refine', scenes: [], fit: 'contain' })).rejects.toThrow('planner-busy');
    const worker = FakeWorker.instances[0];
    worker.onmessage!({ data: { id: 999, scenes: [] } });
    const rejection = expect(first).rejects.toThrow('planner-timeout');
    await vi.advanceTimersByTimeAsync(15_000); await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const second = client.run({ kind: 'refine', scenes: [], fit: 'contain' });
    const next = FakeWorker.instances[1]; const id = next.postMessage.mock.calls[0][0].id;
    // Old worker's late reply must not settle the new pending request.
    worker.onmessage!({ data: { id: 1, scenes: ['stale'], elapsedMs: 1 } });
    next.onmessage!({ data: { id, scenes: [], elapsedMs: 2 } });
    await expect(second).resolves.toMatchObject({ scenes: [], elapsedMs: 2 });
    client.cancel();
  });
  it('cancellation rejects and terminates actual work', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new CollagePlannerClient();
    const pending = client.run({ kind: 'refine', scenes: [], fit: 'contain' });
    client.cancel(); await expect(pending).rejects.toThrow('planner-cancelled');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
