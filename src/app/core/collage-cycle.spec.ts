import { describe, expect, it, vi } from 'vitest';
import { CollageCycle } from './collage-cycle';
import { CollagePlannerClient } from './collage-planner-client';
import { executePlannerJob, planningFingerprint, planningMedia, PlannerJob } from './collage-planner';
import { DEFAULT_FRAME_SETTINGS, FrameManifest, MediaItem } from './models';
import { MediaScene } from './collage-policy';

const media = (count = 18): MediaItem[] => Array.from({ length: count }, (_, i) => ({
  id: `item-${i}`, sha256: `hash-${i}`, kind: 'photo', width: 670, height: 1000,
  url: `/private/${i}`, caption: 'private', senderName: 'private', receivedAt: '',
  fitMode: 'inherit', rotationDegrees: 0, durationSeconds: null, sizeBytes: 1,
  posterUrl: null, posterSizeBytes: null,
}));
const manifest = (count = 18): FrameManifest => ({ frameId: 'frame', schemaVersion: 1, version: 1,
  publishedAt: '', settingsRevision: 1, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns', order: 'shuffle' },
  media: media(count) });
const result = (job: PlannerJob) => ({ scenes: executePlannerJob(job), elapsedMs: 3 });
function setup(m = manifest(), storage?: Storage) {
  const planner = { run: vi.fn(async (job: PlannerJob) => result(job)), cancel: vi.fn() };
  const trace = vi.fn();
  const cycle = new CollageCycle(planner as unknown as CollagePlannerClient, trace, storage);
  let current: MediaScene | null = null;
  const next = async (preferred?: string, unavailable = (_item: MediaItem) => false, direction: -1 | 1 = 1) =>
    (await cycle.candidates(m, 1.6, 42, current, direction, preferred, unavailable))[0];
  const commit = async (pending: ReturnType<typeof next> | Awaited<ReturnType<typeof next>> = next()) => {
    const candidate = await pending;
    expect(candidate).toBeTruthy(); cycle.commit(candidate); current = candidate.scene; return candidate;
  };
  return { planner, trace, cycle, next, commit, get current() { return current; }, m };
}

