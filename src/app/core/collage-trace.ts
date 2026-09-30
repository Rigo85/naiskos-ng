export interface CollageTraceEvent {
  type: 'viewer.collage';
  id: string; sessionId: string; buildId: string; at: string; sequence: number;
  action: string;
  details: Record<string, string | number | boolean | string[]>;
}

const KEY = 'naiskos.collage-trace.v1';
export function collageStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
/** Bounded local delivery queue. Stable UUIDs make retries idempotent centrally. */
export class CollageTrace {
  private queue: CollageTraceEvent[] = [];
  private sequence = 0;
  private sending = false;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;

  constructor(private readonly send: (event: CollageTraceEvent) => Promise<unknown>,
    private readonly sessionId: string, private readonly buildId: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = null) {
    try {
      const raw = storage?.getItem(KEY);
      const saved = raw && raw.length < 1_000_000 ? JSON.parse(raw) : [];
      if (Array.isArray(saved)) this.queue = saved.filter((e) => e?.type === 'viewer.collage' &&
        typeof e.id === 'string' && typeof e.action === 'string' && typeof e.details === 'object').slice(-128);
    } catch { /* Diagnostics must never prevent playback. */ }
  }

  emit(action: string, details: CollageTraceEvent['details'] = {}): void {
    if (this.stopped) return;
    const event: CollageTraceEvent = { type: 'viewer.collage', id: crypto.randomUUID(),
      sessionId: this.sessionId, buildId: this.buildId, at: new Date().toISOString(),
      sequence: ++this.sequence, action, details };
    if (this.queue.length >= 128) {
      this.queue.splice(1, this.queue.length - 126); // Never remove the in-flight head.
      event.details = { ...details, deliveryOverflow: true };
    }
    this.queue.push(event); this.save(); void this.flush();
  }

  private save(): void { try { this.storage?.setItem(KEY, JSON.stringify(this.queue)); } catch { /* best effort */ } }
  private async flush(): Promise<void> {
    if (this.sending || this.stopped || this.timer) return;
    this.sending = true;
    try {
      while (this.queue.length && !this.stopped) {
        try { await this.send(this.queue[0]); }
        catch (error) {
          // Corrupt/obsolete diagnostics must not block the queue forever.
          // Network errors, 403 and 5xx retain the same UUID for retry.
          if ((error as { status?: number })?.status !== 400) throw error;
        }
        this.queue.shift(); this.failures = 0; this.save();
      }
    } catch {
      if (!this.stopped) this.timer = setTimeout(() => {
        this.timer = undefined; void this.flush();
      }, Math.min(30_000, 1000 * 2 ** Math.min(this.failures++, 5)));
    } finally { this.sending = false; }
  }
  destroy(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.save(); }
}
