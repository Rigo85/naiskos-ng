import { CollageMode, FitMode, FrameManifest, MediaItem } from './models';
import { refineCollageFit } from './collage-fit';
import { navigationPlan, NavigationCandidate, NavigationPlanInput } from './navigation-policy';

export interface SceneCell {
  item: MediaItem;
  left: number;
  top: number;
  width: number;
  height: number;
  automaticCover?: boolean;
}

export interface MediaScene {
  key: string;
  driver: MediaItem;
  cells: SceneCell[];
  layoutMode?: CollageMode;
  aspect?: number;
  fitRefined?: boolean;
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

// Finite catalogue: no nested partitions, dynamic optimizer or library-wide search.
const WIDTHS = [0.5, 0.4, 0.6, 0.3, 0.7];
const COLUMNS: Record<number, Rectangle[][]> = {
  2: WIDTHS.map((w) => [[0, 0, w, 1], [w, 0, 1 - w, 1]]),
  3: [TEMPLATES[3][0], ...[
    [0.25, 0.35, 0.4], [0.25, 0.4, 0.35], [0.35, 0.25, 0.4],
    [0.35, 0.4, 0.25], [0.4, 0.25, 0.35], [0.4, 0.35, 0.25],
  ].map(([a, b, c]): Rectangle[] => [[0, 0, a, 1], [a, 0, b, 1], [a + b, 0, c, 1]])],
};

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map((rest) => [value, ...rest]));
}

const ADAPTIVE: Record<number, Rectangle[][]> = {
  2: COLUMNS[2],
  3: [...COLUMNS[3], ...WIDTHS.flatMap((w) => {
    const cells: Rectangle[] = [[0, 0, w, 1], [w, 0, 1 - w, 0.5], [w, 0.5, 1 - w, 0.5]];
    return permutations(cells);
  })],
  4: TEMPLATES[4].flatMap(permutations),
};

function chooseLayout(items: MediaItem[], mode: CollageMode, aspect: number) {
  const templates = (mode === 'columns' ? COLUMNS : ADAPTIVE)[items.length];
  let best = templates[0];
  let cost = Infinity;
  const ratios = items.map((item) => ratio(item) ?? 1);
  for (const rectangles of templates) {
    const penalties = rectangles.map(([, , width, height], index) =>
      Math.abs(Math.log(aspect * width / height / ratios[index])));
    // Penalize the worst cell too; an average must not hide a badly fitted companion.
    // With centered contain/cover this geometric mismatch measures both bands/crop.
    const value = 0.75 * penalties.reduce((a, b) => a + b, 0) / items.length +
      0.25 * Math.max(...penalties);
    if (value < cost - 1e-9) { cost = value; best = rectangles; }
  }
  // Mirroring has exactly the same geometric score. Break that tie by stable
  // identity, not by random transition time; otherwise one side would never win.
  const mirror = mode === 'adaptive' && items.length >= 3 &&
    [...items[0].id].reduce((hash, char) => (Math.imul(hash, 31) ^ char.charCodeAt(0)) >>> 0, 0) % 2 === 1;
  return { rectangles: mirror ? best.map(([x, y, width, height]): Rectangle =>
    [Math.max(0, 1 - x - width), y, width, height]) : best, cost };
}

function ratio(item: MediaItem): number | null {
  return Number.isFinite(item.width) &&
    Number.isFinite(item.height) &&
    item.width! > 0 &&
    item.height! > 0
    ? item.width! / item.height!
    : null;
}

function adaptiveSolo(id: string, seed: number): boolean {
  // A seeded draw per anchor: independent of manifest version, colors and timing.
  // Avalanche spreads similar/sequential IDs across the 32-bit interval.
  let hash = (2166136261 ^ seed) >>> 0;
  for (const char of `adaptive-solo:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) >= 0xc0000000; // Last quarter: 25% of scene decisions, not media.
}

export function singleScene(item: MediaItem): MediaScene {
  return makeScene([item], [[0, 0, 1, 1]]);
}

/** Called only for the candidate about to be prepared. Never refines every
 * scene at startup, nor re-refines an already adjusted scene (no drift). */
export function refineScene(scene: MediaScene, defaultFit: FitMode): MediaScene {
  if (scene.cells.length < 2 || scene.fitRefined) return scene;
  const items = scene.cells.map((cell) => cell.item);
  const fit = refineCollageFit(items, scene.cells.map((c) => [c.left, c.top, c.width, c.height]),
    scene.aspect ?? 1.6, defaultFit);
  const refined = makeScene(items, fit.rectangles, scene.layoutMode, scene.aspect);
  return { ...refined, fitRefined: true,
    key: refined.key + ':' + JSON.stringify(fit.automaticCover),
    cells: refined.cells.map((cell, i) => ({ ...cell, automaticCover: fit.automaticCover[i] })),
  };
}

export function omitSceneItems(
  scene: MediaScene,
  omit: (item: MediaItem) => boolean,
): MediaScene | null {
  const items = scene.cells.map((cell) => cell.item).filter((item) => !omit(item));
  if (items.length === scene.cells.length) return scene;
  if (items.length === 0) return null;
  if (items.length === 1) return singleScene(items[0]);
  const mode = scene.layoutMode ?? 'adaptive';
  const aspect = scene.aspect ?? 1.6;
  return makeScene(items, chooseLayout(items, mode, aspect).rectangles, mode, aspect);
}

function makeScene(items: MediaItem[], rectangles: Rectangle[], layoutMode: CollageMode = 'off', aspect = 1.6): MediaScene {
  return {
    layoutMode,
    aspect,
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
  adaptiveMixSeed = 0,
): MediaScene[] {
  if (mode === 'off') return media.map(singleScene);
  const used = new Set<number>();
  const scenes: MediaScene[] = [];
  const screenRatio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  for (let cursor = 0; cursor < media.length; cursor += 1) {
    if (used.has(cursor)) { used.delete(cursor); continue; }
    const anchor = media[cursor];
    const anchorRatio = ratio(anchor);
    if (anchorRatio === null || (mode === 'columns' && anchorRatio >= 1) ||
      (mode === 'adaptive' && adaptiveSolo(anchor.id, adaptiveMixSeed))) {
      scenes.push(singleScene(anchor));
      continue;
    }
    let videos = anchor.kind === 'video' ? 1 : 0;
    const eligible = [anchor];
    const eligibleIndices = [cursor];
    let inspected = 0;
    for (let index = cursor + 1; index < media.length && inspected < 5; index += 1) {
      if (used.has(index)) continue;
      inspected += 1;
      const item = media[index];
      const itemRatio = ratio(item);
      if (itemRatio === null || (mode === 'columns' && itemRatio >= 1)) continue;
      if (item.kind === 'video' && videos > 0) continue;
      eligible.push(item);
      eligibleIndices.push(index);
      if (item.kind === 'video') videos += 1;
      if (eligible.length === (mode === 'columns' ? 3 : 4)) break;
    }
    let best = singleScene(anchor);
    let bestCost = Infinity;
    for (let count = 2; count <= eligible.length; count += 1) {
      const items = eligible.slice(0, count);
      const { rectangles, cost } = chooseLayout(items, mode, screenRatio);
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = makeScene(items, rectangles, mode, screenRatio);
      }
    }
    scenes.push(best);
    eligibleIndices.slice(1, best.cells.length).forEach((index) => used.add(index));
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
