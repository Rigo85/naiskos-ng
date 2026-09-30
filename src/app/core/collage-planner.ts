import { buildScenes, collageRank, MediaScene, refineScene } from './collage-policy';
import { FrameManifest, MediaItem } from './models';

export interface PlanInput {
  media: MediaItem[];
  mode: FrameManifest['settings']['collageMode'];
  order: FrameManifest['settings']['order'];
  fit: FrameManifest['settings']['defaultFitMode'];
  aspect: number;
  seed: number;
}
export type PlannerJob = { kind: 'plan'; input: PlanInput } |
  { kind: 'refine'; scenes: MediaScene[]; fit: PlanInput['fit'] };

/** No URLs, captions, senders, temperatures or pixel buffers cross the worker. */
export function planningMedia(media: MediaItem[]): MediaItem[] {
  return media.map(({ id, sha256, kind, width, height, fitMode }) => ({
    id, sha256, kind, width, height, fitMode, url: '', receivedAt: '',
    caption: null, senderName: null, durationSeconds: null, rotationDegrees: 0,
    sizeBytes: 0, posterUrl: null, posterSizeBytes: null,
  }));
}

export function executePlannerJob(job: PlannerJob): MediaScene[] {
  if (job.kind === 'refine') return job.scenes.map((scene) => refineScene(scene, job.fit));
  const { input } = job;
  const media = [...input.media];
  if (input.order === 'shuffle') media.sort((a, b) => collageRank(a.id, input.seed) -
    collageRank(b.id, input.seed) || a.id.localeCompare(b.id));
  const scenes = buildScenes(media, input.mode, input.aspect, input.seed, input.seed);
  // Geometry first; prepare a short head, not every crop in a large library.
  return scenes.map((scene, i) => i < 5 ? refineScene(scene, input.fit) : scene);
}

export function hydrateScenes(scenes: MediaScene[], media: MediaItem[]): MediaScene[] {
  const byId = new Map(media.map((item) => [item.id, item]));
  return scenes.map((scene) => ({ ...scene, driver: byId.get(scene.driver.id)!,
    cells: scene.cells.map((cell) => ({ ...cell, item: byId.get(cell.item.id)! })) }));
}

export function planningFingerprint(manifest: FrameManifest, aspect: number): string {
  // Exact comparison, not a truncated hash: ignore decorative/volume revisions.
  return JSON.stringify([manifest.frameId, aspect, manifest.settings.collageMode,
    manifest.settings.order, manifest.settings.defaultFitMode,
    manifest.media.map((m) => [m.id, m.sha256, m.kind, m.width, m.height, m.fitMode])]);
}
