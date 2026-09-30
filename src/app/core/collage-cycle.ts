import { buildScenes, collageRank, MediaScene, omitSceneItems, SceneCandidate } from './collage-policy';
import { CollagePlannerClient } from './collage-planner-client';
import { hydrateScenes, planningFingerprint, planningMedia } from './collage-planner';
import { FrameManifest, MediaItem } from './models';

export type CycleTrace = (action: string, details: Record<string, string | number | boolean | string[]>) => void;
const identity = (item: MediaItem) => `${item.id}:${item.sha256}`;
const STORAGE_KEY = 'naiskos.collage-cycle.v1';
interface Round {
  round: number; seed: number; fingerprint: string; scenes: MediaScene[]; varied: boolean; fallback?: boolean;
}

/** Owns metadata, never DOM/video timers. Progress advances only on commit. */
export class CollageCycle {
  private active: Round | null = null;
  private next: Round | null = null;
  private manifest: FrameManifest | null = null;
  private aspect = 1.6;
  private cohort = new Set<string>();
  private seen = new Set<string>();
  private generation = 0;
  private busy = false;
  private suspended = false;
  private retryAt = 0;
  private failures = 0;
  private history: MediaScene[] = [];
  private historyIndex = -1;
  private lastSaved = '';
  private renewalDeferred = false;
  private restoreCheckpoint = true;
  private policyKey = '';

  constructor(private readonly planner: CollagePlannerClient,
    private readonly trace: CycleTrace,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = null) {}

  lookup(manifest: FrameManifest, aspect: number): MediaScene[] | null {
    return this.active?.fingerprint === planningFingerprint(manifest, aspect)
      ? hydrateScenes(this.active.scenes, manifest.media) : null;
  }

  private log(action: string, details: Parameters<CycleTrace>[1] = {}): void {
    this.trace(action, { round: this.active?.round ?? 0, seed: this.active?.seed ?? 0,
      planningGeneration: this.generation,
      basis: this.active ? collageRank(this.active.fingerprint, 0).toString(16) : 'none',
      manifestVersion: this.manifest?.version ?? 0, ...details });
  }

  private decorate(scene: MediaScene, round: Round): MediaScene {
    return { ...scene, key: scene.key.split('#cycle:')[0] + `#cycle:${round.round}:${round.seed}` };
  }

  private ensure(manifest: FrameManifest, aspect: number, initialSeed: number): Round {
    const policyKey = JSON.stringify([manifest.frameId, manifest.settings.collageMode, manifest.settings.order]);
    if (this.active && this.policyKey !== policyKey) this.reset();
    this.policyKey = policyKey;
    const fingerprint = planningFingerprint(manifest, aspect);
    this.manifest = manifest;
    this.aspect = aspect;
    if (this.active?.fingerprint === fingerprint) return this.active;
    this.invalidate('library-or-layout-changed');
    let round = this.active?.round ?? 1;
    let seed = this.active?.seed ?? initialSeed;
    let varied = this.active?.varied ?? false;
    // Configuration changes are handled explicitly by reset(); a library update
    // preserves the finite original cohort. New arrivals cannot postpone its end.
    if (!this.active) {
      this.cohort = new Set(manifest.media.map((item) => item.id));
      this.seen.clear();
      try {
        const raw = this.restoreCheckpoint ? this.storage?.getItem(STORAGE_KEY) : null;
        const saved = raw && raw.length <= 2_000_000 ? JSON.parse(raw) : null;
        if (saved?.frameId === manifest.frameId && saved?.mode === manifest.settings.collageMode &&
          saved?.order === manifest.settings.order && Number.isSafeInteger(saved.round) && saved.round > 0 &&
          Number.isSafeInteger(saved.seed) && saved.seed >= 0 && saved.seed <= 0xffffffff && typeof saved.varied === 'boolean' &&
          Array.isArray(saved.cohort) && Array.isArray(saved.seen) && saved.cohort.length <= 20000 && saved.seen.length <= 20000 &&
          [...saved.cohort, ...saved.seen].every((s: unknown) => typeof s === 'string' && s.length <= 256)) {
          round = saved.round; seed = saved.seed;
          varied = saved.varied;
          this.cohort = new Set(saved.cohort);
          this.seen = new Set(saved.seen);
          this.log('checkpoint-restored', { restoredRound: round, restoredSeen: this.seen.size });
        } else if (raw) this.log('checkpoint-rejected');
      } catch { this.log('checkpoint-rejected'); }
      this.restoreCheckpoint = false;
    }
    const ids = new Set(manifest.media.map((item) => item.id));
    const keys = new Set(manifest.media.map(identity));
    this.cohort = new Set([...this.cohort].filter((id) => ids.has(id)));
    this.seen = new Set([...this.seen].filter((key) => keys.has(key)));
    const ordered = [...manifest.media];
    if (varied && manifest.settings.order === 'shuffle') ordered.sort((a, b) =>
      collageRank(a.id, seed) - collageRank(b.id, seed) || a.id.localeCompare(b.id));
    const scenes = buildScenes(ordered, manifest.settings.collageMode, aspect, seed,
      varied ? seed : undefined);
    this.active = { round, seed, fingerprint, scenes, varied };
    this.active.scenes = scenes.map((s) => this.decorate(s, this.active!));
    this.history = []; this.historyIndex = -1;
    this.log('round-reconciled', { materials: manifest.media.length, cohort: this.cohort.size, seen: this.seen.size,
      scenes: scenes.length });
    return this.active;
  }

