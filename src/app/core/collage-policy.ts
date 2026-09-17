import { CollageMode, FrameManifest, MediaItem } from './models';
import { navigationPlan, NavigationCandidate, NavigationPlanInput } from './navigation-policy';

export interface SceneCell {
  item: MediaItem;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MediaScene {
  key: string;
  driver: MediaItem;
  cells: SceneCell[];
}

export interface SceneCandidate extends NavigationCandidate {
  scene: MediaScene;
}

type Rectangle = [number, number, number, number];
const TEMPLATES: Record<number, Rectangle[][]> = {
  2: [
    [
      [0, 0, 0.5, 1],
      [0.5, 0, 0.5, 1],
    ],
  ],
  3: [
    [
      [0, 0, 1 / 3, 1],
      [1 / 3, 0, 1 / 3, 1],
      [2 / 3, 0, 1 / 3, 1],
    ],
    [
      [0, 0, 0.3, 1],
      [0.3, 0, 0.7, 0.5],
      [0.3, 0.5, 0.7, 0.5],
    ],
  ],
  4: [
    [
      [0, 0, 0.25, 1],
      [0.25, 0, 0.25, 1],
      [0.5, 0, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ],
    [
      [0, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5],
      [0.5, 0, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ],
  ],
};

function ratio(item: MediaItem): number | null {
  return Number.isFinite(item.width) &&
    Number.isFinite(item.height) &&
    item.width! > 0 &&
    item.height! > 0
    ? item.width! / item.height!
    : null;
}

export function singleScene(item: MediaItem): MediaScene {
  return makeScene([item], [[0, 0, 1, 1]]);
}

export function omitSceneItems(
  scene: MediaScene,
  omit: (item: MediaItem) => boolean,
): MediaScene | null {
  const items = scene.cells.map((cell) => cell.item).filter((item) => !omit(item));
  if (items.length === scene.cells.length) return scene;
  if (items.length === 0) return null;
  return items.length === 1 ? singleScene(items[0]) : makeScene(items, TEMPLATES[items.length][0]);
}

function makeScene(items: MediaItem[], rectangles: Rectangle[]): MediaScene {
  return {
    key:
      items.map((item) => `${item.id}:${item.sha256}`).join('|') + ':' + JSON.stringify(rectangles),
    // Keep the existing video lifecycle as the sole clock for a mixed scene.
    driver: items.find((item) => item.kind === 'video') ?? items[0],
    cells: items.map((item, index) => {
      const [left, top, width, height] = rectangles[index];
      return { item, left, top, width, height };
    }),
  };
}

/** A finite partition of the already ordered library. Never drops or repeats an item. */
export function buildScenes(
  media: MediaItem[],
  mode: CollageMode = 'off',
  aspect = 1.6,
): MediaScene[] {
  if (mode === 'off') return media.map(singleScene);
  const remaining = [...media];
  const scenes: MediaScene[] = [];
  const screenRatio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  while (remaining.length) {
    const anchor = remaining[0];
    const anchorRatio = ratio(anchor);
    if (anchorRatio === null || (mode === 'columns' && anchorRatio >= 1)) {
      scenes.push(singleScene(remaining.shift()!));
      continue;
    }
    let videos = anchor.kind === 'video' ? 1 : 0;
    const eligible = [anchor];
    for (const item of remaining.slice(1, 6)) {
      const itemRatio = ratio(item);
      if (itemRatio === null || (mode === 'columns' && itemRatio >= 1)) continue;
      if (item.kind === 'video' && videos > 0) continue;
      eligible.push(item);
      if (item.kind === 'video') videos += 1;
      if (eligible.length === (mode === 'columns' ? 3 : 4)) break;
    }
    let best = singleScene(anchor);
    let bestCost = Infinity;
    for (let count = 2; count <= eligible.length; count += 1) {
      const items = eligible.slice(0, count);
      const templates = mode === 'columns' ? TEMPLATES[count].slice(0, 1) : TEMPLATES[count];
      for (const rectangles of templates) {
        // Basic centered fit: choose the least aspect-ratio mismatch, no subject detection.
        const cost =
          rectangles.reduce(
            (sum, [, , width, height], index) =>
              sum + Math.abs(Math.log((screenRatio * width) / height / ratio(items[index])!)),
            0,
          ) / count;
        if (cost < bestCost) {
          bestCost = cost;
          best = makeScene(items, rectangles);
        }
      }
    }
    scenes.push(best);
    const used = new Set(best.cells.map((cell) => cell.item));
    for (let index = Math.min(5, remaining.length - 1); index >= 0; index -= 1) {
      if (used.has(remaining[index])) remaining.splice(index, 1);
    }
  }
  return scenes;
}

/** Adapt navigation without replacing the actual manifest or hiding items from the gallery. */
export function sceneNavigationPlan(
  input: NavigationPlanInput,
  scenesFor: (manifest: FrameManifest) => MediaScene[],
): SceneCandidate[] {
  const activeScenes = scenesFor(input.active);
  const target = input.pending ?? input.active;
  const scenes = scenesFor(target);
  const preferred = input.preferredMediaId
    ? scenes.find((scene) => scene.cells.some((cell) => cell.item.id === input.preferredMediaId))
        ?.driver.id
    : undefined;
  const active = { ...input.active, media: activeScenes.map((scene) => scene.driver) };
  const pending = input.pending
    ? { ...input.pending, media: scenes.map((scene) => scene.driver) }
    : null;
  return navigationPlan({ ...input, active, pending, preferredMediaId: preferred }).map(
    (candidate) => ({
      ...candidate,
      manifest: target,
      scene: scenes[candidate.index],
    }),
  );
}