describe('dynamic collage rounds', () => {
  it('reconciles initial layouts in the worker and ignores a result cancelled by repose', async () => {
    const s = setup(); let resolve!: () => void;
    s.planner.run.mockImplementationOnce((job) => new Promise((r) => { resolve = () => r(result(job)); }));
    const pending = s.next();
    expect(s.planner.run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'plan' }), 2000);
    s.cycle.suspend(); resolve();
    expect(await pending).toBeUndefined();
    expect(s.trace.mock.calls.some(([a]) => a === 'round-reconciled')).toBe(false);
    s.cycle.resume(); expect(await s.next()).toBeTruthy();
  });

  it('uses bounded singles on initial worker failure without losing media', async () => {
    const s = setup(); s.planner.run.mockRejectedValueOnce(new Error('worker-timeout'));
    const first = await s.next();
    expect(first.scene.cells).toHaveLength(1);
    expect(s.cycle.lookup(s.m, 1.6)).toHaveLength(18);
    expect(s.trace.mock.calls.some(([a, d]) => a === 'refinement-fallback' && d.reason === 'initial-layout-unavailable')).toBe(true);
  });

  it('prepares early; only commits count all members, and adoption waits for a successful boundary commit', async () => {
    const s = setup();
    const first = await s.next();
    expect(s.trace.mock.calls.some(([a]) => a === 'scene-committed')).toBe(false);
    await s.commit(first); await s.cycle.warm(s.current);
    expect(s.trace.mock.calls.some(([a]) => a === 'plan-ready')).toBe(true);
    expect(s.trace.mock.calls.some(([a]) => a === 'round-adopted')).toBe(false);
    const shown = new Set(first.scene.cells.map((c) => c.item.id));
    for (let n = 0; n < s.m.media.length; n++) {
      const c = await s.next();
      if (c.cycle?.round === 2) {
        expect(shown.size).toBe(s.m.media.length);
        expect(s.trace.mock.calls.some(([a]) => a === 'round-adopted')).toBe(false);
        expect(c.scene.cells.every((cell) => !s.current!.cells.some((old) => old.item.id === cell.item.id))).toBe(true);
        await s.commit(c);
        expect(s.trace.mock.calls.filter(([a]) => a === 'round-adopted')).toHaveLength(1);
        expect(s.trace.mock.calls.find(([a]) => a === 'round-adopted')![1].fallback).toBe(false);
        return;
      }
      for (const cell of c.scene.cells) { expect(shown.has(cell.item.id)).toBe(false); shown.add(cell.item.id); }
      await s.commit(c);
    }
    throw new Error('round did not finish');
  });

  it('gallery jumps leave skipped media pending; back/forward replays actual history without losing progress', async () => {
    const s = setup(); await s.commit(); await s.cycle.warm(s.current);
    const jump = await s.commit(s.next('item-15'));
    const back = await s.commit(s.next(undefined, () => false, -1));
    expect(back.scene.key).not.toBe(jump.scene.key);
    expect((await s.commit()).scene.key).toBe(jump.scene.key);
    const visited = new Set(s.trace.mock.calls.filter(([a]) => a === 'scene-committed').flatMap(([, d]) => d.mediaIds));
    for (let i = 0; i < 30; i++) {
      const candidate = await s.next();
      if (candidate.cycle?.round === 2) { expect(visited.size).toBe(18); return; }
      await s.commit(candidate); candidate.scene.cells.forEach((c) => visited.add(c.item.id));
    }
    throw new Error('gallery jump starved the round');
  });

  it('quarantined media cannot trap completion and are eligible again in a later round', async () => {
    const s = setup(); await s.commit(); await s.cycle.warm(s.current);
    const bad = 'item-17';
    for (let i = 0; i < 25; i++) {
      const c = await s.next(undefined, (item) => item.id === bad);
      expect(c.scene.cells.some((cell) => cell.item.id === bad)).toBe(false);
      await s.commit(c);
      if (c.cycle?.round === 2) {
        expect((await s.next(bad)).scene.cells.some((cell) => cell.item.id === bad)).toBe(true);
        return;
      }
    }
    throw new Error('bad media trapped round');
  });

  it('a late plan cannot replace a fallback round halfway through it', async () => {
    const s = setup(manifest(4)); await s.commit();
    s.planner.run.mockRejectedValueOnce(new Error('worker-error'));
    await s.cycle.warm(s.current);
    let c = await s.next();
    while (c.cycle!.round === 1) { await s.commit(c); c = await s.next(); }
    expect(c.cycle!.fallback).toBe(true); await s.commit(c);
    expect(s.trace.mock.calls.find(([a]) => a === 'round-adopted')![1].fallback).toBe(true);
    expect((await s.next()).cycle!.round).toBe(2);
  });

  it('repose cancels unfinished work, rejects late results, and preserves a finished plan', async () => {
    const s = setup(); await s.commit();
    let resolve!: (value: ReturnType<typeof result>) => void;
    s.planner.run.mockImplementationOnce((job) => new Promise((r) => { resolve = () => r(result(job)); }));
    const warming = s.cycle.warm(s.current);
    await Promise.resolve(); await Promise.resolve();
    s.cycle.suspend(); resolve(undefined as never); await warming;
    expect(s.trace.mock.calls.some(([a]) => a === 'plan-ready')).toBe(false);
    s.cycle.resume(); await s.cycle.warm(s.current);
    const count = s.trace.mock.calls.filter(([a]) => a === 'plan-ready').length;
    s.cycle.suspend(); s.cycle.resume(); await s.cycle.warm(s.current);
    expect(s.trace.mock.calls.filter(([a]) => a === 'plan-ready')).toHaveLength(count);
  });

  it('library changes invalidate in-flight results; newly arriving media do not extend the finite cohort', async () => {
    const s = setup(manifest(4)); await s.commit();
    let resolve!: () => void;
    s.planner.run.mockImplementationOnce((job) => new Promise((r) => { resolve = () => r(result(job)); }));
    const warming = s.cycle.warm(s.current);
    await Promise.resolve(); await Promise.resolve();
    s.m.media = [...s.m.media, ...media(12).slice(4)]; s.m.version++;
    await s.next(); resolve(); await warming;
    expect(s.trace.mock.calls.some(([a]) => a === 'plan-ready')).toBe(false);
    // Finish only the original cohort using explicit selections.
    await s.commit(s.next('item-3'));
    const c = await s.next();
    expect(c.cycle!.round).toBe(2);
    expect(s.trace.mock.calls.filter(([a]) => a === 'scene-committed').at(-1)![1].cohort).toBe(4);
  });

  it('decorative/volume changes preserve the plan, while aspect, fit and content invalidate it', async () => {
    const s = setup(); await s.commit(); await s.cycle.warm(s.current);
    const fingerprint = planningFingerprint(s.m, 1.6);
    s.m.settings = { ...s.m.settings, volume: 0.1, showCaption: true };
    s.m.media = s.m.media.map((item) => ({ ...item, caption: 'changed', bandColors: ['#ffffff', '#000000'] }));
    expect(planningFingerprint(s.m, 1.6)).toBe(fingerprint);
    await s.next(); await s.cycle.warm(s.current);
    expect(s.trace.mock.calls.filter(([a]) => a === 'plan-requested')).toHaveLength(1);
    s.m.media[0] = { ...s.m.media[0], sha256: 'rotated' }; await s.next();
    expect(s.trace.mock.calls.some(([a, d]) => a === 'plan-cancelled' && d.reason === 'library-or-layout-changed')).toBe(true);
  });

  it('restores committed progress and seed after restart, not a corrupt checkpoint', async () => {
    window.localStorage.clear();
    const s = setup(manifest(), window.localStorage); const first = await s.commit();
    const resumed = setup(manifest(), window.localStorage);
    const c = await resumed.next();
    expect(c.scene.cells.every((cell) => !first.scene.cells.some((old) => old.item.id === cell.item.id))).toBe(true);
    expect(resumed.trace.mock.calls.some(([a]) => a === 'checkpoint-restored')).toBe(true);
    window.localStorage.setItem('naiskos.collage-cycle.v1', '{broken');
    const broken = setup(manifest(), window.localStorage); expect(await broken.next()).toBeTruthy();
    expect(broken.trace.mock.calls.some(([a]) => a === 'checkpoint-rejected')).toBe(true);
    window.localStorage.clear();
  });

  it('rejects incomplete worker plans without changing the active round', async () => {
    const s = setup(); await s.commit();
    s.planner.run.mockResolvedValueOnce({ scenes: [], elapsedMs: 1 });
    await s.cycle.warm(s.current);
    expect(s.trace.mock.calls.some(([a, d]) => a === 'plan-failed' && d.reason === 'invalid-plan')).toBe(true);
    expect((await s.next()).cycle!.round).toBe(1);
  });

  it('a single available item keeps advancing rounds and reports unavoidable repetition', async () => {
    const s = setup(manifest(1)); const first = await s.commit(); await s.cycle.warm(s.current);
    const second = await s.next();
    expect(second.scene.key).not.toBe(first.scene.key);
    expect(second.cycle!.round).toBe(2); await s.commit(second);
    expect(s.trace.mock.calls.some(([a]) => a === 'boundary-repeat-unavoidable')).toBe(true);
  });

  it('a remotely supplied order/mode change starts a new cohort instead of retaining old seen items', async () => {
    const s = setup(); await s.commit(); await s.cycle.warm(s.current);
    const changed = { ...s.m, settings: { ...s.m.settings, order: 'oldest' as const } };
    const next = (await s.cycle.candidates(changed, 1.6, 42, null, 1, undefined, () => false))[0];
    expect(next.scene.cells[0].item.id).toBe(changed.media[0].id);
    expect(s.trace.mock.calls.filter(([a]) => a === 'round-reconciled').at(-1)![1].seen).toBe(0);
  });

  it('a fallback checkpoint restores the actual old mixing strategy, not a new seeded variant', async () => {
    window.localStorage.clear();
    const s = setup(manifest(), window.localStorage); await s.commit();
    let c = await s.next();
    while (c.cycle!.round === 1) { await s.commit(c); c = await s.next(); }
    expect(c.cycle!.fallback).toBe(true); await s.commit(c);
    const expected = s.cycle.lookup(s.m, 1.6)!.map((scene) => scene.cells.map((cell) => cell.item.id));
    const resumed = setup(manifest(), window.localStorage); await resumed.next();
    expect(resumed.cycle.lookup(resumed.m, 1.6)!.map((scene) => scene.cells.map((cell) => cell.item.id))).toEqual(expected);
    window.localStorage.clear();
  });
});