  private remaining(unavailable: (item: MediaItem) => boolean): number {
    return this.manifest!.media.filter((item) => this.cohort.has(item.id) && !this.seen.has(identity(item)) && !unavailable(item)).length;
  }

  candidates(manifest: FrameManifest, aspect: number, initialSeed: number, current: MediaScene | null,
    direction: -1 | 1, preferred: string | undefined, unavailable: (item: MediaItem) => boolean): SceneCandidate[] {
    let round = this.ensure(manifest, aspect, initialSeed);
    const from = Math.max(-1, round.scenes.findIndex((s) => s.cells.some((c) => c.item.id === current?.driver.id)));
    if (preferred) this.log('manual-selection', { mediaIds: [preferred] });
    if (!preferred && this.history.length && (direction === -1 || this.historyIndex < this.history.length - 1)) {
      for (let h = this.historyIndex + direction; h >= 0 && h < this.history.length; h += direction) {
        const byId = new Map(manifest.media.map((m) => [m.id, m]));
        const valid = omitSceneItems(this.history[h], (m) => byId.get(m.id)?.sha256 !== m.sha256 || unavailable(m));
        if (valid) {
          this.log('history-selected', { historyIndex: h });
          return [{ manifest, index: from < 0 ? 0 : from, item: valid.driver, scene: valid, historyIndex: h }];
        }
      }
    }
    const renewal = direction === 1 && !preferred && this.seen.size > 0 && this.remaining(unavailable) === 0;
    if (renewal) {
      if (this.next?.fingerprint === round.fingerprint) round = this.next;
      else {
        // Repeat the available plan for one complete fallback round. Never switch
        // to a late worker result halfway through it or wait with a frozen screen.
        round = { ...round, round: round.round + 1, fallback: true };
        round.scenes = round.scenes.map((s) => this.decorate(s, round));
        if (!this.renewalDeferred) this.log('renewal-deferred', { reason: this.busy ? 'planning' : 'plan-unavailable' });
        this.renewalDeferred = true;
      }
    }
    let scenes = hydrateScenes(round.scenes, manifest.media);
    let start = preferred ? scenes.findIndex((s) => s.cells.some((c) => c.item.id === preferred))
      : renewal ? 0 : (from + direction + scenes.length) % scenes.length;
    if (start < 0) start = 0;
    if (renewal && manifest.settings.order === 'shuffle' && current) {
      const last = new Set(current.cells.map((c) => c.item.id));
      const withoutOverlap = scenes.findIndex((s) => s.cells.every((c) => !last.has(c.item.id)));
      if (withoutOverlap >= 0) start = withoutOverlap;
      else this.log('boundary-repeat-unavoidable', { materials: manifest.media.length });
    }
    const candidates: SceneCandidate[] = [];
    for (let offset = 0; offset < scenes.length; offset++) {
      const index = (start + offset * direction + scenes.length) % scenes.length;
      const original = scenes[index];
      const scene = omitSceneItems(original, (item) => unavailable(item) ||
        (!renewal && direction === 1 && !preferred && this.seen.has(identity(item))));
      if (scene) candidates.push({ manifest, index, scene: this.decorate(scene, round), item: scene.driver,
        cycle: { round: round.round, seed: round.seed, fingerprint: round.fingerprint, fallback: round.fallback } });
    }
    return candidates;
  }

