/** One presentation, not one file. Technical events cannot renew its budget. */
export class SceneLease {
  private lastAt: number;
  private suspended = false;
  private elapsed = 0;
  private budget: number;
  private recoveryUsed = false;
  private position = 0;
  private revision = 0;
  private pauseRemaining: number | null = null;
  expired = false;

  constructor(readonly id: string, readonly durationSeconds: number, readonly video: boolean, now: number) {
    this.lastAt = now;
    this.budget = durationSeconds * 1000 + (video ? 20_000 : 1_000);
  }
  update(now: number, suspended = this.suspended): void {
    const delta = Math.max(0, now - this.lastAt);
    if (!this.suspended) {
      if (this.pauseRemaining === null) this.elapsed += delta;
      else this.pauseRemaining -= delta;
    }
    this.lastAt = now;
    this.suspended = suspended;
  }
  pause(now: number, seconds: number): void {
    this.update(now);
    if (this.pauseRemaining === null) this.pauseRemaining = seconds * 1000;
  }
  play(now: number): void { this.update(now); this.pauseRemaining = null; }
  progress(position: number): void { if (Number.isFinite(position)) this.position = position; }
  seek(now: number, target: number): void {
    this.update(now);
    this.budget += (this.position - target) * 1000;
    this.position = target;
    this.revision++;
  }
  restartPhoto(now: number, seconds: number): void {
    if (this.video) return;
    this.update(now);
    this.budget = this.elapsed + seconds * 1000 + 1000;
    this.revision++;
  }
  takeRecovery(): boolean {
    if (this.recoveryUsed || this.expired) return false;
    this.recoveryUsed = true;
    return true;
  }
  snapshot(now: number) {
    this.update(now);
    return { id: this.id, revision: this.revision, elapsedMs: this.elapsed,
      budgetMs: Math.max(0, this.budget), suspended: this.suspended,
      pauseRemainingMs: this.pauseRemaining === null ? null : Math.max(0, this.pauseRemaining), expired: this.expired };
  }
  due(now: number): boolean {
    this.update(now);
    return !this.suspended && (this.expired ||
      (this.pauseRemaining !== null ? this.pauseRemaining <= 0 : this.elapsed >= this.budget));
  }
}
