import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollageTrace, CollageTraceEvent } from './collage-trace';

afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); });
describe('collage diagnostic delivery', () => {
  it('retries with the same UUID, persists until acknowledgement, then drains in order', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const trace = new CollageTrace(send, crypto.randomUUID(), 'test', window.localStorage);
    trace.emit('plan-requested', { round: 1 }); trace.emit('plan-ready', { round: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(window.localStorage.getItem('naiskos.collage-trace.v1')!)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send.mock.calls[1][0].id).toBe(send.mock.calls[0][0].id);
    expect(send.mock.calls[2][0].sequence).toBe(2);
    expect(JSON.parse(window.localStorage.getItem('naiskos.collage-trace.v1')!)).toEqual([]);
    trace.destroy();
  });
  it('keeps a bounded queue, explicitly records overflow and survives restart', async () => {
    vi.useFakeTimers();
    const trace = new CollageTrace(() => Promise.reject(new Error('offline')), crypto.randomUUID(), 'test', window.localStorage);
    for (let i = 0; i < 200; i++) trace.emit('scene-committed', { round: i });
    await vi.advanceTimersByTimeAsync(0); trace.destroy();
    const saved = JSON.parse(window.localStorage.getItem('naiskos.collage-trace.v1')!) as CollageTraceEvent[];
    expect(saved.length).toBeLessThanOrEqual(128);
    expect(saved.some((e) => e.details['deliveryOverflow'] === true)).toBe(true);
    const delivered: CollageTraceEvent[] = [];
    const resumed = new CollageTrace(async (e) => { delivered.push(e); }, crypto.randomUUID(), 'test', window.localStorage);
    resumed.emit('planning-resumed'); await vi.advanceTimersByTimeAsync(0);
    expect(delivered[0].id).toBe(saved[0].id); resumed.destroy();
  });
  it('does not let a rejected old event block later valid events', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce({ status: 400 }).mockResolvedValue({});
    const trace = new CollageTrace(send, crypto.randomUUID(), 'test');
    trace.emit('obsolete-action'); trace.emit('plan-ready'); await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2); trace.destroy();
  });
});