  commit(candidate: SceneCandidate): void {
    const active = this.active;
    if (!active) return;
    if (candidate.historyIndex !== undefined) {
      this.historyIndex = candidate.historyIndex;
      this.log('history-committed', { historyIndex: this.historyIndex, mediaIds: candidate.scene.cells.map((c) => c.item.id) });
      return;
    }
    if (!candidate.cycle || candidate.cycle.fingerprint !== active.fingerprint || candidate.cycle.round < active.round) return;
    if (candidate.cycle.round > active.round) {
      const previousRound = active.round;
      const ready = this.next?.round === candidate.cycle.round && this.next.seed === candidate.cycle.seed ? this.next : null;
      this.active = ready ?? { ...active, ...candidate.cycle,
        scenes: active.scenes.map((s) => this.decorate(s, { ...active, ...candidate.cycle! })) };
      this.next = null;
      this.cohort = new Set(candidate.manifest.media.map((m) => m.id));
      this.seen.clear();
      this.invalidate('round-adopted');
      this.renewalDeferred = false;
      this.log('round-adopted', { previousRound, fallback: !!candidate.cycle.fallback, scenes: this.active.scenes.length });
    }
    for (const cell of candidate.scene.cells) this.seen.add(identity(cell.item));
    this.history.splice(this.historyIndex + 1);
    this.history.push(candidate.scene);
    if (this.history.length > 64) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.log('scene-committed', { mediaIds: candidate.scene.cells.map((c) => c.item.id),
      seen: this.seen.size, cohort: this.cohort.size, sceneIndex: candidate.index });
    this.save();
  }

  private save(): void {
    if (!this.active || !this.manifest) return;
    const value = JSON.stringify({ frameId: this.manifest.frameId, mode: this.manifest.settings.collageMode,
      order: this.manifest.settings.order, round: this.active.round, seed: this.active.seed,
      varied: this.active.varied,
      cohort: [...this.cohort], seen: [...this.seen] });
    if (value === this.lastSaved) return;
    try {
      if (value.length > 2_000_000) throw new Error('checkpoint-limit');
      this.storage?.setItem(STORAGE_KEY, value); this.lastSaved = value;
    } catch { this.log('checkpoint-write-failed'); }
  }