describe('metadata planner properties', () => {
  it('changes groups across seeds without dropping/duplicating content, exceeding four cells or adding a second video', () => {
    const input = media(40).map((m, i) => ({ ...m, kind: i % 5 === 0 ? 'video' as const : 'photo' as const,
      width: i % 4 === 0 ? 1400 : 670 }));
    for (const mode of ['columns', 'adaptive'] as const) {
      const signatures = new Set<string>();
      for (const seed of [1, 2, 3, 42, 1234]) {
        const scenes = executePlannerJob({ kind: 'plan', input: {
          media: planningMedia(input), mode, order: 'shuffle', fit: 'contain', aspect: 1.6, seed,
        } });
        const ids = scenes.flatMap((s) => s.cells.map((c) => c.item.id));
        expect(new Set(ids).size).toBe(input.length); expect(ids).toHaveLength(input.length);
        for (const s of scenes) {
          expect(s.cells.length).toBeLessThanOrEqual(mode === 'columns' ? 3 : 4);
          expect(s.cells.filter((c) => c.item.kind === 'video').length).toBeLessThanOrEqual(1);
          for (const c of s.cells) {
            expect(c.width).toBeGreaterThan(0); expect(c.height).toBeGreaterThan(0);
            expect(c.left + c.width).toBeLessThanOrEqual(1.0001);
            expect(c.top + c.height).toBeLessThanOrEqual(1.0001);
          }
        }
        signatures.add(scenes.map((s) => s.key).join(';'));
      }
      expect(signatures.size).toBe(5);
    }
    expect(JSON.stringify(planningMedia(input))).not.toContain('private');
  });

  it('chronological anchors retain priority while companions can vary', () => {
    const input = media(30);
    const signatures = new Set<string>();
    for (const seed of [1, 2, 3, 42]) {
      const scenes = executePlannerJob({ kind: 'plan', input: {
        media: planningMedia(input), mode: 'columns', order: 'newest', fit: 'contain', aspect: 1.6, seed,
      } });
      const pending = new Set(input.map((m) => m.id));
      for (const s of scenes) {
        expect(s.cells[0].item.id).toBe([...pending][0]);
        s.cells.forEach((c) => pending.delete(c.item.id));
      }
      signatures.add(scenes.map((s) => s.key).join(';'));
    }
    expect(signatures.size).toBeGreaterThan(1);
  });
});
