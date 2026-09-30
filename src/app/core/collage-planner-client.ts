import { MediaScene } from './collage-policy';
import { PlannerJob } from './collage-planner';

/** One bounded worker request at a time. Cancellation terminates computation,
 * not just its callback. There is no expensive main-thread fallback. */
export class CollagePlannerClient {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending: { reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> } | null = null;

  async run(job: PlannerJob, timeoutMs = 15_000): Promise<{ scenes: MediaScene[]; elapsedMs: number }> {
    if (this.pending) throw new Error('planner-busy');
    if (typeof Worker === 'undefined') throw new Error('worker-unavailable');
    const worker = this.worker ??= new Worker(new URL('./collage-planner.worker', import.meta.url), { type: 'module' });
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.cancel('planner-timeout'), timeoutMs);
      this.pending = { reject, timeout };
      worker.onerror = () => { if (this.worker === worker) this.cancel('worker-error'); };
      worker.onmessageerror = () => { if (this.worker === worker) this.cancel('worker-message-error'); };
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker || data?.id !== id || id !== this.nextId || !this.pending) return;
        clearTimeout(timeout);
        this.pending = null;
        if (data.error || !Array.isArray(data.scenes)) reject(new Error('planner-failed'));
        else resolve({ scenes: data.scenes, elapsedMs: data.elapsedMs });
      };
      try { worker.postMessage({ id, job }); }
      catch { this.cancel('worker-post-failed'); }
    });
  }

  cancel(reason = 'planner-cancelled'): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      const { reject } = this.pending;
      this.pending = null;
      reject(new Error(reason));
    }
  }
}