  /** Called after a stable commit. Planning starts early, never at the boundary. */
  async warm(current: MediaScene | null): Promise<void> {
    if (!this.active || !this.manifest || this.suspended || this.busy || Date.now() < this.retryAt) return;
    const active = this.active, manifest = this.manifest, generation = this.generation;
    this.busy = true;
    try {
      if (!this.next) {
        const seed = collageRank(String(active.round + 1), active.seed);
        this.log('plan-requested', { nextRound: active.round + 1, nextSeed: seed, materials: manifest.media.length,
          reason: 'anticipate-next-round' });
        const result = await this.planner.run({ kind: 'plan', input: { media: planningMedia(manifest.media),
          mode: manifest.settings.collageMode, order: manifest.settings.order,
          fit: manifest.settings.defaultFitMode, aspect: this.aspect, seed } });
        if (generation !== this.generation) return;
        const keys = result.scenes.flatMap((s) => s.cells.map((c) => identity(c.item)));
        const expected = new Set(manifest.media.map(identity));
        if (keys.length !== manifest.media.length || new Set(keys).size !== keys.length ||
          keys.some((key) => !expected.has(key))) throw new Error('invalid-plan');
        const next: Round = { round: active.round + 1, seed, fingerprint: active.fingerprint, varied: true,
          scenes: hydrateScenes(result.scenes, manifest.media) };
        next.scenes = next.scenes.map((s) => this.decorate(s, next));
        this.next = next;
        this.log('plan-ready', { nextRound: next.round, nextSeed: seed, scenes: next.scenes.length,
          elapsedMs: Math.round(result.elapsedMs) });
      }
      const index = active.scenes.findIndex((s) => s.cells.some((c) => c.item.id === current?.driver.id));
      const nearby = Array.from({ length: Math.min(5, active.scenes.length) }, (_, i) =>
        (index + i + 1 + active.scenes.length) % active.scenes.length);
      const missing = nearby.filter((i) => !active.scenes[i].fitRefined && active.scenes[i].cells.length > 1);
      if (missing.length) {
        const stripped = planningMedia(manifest.media);
        const result = await this.planner.run({ kind: 'refine', fit: manifest.settings.defaultFitMode,
          scenes: hydrateScenes(missing.map((i) => active.scenes[i]), stripped) });
        if (generation !== this.generation) return;
        const fitted = hydrateScenes(result.scenes, manifest.media);
        missing.forEach((i, n) => active.scenes[i] = this.decorate(fitted[n], active));
        this.log('lookahead-ready', { scenes: missing.length, elapsedMs: Math.round(result.elapsedMs) });
      }
      this.failures = 0;
    } catch (error) {
      if (generation === this.generation) {
        this.failures++;
        this.retryAt = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(this.failures - 1, 4));
        this.log('plan-failed', { reason: error instanceof Error ? error.message : 'unknown', attempt: this.failures });
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }

  async refine(candidate: SceneCandidate): Promise<SceneCandidate> {
    if (candidate.scene.fitRefined || candidate.scene.cells.length < 2) return candidate;
    // A manual jump may outrun lookahead. Keep playback working even if worker
    // is unavailable: the existing base layout is a safe, non-cropping fallback.
    if (this.busy || this.suspended || Date.now() < this.retryAt) {
      this.log('refinement-fallback', { reason: this.busy ? 'planning-busy' : 'planning-deferred' });
      return candidate;
    }
    const generation = this.generation;
    this.busy = true;
    try {
      const result = await this.planner.run({ kind: 'refine', fit: candidate.manifest.settings.defaultFitMode,
        scenes: hydrateScenes([candidate.scene], planningMedia(candidate.manifest.media)) }, 2_000);
      if (generation !== this.generation) return candidate;
      const scene = hydrateScenes(result.scenes, candidate.manifest.media)[0];
      if (candidate.cycle) scene.key = this.decorate(scene, { ...this.active!, ...candidate.cycle }).key;
      return { ...candidate, scene };
    } catch { this.log('refinement-fallback', { reason: 'worker-unavailable' }); return candidate; }
    finally { if (generation === this.generation) this.busy = false; }
  }

  invalidate(reason: string): void {
    if (this.busy || this.next) this.log('plan-cancelled', { reason });
    this.generation++; this.busy = false;
    this.planner.cancel(); this.next = null;
  }

  suspend(): void {
    this.suspended = true;
    // Preserve a finished metadata plan, cancel unfinished work only.
    const ready = this.next;
    this.invalidate('repose'); this.next = ready;
    this.log('planning-suspended'); this.save();
  }
  resume(): void { this.suspended = false; this.log('planning-resumed'); }
  reset(): void {
    if (!this.active) return;
    this.invalidate('mode-or-order-changed'); this.active = null;
    this.cohort.clear(); this.seen.clear(); this.history = []; this.historyIndex = -1;
  }
  destroy(): void { this.suspended = true; this.invalidate('viewer-destroyed'); }
}
